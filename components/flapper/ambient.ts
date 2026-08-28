'use client';

/**
 * Ambient motion for a board holding still.
 *
 * A board standing on one message is dead in a way a real installation never
 * is: idle.mjs already models the alternative - mostly stillness, the
 * occasional tile misfiring to a wrong character and correcting itself all
 * the way round, and now and then a whole sweep. This wires that pure model
 * to an actual Flipboard on an interval - shared between the live display
 * (BoardApp) and a settings-page preview (ThemePreview), so a board fidgets
 * exactly the same way wherever it's being watched.
 *
 * It works on what is physically on the board (`board.page`) and puts it
 * back afterwards, and it only ever runs when nothing else is moving. The
 * restore is guarded: if anything else painted the board in the meantime the
 * flicker is abandoned rather than stamped over the top of whatever arrived,
 * which is the one way this could have hurt.
 */

import { idleAction, withFlicker, fidgetStyle } from '@/lib/board/idle.mjs';
import { traveller, travellerFrame, withTraveller, runLength } from '@/lib/board/travellers.mjs';

export function createAmbient(board: any) {
  /** Which fidget this board does. Set by `start`; classic until it is. */
  let style: any = fidgetStyle(null);
  let ambientTimer: ReturnType<typeof setInterval> | null = null;
  let restoreTimer: ReturnType<typeof setTimeout> | null = null;
  let ambientTick = 0;
  /** Put the words back, if a flicker is still showing. */
  let undoFlicker: (() => void) | null = null;
  /** Set once `destroy()` runs - a `start` racing in after must not arm a
   * timer against a board nobody owns any more. */
  let destroyed = false;
  /** Watches for the fast return to finish so the board's own speed comes
   * back. See `hurryHome` for why this cannot just be restored inline. */
  let settleTimer: ReturnType<typeof setInterval> | null = null;
  /** The board's own options, parked for the length of a fidget's gesture. */
  let parked: Record<string, unknown> | null = null;
  /** Frame timer for a traveller, and the page it must put back after. */
  let walkTimer: ReturnType<typeof setInterval> | null = null;
  let walkBase: string[] | null = null;

  /**
   * Stop a traveller mid-walk and put the board back where it found it.
   *
   * Guarded the same way a misfire's restore is: if something else has
   * painted since the last frame, the creature is abandoned rather than
   * stamped over whatever arrived.
   */
  function endWalk(restore = true) {
    if (walkTimer !== null) clearInterval(walkTimer);
    walkTimer = null;
    const base = walkBase;
    walkBase = null;
    if (restore && base) board.setPage(base);
  }

  /**
   * Put the board back on its own Travel speed, now.
   *
   * Idempotent, and safe to call from anywhere: the way out, a new `start`,
   * or the settle watcher noticing the return has landed.
   */
  function unhurry() {
    if (settleTimer !== null) clearInterval(settleTimer);
    settleTimer = null;
    if (parked !== null) {
      board.setOptions(parked);
      parked = null;
    }
  }

  /**
   * Make the journey home fast, and give it back afterwards.
   *
   * A tile only travels forward, so coming back from a one-step misfire is a
   * whole lap of the ring - at the board's own Travel speed that reads as a
   * full flip, the very thing a small tick was trying not to be. So a style
   * may ask for the return alone to hurry.
   *
   * It cannot simply be set and unset around `setPage`: `stepDuration` reads
   * `this.opts` afresh on every step (`flipboard.js`), so restoring inline
   * would put the board back on its own speed before the first frame and the
   * hurry would do nothing at all. It has to stay until the return lands,
   * which is what the watcher below is for.
   */
  function hurryHome(run: () => void, opts: { hurry?: boolean } = {}) {
    const patch: Record<string, unknown> = {};
    /*
     * Two legs, two speeds. The way out takes the style's own pace if it has
     * one; the way home may take a different one - a tick hurries back so a
     * small gesture stays small, a drink comes back as slowly as it went.
     */
    const outward = style.stepMs;
    const homeward = style.returnStepMs ?? style.stepMs;
    const chosen = opts.hurry ? homeward : outward;
    if (chosen !== null && chosen !== undefined) patch.fastStepMs = chosen;
    /*
     * A fidget is a mini flight, so it gets to say what colours the card
     * passes through on the way. `flipboard.js` reads `opts.flight` ahead of
     * the skin's, which is what makes this a loan rather than a change: the
     * design's own flight comes back the moment the gesture lands.
     */
    if (style.flight) {
      patch.flight = style.flight;
      patch.flightStrength = style.flightStrength;
    }
    // The way home may go unpainted - see `washOutboundOnly`.
    if (style.cardWash && !(opts.hurry && style.washOutboundOnly)) {
      patch.cardWash = style.cardWash;
    } else if (style.cardWash) {
      patch.cardWash = null;
    }
    if (style.shortestPath) patch.shortestPath = true;
    if (Object.keys(patch).length === 0) {
      run();
      return;
    }
    unhurry();
    parked = {};
    for (const key of Object.keys(patch)) parked[key] = board.opts[key];
    board.setOptions(patch);
    run();
    settleTimer = setInterval(() => {
      if (board.isAnimating()) return;
      unhurry();
    }, 50);
  }

  /*
   * `restore` is false on the way out.
   *
   * Doing the restore matters when the board carries on living - a sync
   * nudge lands inside the flicker window and would otherwise strand the
   * deliberately-wrong character. It is wrong when the board is being
   * discarded: setPage on a board nobody owns any more starts a fresh frame
   * loop against an orphaned canvas.
   */
  function stop(restore = true) {
    if (ambientTimer !== null) clearInterval(ambientTimer);
    if (restoreTimer !== null) clearTimeout(restoreTimer);
    endWalk(restore);
    // Before the restore below, so a board handed back mid-hurry is handed
    // back on its own Travel speed rather than a fidget's.
    unhurry();
    ambientTimer = null;
    restoreTimer = null;
    const undo = undoFlicker;
    undoFlicker = null;
    if (restore) undo?.();
  }

  /** Off unless a board asks for it - a wall in an office should not clack
   * once a minute all night because a default said so. */
  function start(everyMs: number, styleId?: string | null) {
    stop();
    style = fidgetStyle(styleId ?? null);
    if (destroyed) return;
    if (!Number.isFinite(everyMs) || everyMs < 5000) return;
    ambientTimer = setInterval(() => {
      // A creature already walking is the fidget; do not start a second one.
      if (walkTimer !== null) return;
      if (board.isAnimating() || restoreTimer !== null) return;
      const page = board.page;
      if (!page || page.every((line: string) => line.trim() === '')) return;
      ambientTick += 1;
      /*
       * Flat, not newline-joined. A page is rows of exactly `cols`
       * characters, so index/cols and index%cols put a character back where
       * it came from - whereas joining on newlines puts separators into the
       * pool idleAction picks from, and it only skips spaces. On a board
       * holding a short message the separators outnumber the letters, so
       * more than half of all flickers landed on one, `split` came back a
       * row short, and the restore guard could not match a page with the
       * wrong number of rows. The board simply shifted up and stayed there.
       */
      const width = page[0]?.length ?? 0;
      if (width === 0 || page.some((line: string) => line.length !== width)) return;
      const flat = page.join('');
      const action = idleAction(flat, board.charset, ambientTick, style);
      if (action.kind === 'travel') {
        walk(page, width, flat, action.traveller);
        return;
      }
      if (action.kind === 'sweep') {
        // Restore whatever the board was set to, not a hard-coded false: a
        // board configured to always flip would have quietly lost it.
        const wasAlwaysFlip = board.opts.alwaysFlip;
        board.setOptions({ alwaysFlip: true });
        board.setPage(page);
        board.setOptions({ alwaysFlip: wasAlwaysFlip });
        return;
      }
      if (action.kind !== 'flicker') return;
      const changed = withFlicker(flat, action);
      const flickered = page.map((_: string, row: number) => changed.slice(row * width, (row + 1) * width));
      hurryHome(() => board.setPage(flickered));
      const restore = () => {
        // Only if nothing else has painted since. A message that arrived
        // mid-flicker must not be replaced by the words it interrupted.
        const now = board.page;
        if (!now || now.join('\u0000') !== flickered.join('\u0000')) return;
        hurryHome(() => board.setPage(page), { hurry: true });
      };
      undoFlicker = restore;
      restoreTimer = setTimeout(() => {
        restoreTimer = null;
        undoFlicker = null;
        restore();
      }, style.holdMs);
    }, everyMs);
  }

  /**
   * Walk a creature once round the board.
   *
   * Its own interval, because the ambient one is measured in seconds and a
   * snake moves in frames. Each frame paints the standing page with only the
   * creature's cells overwritten, so the board restores itself behind it
   * with no bookkeeping - the cells it has left simply stop being in the
   * frame. The colours it flies are borrowed for the whole walk and handed
   * back at the end, the same loan a misfire takes.
   */
  function walk(page: string[], width: number, flat: string, name: string) {
    const spec = traveller(name);
    if (!spec) return;
    const rows = page.length;
    const total = runLength(spec, width, rows);
    if (total === 0) return;

    walkBase = page;
    let frame = 0;
    let last = flat;

    const patch: Record<string, unknown> = { fastStepMs: Math.min(board.opts.fastStepMs, 30) };
    if (style.shortestPath) patch.shortestPath = true;
    if (style.cardWash) patch.cardWash = style.cardWash;
    if (style.flight) {
      patch.flight = style.flight;
      patch.flightStrength = style.flightStrength;
    }
    unhurry();
    parked = {};
    for (const key of Object.keys(patch)) parked[key] = board.opts[key];
    board.setOptions(patch);

    walkTimer = setInterval(() => {
      // Something else painted the board - the creature gives way rather
      // than fighting a message that has arrived.
      const now = board.page;
      if (!now || now.join('\u0000') !== rowsOf(last, width, rows).join('\u0000')) {
        walkBase = null;
        endWalk(false);
        unhurry();
        return;
      }
      if (frame >= total) {
        endWalk();
        unhurry();
        return;
      }
      const cells = travellerFrame(spec, width, rows, frame);
      last = withTraveller(flat, cells);
      board.setPage(rowsOf(last, width, rows));
      frame += 1;
    }, spec.stepMs);
  }

  /** A flat page back into its rows. */
  function rowsOf(flat: string, width: number, rows: number) {
    const out: string[] = [];
    for (let row = 0; row < rows; row += 1) out.push(flat.slice(row * width, (row + 1) * width));
    return out;
  }

  /** For the way out. Not the restore - see `stop`'s own note. */
  function destroy() {
    destroyed = true;
    stop(false);
  }

  return { start, stop, destroy };
}
