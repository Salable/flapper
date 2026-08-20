/**
 * One queue playing into one band of the board.
 *
 * A track owns everything about playback for its band: the queue, the message
 * currently showing, the dwell timer, and the settle watchdog. Messages play
 * strictly in order - a message is laid out into pages, each page is flipped
 * and held, and only when its last page has been held does the next begin -
 * unless a caller asks for a jump with `priority`.
 *
 * Tracks are deliberately unaware of each other. Each subscribes to its own
 * band settling rather than to the board settling, which is what lets a footer
 * update on its own clock without restarting the main queue's hold. Two tracks
 * cannot fight over tiles because a band is a fixed range of them.
 */

import { estimatePageMs } from './timing.mjs';

export const TRACK_DEFAULTS = Object.freeze({
  dwellMs: 2200, // hold once a page has landed
  maxQueue: 500, // refuse to grow past this
  settleTimeoutMs: 30000, // advance anyway if the band never reports settling
});

/** Where an enqueued message lands. See `enqueue`. */
export const PRIORITIES = Object.freeze(['normal', 'next', 'now']);

export class Track {
  /**
   * @param {import('./flipboard.js').Flipboard} board
   * @param {string} regionId the band this track plays into
   * @param {object} [options] TRACK_DEFAULTS overrides, plus `allocateId`
   */
  constructor(board, regionId, options = {}) {
    this.board = board;
    this.regionId = regionId;
    this.opts = { ...TRACK_DEFAULTS, ...options };
    // Ids are handed out centrally so two bands can never mint the same one.
    this.allocateId = options.allocateId ?? (() => `${regionId}${this.queue.length}`);

    this.queue = [];
    this.current = null;
    /**
     * The message this band finished but whose last page is still on the glass.
     * A drained band does not blank, so this is the difference between "showing
     * nothing" and "showing nothing new" - the normal steady state of a
     * standing strip, and something an observer cannot otherwise tell apart.
     */
    this.holding = null;
    this.timer = null;
    this.settleGuard = null;
    /** Called on any state change, for pushing to API listeners. */
    this.onChange = null;

    this.stopIdle = this.board.onRegionIdle(regionId, () => this.handleSettled());
  }

  /** Rows this track has to play in - the row budget for its messages. */
  get height() {
    return this.board.regionHeight(this.regionId);
  }

  dispose() {
    this.cancelTimers();
    if (this.stopIdle) this.stopIdle();
    this.stopIdle = null;
  }

  /* ---- queue ---- */

  /**
   * Lay out either prose or an explicit grid, against this band's height.
   * `options.rows` selects literal mode, where the caller positions every cell.
   */
  layoutFor(text, options = {}) {
    const shared = {
      rows: this.height,
      ...(options.substitutions ? { substitutions: options.substitutions } : {}),
    };
    if (Array.isArray(options.rows)) {
      return { kind: 'rows', ...this.board.layoutRows(options.rows, shared) };
    }
    return {
      kind: 'text',
      ...this.board.layout(text, {
        align: options.align ?? this.board.opts.align,
        valign: options.valign ?? this.board.opts.valign,
        wrap: options.wrap ?? this.board.opts.wrap,
        ...(options.collapseSpaces === undefined
          ? {}
          : { collapseSpaces: options.collapseSpaces }),
        ...shared,
      }),
    };
  }

