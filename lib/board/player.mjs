/**
 * The queue player: turns a passive display into a faithful renderer of its
 * board's server-side queue.
 *
 * The server owns what plays; this module owns *playing it well*. It keeps at
 * most one message inside the Controller at a time (the held last page masks
 * advance latency, so prefetching buys nothing and would let the local track
 * run ahead of the server), reports each completion with the epoch it was
 * given (advances are idempotent per play - mirrors both report, the server
 * counts once), and reconciles against snapshots whenever the server nudges.
 *
 * Transport is injected, so the whole state machine runs under `node --test`
 * against the stub board and a fake API.
 */

export class Player {
  /**
   * @param {import('./controller.mjs').Controller} controller
   * @param {object} board the Flipboard (for immediate held-page rendering)
   * @param {object} api {fetchQueue(), advance(itemId, epoch, error?)}
   * @param {object} [hooks] {onConfig(config), onNote(text)}
   */
  constructor(controller, board, api, hooks = {}) {
    this.controller = controller;
    this.board = board;
    this.api = api;
    this.hooks = hooks;

    /** What this display believes is on the glass: {id, updatedAt, localId, held}. */
    this.playing = null;
    this.epoch = -1;
    this.queueUpdatedAt = 0;
    /** Set by the panic key: stay blank until the queue actually changes. */
    this.panicked = null;
    this.stopped = false;

    controller.onMessageDone = (message) => {
      if (this.playing && !this.playing.held && message.id === this.playing.localId) {
        this.reportDone();
      }
    };
  }

  /** Initial load. Resolves with the first snapshot so the caller can greet. */
  async start() {
    return this.resync();
  }

  stop() {
    this.stopped = true;
    this.controller.onMessageDone = null;
  }

  /**
   * A nudge arrived. The payload lets an up-to-date display skip the refetch -
   * important when a fast loop turns every advance into a broadcast.
   */
  async onSync(params) {
    if (this.stopped) return null;
    if (
      params &&
      params.epoch === this.epoch &&
      params.queueUpdatedAt === this.queueUpdatedAt &&
      params.currentItemId === (this.playing?.id ?? null)
    ) {
      return null;
    }
    return this.resync();
  }

  onClear() {
    this.blank();
    // The snapshot moved (clear bumps the epoch); pull the truth so the next
    // append resumes cleanly.
    return this.resync();
  }

  panicBlank() {
    // Keyed on queue *content*, not the epoch: a looping queue advances (and
    // bumps the epoch) all by itself, and a panic the loop lifts within
    // seconds is no panic at all. Someone adding or editing a message is the
    // signal that the blank should end.
    this.panicked = { itemsKey: this.lastItemsKey ?? '' };
    this.blank();
  }

  /* ---- internals ---- */

  blank() {
    this.playing = null;
    this.controller.clear();
  }

  async resync() {
    let snapshot;
    try {
      snapshot = await this.api.fetchQueue();
    } catch (error) {
      this.hooks.onNote?.(`Could not reach the board service: ${error.message}`);
      return null;
    }
    if (this.stopped) return snapshot;

    this.epoch = snapshot.epoch;
    this.queueUpdatedAt = snapshot.queueUpdatedAt;
    this.lastItemsKey = itemsKey(snapshot.items);
    if (snapshot.config) this.hooks.onConfig?.(snapshot.config);

    // Panic holds the blank while the queue's *content* is unchanged - loop
    // playback alone must not lift it.
    if (this.panicked) {
      if (this.panicked.itemsKey === this.lastItemsKey) {
        return snapshot;
      }
      this.panicked = null;
    }

    const current =
      snapshot.items.find((item) => item.id === snapshot.currentItemId) ?? null;

    if (snapshot.currentState === 'playing' && current) {
      const unchanged =
        this.playing &&
        this.playing.id === current.id &&
        this.playing.updatedAt === current.updatedAt &&
        !this.playing.held;
      if (!unchanged) this.playItem(current);
    } else if (snapshot.currentState === 'holding' && current) {
      const alreadyShowing = this.playing && this.playing.id === current.id;
      // The tab that played the item to completion is already holding its last
      // page; only a fresh display needs to paint it.
      if (!alreadyShowing) this.showHeld(current);
      else this.playing.held = true;
    } else {
      // idle: cleared or never used - a blank glass.
      if (this.playing || snapshot.currentState === 'idle') this.blankIfShowing();
    }
    return snapshot;
  }

  blankIfShowing() {
    if (this.playing) this.blank();
  }

  playItem(item) {
    // Cutting over mid-item must not flash blank: a 'now' enqueue preempts
    // smoothly, and the flush drops the displaced message the Track would
    // otherwise replay (the server, not the Track, owns what comes next).
    const busy = Boolean(this.controller.status().showing);
    try {
      const { text, options } = playableOf(item);
      const result = this.controller.enqueue(text, {
        ...options,
        source: 'queue',
        ...(busy ? { priority: 'now' } : {}),
      });
      if (busy) this.controller.flush();
      this.playing = { id: item.id, updatedAt: item.updatedAt, localId: result.id, held: false };
    } catch (error) {
      // A poison item must not wedge the board: report it as played-with-error
      // and let the server skip it.
      this.hooks.onNote?.(`Skipping an unplayable message: ${error.message}`);
      this.playing = { id: item.id, updatedAt: item.updatedAt, localId: null, held: false };
      this.reportDone({ message: String(error.message || error) });
    }
  }

  /** A standing page from before this display loaded: paint it, no replay. */
  showHeld(item) {
    try {
      const { text, options } = playableOf(item);
      const { pages } = this.controller.preview(text, options);
      const lastPage = pages[pages.length - 1] ?? [];
      this.board.setRegionPage('main', lastPage, { immediate: true });
      this.playing = { id: item.id, updatedAt: item.updatedAt, localId: null, held: true };
      this.controller.changed();
    } catch (error) {
      this.hooks.onNote?.(`Could not render the held message: ${error.message}`);
    }
  }

  async reportDone(error) {
    const played = this.playing;
    if (!played) return;
    let result;
    try {
      result = await this.api.advance(played.id, this.epoch, error);
    } catch (cause) {
      // Transient network loss: the held page stands; the next nudge or
      // visibility resync converges us.
      this.hooks.onNote?.(`Could not report completion: ${cause.message}`);
      return;
    }
    if (this.stopped) return;
    this.epoch = result.epoch;
    // Track the write our own advance caused, so the nudge it broadcasts
    // reads as already-seen and skips a redundant refetch.
    if (result.queueUpdatedAt !== undefined) this.queueUpdatedAt = result.queueUpdatedAt;

    // Play what the server says is next - unless a concurrent resync already
    // put something newer on the glass while the advance was in flight.
    const stillOurs = !this.playing || this.playing.id === played.id;
    if (result.currentState === 'playing' && result.current && stillOurs) {
      this.playItem(result.current);
    } else if (result.currentState === 'holding') {
      // Our own last page is already on the glass.
      if (this.playing) this.playing.held = true;
    } else if (result.currentState === 'idle') {
      this.blank();
    }
  }
}

/** Order-insensitive fingerprint of what the queue contains. */
function itemsKey(items) {
  return items
    .map((item) => `${item.id}:${item.updatedAt}`)
    .sort()
    .join('|');
}

/** The controller-facing shape of a queue item's payload. */
function playableOf(item) {
  const payload = item.payload ?? {};
  const options = { ...(payload.options ?? {}) };
  if (Array.isArray(payload.rows)) options.rows = payload.rows;
  return { text: payload.text ?? '', options };
}
