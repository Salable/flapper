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

  function park(patch: Record<string, unknown>) {
    unpark();
    parked = {};
    for (const key of Object.keys(patch)) parked[key] = board.opts[key];
    board.setOptions(patch);
  }

  function unpark() {
    if (parked === null) return;
    board.setOptions(parked);
    parked = null;
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

  /** Is the board still showing exactly what this run last put there? */
  function untouched() {
    if (!run) return false;
    const now = board.page;
    if (!now) return false;
    const mine = rowsOf(run.shown, run.width, run.page.length);
    return now.length === mine.length && now.every((line: string, i: number) => line === mine[i]);
  }

  function begin() {
    if (!enabled || destroyed) return;
    const page = board.page;
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
    const next = spec.beats[run.beat];
    if (!next) {
      endRun(true);
      schedule();
      return;
    }
    if (run.beat > 0 && !untouched()) {
      endRun(false);
      schedule();
      return;
    }

    /*
     * A colour beat wants the card itself painted, so the board borrows a
     * baked set for exactly these cells - `cardWashCells` keeps the colour on
     * while the card sits, which is the part you actually look at. House and
     * origin beats want the design's own cards back.
     */
    if (next.kind === 'colour') {
      park({
        cardWash: [next.colour],
        cardWashGlyphs: false,
        cardWashCells: run.cells,
        shortestPath: true,
      });
    } else {
      park({ cardWash: null, cardWashCells: null, shortestPath: true });
    }

    const chars = [...run.shown];
    for (const index of run.cells) {
      chars[index] = next.kind === 'origin' ? run.was[index] : stepOn(chars[index]);
    }
    run.shown = chars.join('');
    board.setPage(rowsOf(run.shown, run.width, run.page.length));
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
    stop();
    if (destroyed) return;
    spec = fidgetById(id ?? null);
    enabled = Number.isFinite(everyMs) && everyMs > 0;
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