  /**
   * Lay text out and add it to the queue.
   *
   * `options.priority` decides where it lands:
   *   'normal' (default) - the back of the queue
   *   'next'             - the head of the queue, after whatever is playing
   *   'now'              - the head, and pre-empt whatever is playing
   *
   * @returns {{id, pages, diagnostics, position, estimatedMs, interrupted}}
   */
  enqueue(text, options = {}) {
    if (this.queue.length >= this.opts.maxQueue) {
      const error = new Error(`queue is full (${this.opts.maxQueue} messages)`);
      error.status = 429;
      throw error;
    }

    const priority = options.priority ?? 'normal';
    if (!PRIORITIES.includes(priority)) {
      const error = new Error(`priority must be one of ${PRIORITIES.join(', ')}`);
      error.status = 422;
      throw error;
    }

    const { pages, diagnostics, kind } = this.layoutFor(text, options);

    const message = {
      id: this.allocateId(),
      // Literal frames have no prose to echo back, so describe them by shape.
      text: kind === 'rows' ? `(${options.rows.length}-row frame)` : String(text ?? ''),
      kind,
      rows: kind === 'rows' ? options.rows : null,
      pages,
      diagnostics,
      pageIndex: 0,
      // Left undefined unless the caller asked for one, so the band's dwell is
      // resolved when the page settles rather than frozen at enqueue. Snapshot
      // it here and changing a band's hold appears to do nothing until its
      // queue drains and refills.
      dwellMs: clampNumber(options.dwellMs, 0, 600000),
      source: options.source || 'api',
      region: this.regionId,
      priority,
      repeat: options.repeat === true,
      cycles: 0,
      // Kept so a re-layout can reproduce the caller's own alignment and
      // substitutions; without it a reconfigure silently reverts them.
      options: { ...options },
      enqueuedAt: Date.now(),
    };

    // Pre-empting: the displaced message goes back to the head of the queue so
    // it resumes on the page it was showing, rather than being lost or restarted.
    let interrupted = null;
    if (priority === 'now' && this.current) {
      interrupted = this.current;
      interrupted.resumed = true;
      this.current = null;
      this.cancelTimers();
      this.queue.unshift(interrupted);
    }

    if (priority === 'normal') this.queue.push(message);
    else this.queue.unshift(message);

    const index = priority === 'normal' ? this.queue.length - 1 : 0;
    const position = index + (this.current ? 1 : 0);

    this.pump();
    this.changed();

    return {
      id: message.id,
      pages: pages.length,
      diagnostics,
      position,
      estimatedMs: this.estimateMs(message),
      ...(interrupted
        ? { interrupted: { id: interrupted.id, resumesOnPage: interrupted.pageIndex + 1 } }
        : {}),
    };
  }

  /** Lay text out and report what would happen, without touching the board. */
  preview(text, options = {}) {
    const { pages, diagnostics } = this.layoutFor(text, options);
    return {
      pages,
      diagnostics,
      estimatedMs: this.estimateMs({ pages, dwellMs: options.dwellMs ?? this.opts.dwellMs }),
    };
  }

  /**
   * Re-lay a message for the current geometry, keeping its page cursor in range.
   *
   * The clamp is load-bearing: a pre-empted message sits in the queue with a
   * non-zero `pageIndex`, and a reflow that yields fewer pages would otherwise
   * leave it pointing past the end. `setRegionPage(undefined)` would then blank
   * the band rather than showing the message.
   */
  relayout(message) {
    const { pages, diagnostics } = this.layoutFor(message.text, message.options ?? {});
    message.pages = pages;
    message.diagnostics = diagnostics;
    message.pageIndex = Math.max(0, Math.min(message.pageIndex, pages.length - 1));
  }

  /**
   * Re-lay everything for a changed band height and snap the board to it.
   * Pages computed for six rows are meaningless in two.
   */
  reflow() {
    if (this.current) {
      this.relayout(this.current);
      this.show(this.current.pages[this.current.pageIndex], { immediate: true });
      // An immediate page stops the animation without reporting a settle, so
      // the hold has to be restarted by hand or playback wedges here.
      this.handleSettled();
    } else if (this.holding) {
      // A drained band keeps its last page. Re-lay it for the new geometry
      // rather than blanking something somebody deliberately left standing -
      // otherwise nudging any grid control wipes a standing strip.
      this.relayout(this.holding);
      this.show(this.holding.pages[this.holding.pageIndex], { immediate: true });
    } else {
      this.show([], { immediate: true });
    }
    for (const message of this.queue) this.relayout(message);
  }

  estimateMs(message) {
    const perPage = estimatePageMs(this.board.states, this.board.opts);
    return Math.round(message.pages.length * (perPage + (message.dwellMs ?? this.opts.dwellMs)));
  }

  /** Drop everything not yet started. The current message keeps playing. */
  flush() {
    const removed = this.queue.length;
    this.queue = [];
    this.changed();
    return removed;
  }

  /** Stop everything and blank this band. */
  clear() {
    const removed = this.queue.length + (this.current ? 1 : 0);
    this.queue = [];
    this.current = null;
    this.holding = null; // the glass is about to be blank, so nothing is held
    this.cancelTimers();
    this.show([]);
    this.changed();
    return removed;
  }

  /* ---- playback ---- */

  show(lines, options) {
    this.board.setRegionPage(this.regionId, lines, options);
  }

  pump() {
    if (this.current || this.queue.length === 0) return;
    this.current = this.queue.shift();
    this.current.startedAt = Date.now();
    this.showCurrentPage();
  }

