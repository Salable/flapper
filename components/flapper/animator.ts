import { animation, animationFrame, animationRunLength } from '@/lib/board/animations.mjs';

/**
 * The animation runner: frames onto the glass, for as long as one is showing.
 *
 * Deliberately not part of the Controller. An animation slide is an ordinary
 * queue item with no text and its own dwell, so playback already knows what
 * to do with it - hold a blank page for that long. This paints over that
 * hold, the same relationship `ambient.ts` has to a held message, and the
 * same borrow-and-return dance with the board's options.
 *
 * What an animation looks like lives in lib/board/animations.mjs, which is
 * pure and tested. This owns only the clock: when to ask for a frame, and
 * when to give the board back.
 */
export function createAnimator(board: any) {
  let spec: any = null;
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  /** The board's own options, parked for the length of a run - see ambient's
   * own note: remembering only the first value of each key keeps the
   * borrowing accumulative and the board's own values intact. */
  let parked: Record<string, unknown> | null = null;

  function park(patch: Record<string, unknown>) {
    if (parked === null) parked = {};
    for (const key of Object.keys(patch)) {
      if (!(key in parked)) parked[key] = board.opts[key];
    }
    board.setOptions(patch);
  }

  function unpark() {
    if (parked === null) return;
    board.setOptions(parked);
    parked = null;
  }

  function blankPage() {
    const cols = Number(board.opts?.cols) || 0;
    const rows = Number(board.opts?.rows) || 0;
    return Array.from({ length: rows }, () => ' '.repeat(cols));
  }

  function paint() {
    if (!spec || destroyed) return;
    const cols = Number(board.opts?.cols) || 0;
    const rows = Number(board.opts?.rows) || 0;
    const cells = animationFrame(spec, cols, rows, frame);

    /*
     * The whole frame in one option write. `cardWashCells` takes {index,
     * colour} entries (see flipboard's own note), so a frame is exactly this
     * array - no per-cell calls, and no page flip: an animation is colour,
     * and the cards underneath it stay blank and still.
     */
    park({ cardWash: ['#000000'], cardWashGlyphs: false, cardWashCells: cells });
    board.draw();

    frame += 1;
    /*
     * A finite run starts again rather than stopping.
     *
     * An animation is shown for its item's own dwell, like any other slide,
     * and those two lengths have nothing to do with each other - an
     * explosion is about a second, a slide is often a minute. Ending on the
     * last frame left the board blank for the rest of it, which reads as a
     * broken wall rather than a finished animation. Looping is also what
     * anybody would expect of the bouncing logo, which never ends at all.
     */
    const length = animationRunLength(spec, cols, rows);
    if (Number.isFinite(length) && frame >= length) frame = 0;
    timer = setTimeout(paint, spec.frameMs);
  }

  /** Start (or restart) `name`. An unknown name is a no-op, not a throw:
   * a board showing an animation this build has never heard of should keep
   * playing rather than go dark. */
  function start(name: string) {
    if (destroyed) return false;
    const next = animation(name);
    if (!next) {
      // Whatever is running now is not what the board has been told to
      // show, so it stops either way. Returning early *before* stopping
      // left the previous animation painting over the new item, with the
      // caller's fallback starting the fidget on top of it.
      stop();
      return false;
    }
    stop();
    spec = next;
    frame = 0;
    board.setPage(blankPage());
    paint();
    return true;
  }

  function stop() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    spec = null;
    frame = 0;
    unpark();
  }

  function destroy() {
    destroyed = true;
    stop();
  }

  return { start, stop, destroy, showing: () => (spec ? spec.id : null) };
}
