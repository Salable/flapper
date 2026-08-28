'use client';

/**
 * Running a fidget against a real board.
 *
 * `lib/board/fidgets.mjs` says what a fidget *is* - four numbers and a list
 * of beats. This puts one on the glass: it picks the cards, walks the list,
 * and puts the board back exactly as it found it.
 *
 * Three things it will not do, all of them learned the hard way:
 *
 *  - It never runs on a blank board, and never paints over something that
 *    arrived while it was mid-gesture. A message beats a fidget every time,
 *    so the run is abandoned rather than stamped on top of it.
 *  - It never leaves the board wearing something it borrowed. Every option a
 *    beat sets is parked first and handed back when the run ends, however it
 *    ends - finished, abandoned, or the board torn down underneath it.
 *  - It decides nothing about *how* a card gets anywhere. One ring step per
 *    beat, shortest way home, and the author never sees it. Direction and
 *    step timing were fields in the first model, and between them they caused
 *    the only real bug it had.
 */

import { fidgetById, nextGapMs, pickCells, runMs } from '@/lib/board/fidgets.mjs';
import { MAIN } from '@/lib/board/regions.mjs';

export function createAmbient(board: any) {
  let spec: any = fidgetById(null);
  let enabled = false;
  let tick = 0;
  let gapTimer: ReturnType<typeof setTimeout> | null = null;
  let beatTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  /** The board's own options, parked for the length of a run. */
  let parked: Record<string, unknown> | null = null;
  /** The run in progress: what the board said before it, and where it is. */
  let run: {
    page: string[];
    width: number;
    was: string;
    shown: string;
    cells: number[];
    beat: number;
  } | null = null;

  /** The ring, in order, so a beat can advance a card one position. */
  const ring: string[] = [...(board.charset ?? [])];

  const rowsOf = (flat: string, width: number, rows: number) => {
    const out: string[] = [];
    for (let row = 0; row < rows; row += 1) out.push(flat.slice(row * width, (row + 1) * width));
    return out;
  };

  /** One position along the ring - the cheapest move a card can make. */
  const stepOn = (char: string) => {
    if (ring.length === 0) return char;
    const at = ring.indexOf(char);
    return at < 0 ? char : ring[(at + 1) % ring.length];
  };

  /**
   * Borrow options, remembering the board's own the first time each is taken.
   *
   * It used to hand everything back before taking it again on every beat,
   * which was correct and expensive: `cardWash` going null and straight back
   * threw away the board's baked card set and rebuilt all forty-two of them,
   * twice a beat. A three-beat colour gesture allocated a hundred and
   * twenty-six canvases every fourteen seconds, forever.
   *
   * Remembering only the first value of each key keeps the run's borrowing
   * accumulative and the board's own values intact, and lets a beat set the
   * same wash it already had without touching the cache at all.
   */
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

  /**
   * Let a card take the short way round, for this paint and no longer.
   *
   * `shortestPath` cannot be parked for the length of a beat the way the wash
   * is, because it is not read while a tile flies - it is read once, when a
   * target is set, and written into that tile as a direction it then keeps
   * for its whole journey. Leaving the option on for the rest of the beat
   * therefore does nothing for the fidget and everything to whatever else
   * paints in the meantime: a message arriving mid-beat had about half its
   * tiles flip in backwards, and handing the option back afterwards could not
   * undo it, because the direction was already on the tiles.
   *
   * So it is on for exactly the one `setPage` that wants it.
   */
  function withShortestPath(paint: () => void) {
    const was = board.opts.shortestPath;
    board.setOptions({ shortestPath: true });
    try {
      paint();
    } finally {
      board.setOptions({ shortestPath: was });
    }
  }

  /**
   * End the run.
   *
   * `restore` is false only when the board is being discarded or something
   * else has already painted: putting a page back on a board nobody owns any
   * more starts a frame loop against an orphaned canvas, and putting one over
   * a message that has arrived is the one way a fidget could actually hurt.
   *
   * The page goes back with no animation. A run that wants its journey home
   * watched says so by ending on an `origin` beat.
   */
  function endRun(restore: boolean) {
    if (beatTimer !== null) clearTimeout(beatTimer);
    beatTimer = null;
    if (restore && run) board.setPage(run.page, { immediate: true });
    run = null;
    unpark();
  }

  function schedule() {
    if (!enabled || destroyed) return;
    if (gapTimer !== null) clearTimeout(gapTimer);
    tick += 1;
    gapTimer = setTimeout(begin, nextGapMs(spec, tick));
  }

  /**
   * The band a fidget lives in.
   *
   * The main one, and only the main one. `board.page` stitches every band
   * together but `board.setPage` writes the main band alone, so reading the
   * whole board and indexing into it meant that on a board with a footer, a
   * cell could be picked in the footer, mutated in the run's own copy, never
   * actually written - and then the next comparison would find the board
   * "touched", abandon the run, and leave the main-band cells it *had*
   * stepped permanently wrong on the glass. A footer repaint would abort an
   * innocent run for the same reason.
   *
   * Latent today, because the display forces `footerRows: 0`. Multi-band
   * boards are a documented future release and this would have been waiting
   * for them.
   */
  const bandPage = (): string[] | null =>
    typeof board.regionPage === 'function' ? board.regionPage(MAIN) : board.page;

  /** Is the band still showing exactly what this run last put there? */
  function untouched() {
    if (!run) return false;
    const now = bandPage();
    if (!now) return false;
    const mine = rowsOf(run.shown, run.width, run.page.length);
    return now.length === mine.length && now.every((line: string, i: number) => line === mine[i]);
  }

  function begin() {
    if (!enabled || destroyed) return;
    const page = bandPage();
    const width = page?.[0]?.length ?? 0;
    // Nothing to fidget on, an uneven page, or something already moving: wait
    // for the next gap rather than forcing it.
    if (
      !page ||
      width === 0 ||
      page.some((line: string) => line.length !== width) ||
      page.every((line: string) => line.trim() === '') ||
      board.isAnimating()
    ) {
      schedule();
      return;
    }
    const flat = page.join('');
    const cells: number[] = pickCells(spec, flat.length, tick);
    if (cells.length === 0) {
      schedule();
      return;
    }
    run = { page, width, was: flat, shown: flat, cells, beat: 0 };
    beat();
  }

  function beat() {
    if (!run || destroyed) return;
    /*
     * The guard comes first, and covers the end of the list as well as the
     * middle of it.
     *
     * It used to sit below the `!next` branch, so the final beat restored the
     * page unconditionally - and for the whole of that last beat (up to
     * 900ms) a message landing on the board was stamped over by the page the
     * fidget had memorised before it started. Instantly, with no flip, and
     * nothing re-sends it: the wall would show the *previous* message until
     * the next queue event. Painting over an arriving message is the one way
     * a fidget can actually hurt, and this was the only path to it.
     */
    if (run.beat > 0 && !untouched()) {
      endRun(false);
      schedule();
      return;
    }
    const next = spec.beats[run.beat];
    if (!next) {
      endRun(true);
      schedule();
      return;
    }

    /*
     * A colour beat wants the card itself painted, so the board borrows a
     * baked set for exactly these cells - `cardWashCells` keeps the colour on
     * while the card sits, which is the part you actually look at. House and
     * origin beats want the design's own cards back.
     *
     * Only what has to last the beat is parked. See `withShortestPath` for
     * the one that must not.
     */
    if (next.kind === 'colour') {
      park({ cardWash: [next.colour], cardWashGlyphs: false, cardWashCells: run.cells });
    } else {
      park({ cardWash: null, cardWashCells: null });
    }

    const chars = [...run.shown];
    for (const index of run.cells) {
      chars[index] = next.kind === 'origin' ? run.was[index] : stepOn(chars[index]);
    }
    run.shown = chars.join('');
    // Read out before the closure: `run` is nulled by endRun on other paths,
    // and the narrowing does not survive into a callback.
    const lines = rowsOf(run.shown, run.width, run.page.length);
    withShortestPath(() => board.setPage(lines));
    run.beat += 1;
    beatTimer = setTimeout(beat, spec.beatMs);
  }

  /**
   * @param everyMs the board's Fidget setting. How often is the fidget's own
   *   business now, so this is only ever on or off - 0 is off, which is what
   *   a wall in an office should be unless somebody asked otherwise.
   * @param id which fidget
   */
  function start(everyMs: number, id?: string | null) {
    if (destroyed) return;
    const wanted = fidgetById(id ?? null);
    const on = Number.isFinite(everyMs) && everyMs > 0;
    /*
     * Idempotent, and it has to be.
     *
     * This is called from the display's `onConfig`, which fires on every
     * resync - and a resync happens on every queue advance. Restarting
     * unconditionally re-armed the gap timer from zero each time, so a board
     * with a lively queue nudged itself more often than the fidget's own
     * interval and the thing simply never fired. It also killed any run
     * already in flight, mid-gesture.
     */
    if (on && enabled && wanted === spec) return;
    stop();
    spec = wanted;
    enabled = on;
    if (!enabled) return;
    schedule();
  }

  function stop(restore = true) {
    if (gapTimer !== null) clearTimeout(gapTimer);
    gapTimer = null;
    enabled = false;
    endRun(restore && run !== null && untouched());
    unpark();
  }

  function destroy() {
    destroyed = true;
    stop(false);
  }

  return { start, stop, destroy, runMs: () => runMs(spec) };
}