  showCurrentPage() {
    const message = this.current;
    if (!message) return;
    this.cancelTimers();
    this.show(message.pages[message.pageIndex]);
    if (this.board.isAnimating(this.regionId)) {
      // The band may never report settling if the renderer is interrupted;
      // don't let a message wedge the queue forever.
      this.settleGuard = setTimeout(() => this.handleSettled(), this.opts.settleTimeoutMs);
    } else {
      // Nothing needed to move, so no settle callback is coming.
      this.handleSettled();
    }
    this.changed();
  }

  handleSettled() {
    // Clear both: this can be reached from a band idle, from a page that needed
    // no movement, or from a reflow, and a stale dwell timer would double up.
    this.cancelTimers();
    if (!this.current) {
      this.changed();
      return;
    }
    const dwell = this.current.dwellMs ?? this.opts.dwellMs;
    this.timer = setTimeout(() => this.advance(), dwell);
    this.changed();
  }

  advance() {
    this.timer = null;
    const message = this.current;
    if (!message) return;

    if (message.pageIndex + 1 < message.pages.length) {
      message.pageIndex += 1;
      this.showCurrentPage();
      return;
    }

    this.current = null;
    // Recycle *before* pumping: with one repeating message and nothing else
    // waiting, pumping first would find an empty queue and leave the band idle
    // for a turn.
    if (message.repeat) this.recycle(message);
    else this.holding = message; // its last page stays on the glass
    if (this.queue.length > 0) this.pump();
    this.changed();
  }

  /**
   * Send a finished repeating message back to the end of its own band's queue.
   *
   * Deliberately skips the `maxQueue` check: over a full cycle a recycle is
   * length-neutral - the message left the queue when it was pumped and returns
   * when it finishes - so it cannot grow the queue past a size it already
   * reached. Refusing here could only break a cycle that was already legal, at
   * exactly the moment the band is busiest.
   *
   * The message keeps its id. That is the point: a cycling band is the same
   * few messages going round, not a stream of copies, so anything watching the
   * queue sees a stable list rather than rows appearing and vanishing.
   */
  recycle(message) {
    message.pageIndex = 0;
    // Jumping the queue describes how a message arrived, not a standing
    // property of it - otherwise one `now` would pre-empt the board forever.
    message.priority = 'normal';
    message.startedAt = undefined;
    message.cycles += 1;
    delete message.resumed;
    this.queue.push(message);
  }

  cancelTimers() {
    if (this.timer) clearTimeout(this.timer);
    if (this.settleGuard) clearTimeout(this.settleGuard);
    this.timer = null;
    this.settleGuard = null;
  }

  /* ---- introspection ---- */

  status() {
    return {
      rows: this.height,
      // Where the band sits on the board, so anything listing bands can put
      // them in the order they physically appear rather than guessing.
      top: this.board.region(this.regionId)?.top ?? 0,
      dwellMs: this.opts.dwellMs,
      animating: this.board.isAnimating(this.regionId),
      showing: this.current
        ? {
            id: this.current.id,
            text: this.current.text,
            page: this.current.pageIndex + 1,
            pages: this.current.pages.length,
            source: this.current.source,
            startedAt: this.current.startedAt,
            ...repeatFields(this.current),
          }
        : null,
      // Only meaningful when nothing is playing; while a message is showing,
      // `showing` already describes the glass.
      holding:
        !this.current && this.holding
          ? {
              id: this.holding.id,
              text: this.holding.text,
              page: this.holding.pageIndex + 1,
              pages: this.holding.pages.length,
              source: this.holding.source,
            }
          : null,
      queue: {
        length: this.queue.length,
        items: this.queue.map((message, index) => ({
          id: message.id,
          text: message.text,
          pages: message.pages.length,
          source: message.source,
          position: index + 1,
          // Only interesting when it isn't the default, so don't add noise.
          ...(message.priority && message.priority !== 'normal'
            ? { priority: message.priority }
            : {}),
          ...(message.resumed ? { resumesOnPage: message.pageIndex + 1 } : {}),
          ...repeatFields(message),
        })),
      },
    };
  }

  changed() {
    if (this.onChange) this.onChange();
  }
}

/** Cycling detail, omitted entirely on the ordinary play-once message. */
function repeatFields(message) {
  return {
    ...(message.repeat ? { repeat: true } : {}),
    ...(message.cycles ? { cycles: message.cycles } : {}),
  };
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.min(max, Math.max(min, number));
}
