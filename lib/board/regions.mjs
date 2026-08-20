/**
 * Row bands that partition the board.
 *
 * A board is one grid of tiles, but it can be divided into horizontal bands
 * that are driven independently - a rotating queue above, a standing "now
 * playing" strip below. This module owns the arithmetic for that split and
 * nothing else: it is pure, so the off-by-one that would silently corrupt half
 * the board is reachable by a test rather than only by eye.
 *
 * Bands are ordered top to bottom and always tile the grid exactly - no gaps,
 * no overlaps, heights summing to `rows`. Tiles are addressed row-major
 * (`index = row * cols + col`), so a band is the contiguous index range
 * `[start, end)`.
 */

export const MAIN = 'main';
export const FOOTER = 'footer';

/**
 * Resolve bands against a grid.
 *
 * Exactly one band omits `rows`; it absorbs the remainder and is guaranteed at
 * least one row, because it is the one the queue plays into. Fixed bands are
 * clamped to what is left rather than being allowed to squeeze it out, and a
 * band that resolves to zero rows is dropped entirely - so a board with no
 * footer is a one-band board, indistinguishable from a board that never had the
 * concept.
 *
 * @param {number} cols
 * @param {number} rows full physical grid height
 * @param {Array<{id: string, rows?: number}>} bands ordered top to bottom
 * @returns {Array<{id: string, top: number, height: number, start: number, end: number}>}
 */
export function resolveRegions(cols, rows, bands) {
  const width = Math.max(1, Math.floor(cols));
  const total = Math.max(1, Math.floor(rows));

  const flexIndex = bands.findIndex((band) => band.rows === undefined);
  if (flexIndex < 0) {
    throw new Error('resolveRegions needs exactly one band without a row count');
  }

  let fixed = 0;
  const heights = bands.map((band) => {
    if (band.rows === undefined) return 0;
    const want = Math.max(0, Math.floor(Number(band.rows)) || 0);
    // Never take the last row: the flexible band must keep somewhere to play.
    const height = Math.min(want, Math.max(0, total - 1 - fixed));
    fixed += height;
    return height;
  });
  heights[flexIndex] = total - fixed;

  const regions = [];
  let top = 0;
  for (let i = 0; i < bands.length; i += 1) {
    const height = heights[i];
    if (height <= 0) continue;
    regions.push({
      id: bands[i].id,
      top,
      height,
      start: top * width,
      end: (top + height) * width,
    });
    top += height;
  }
  return regions;
}

/** The two-band board: a queue above, a footer of `footerRows` below. */
export function footerLayout(cols, rows, footerRows) {
  return resolveRegions(cols, rows, [{ id: MAIN }, { id: FOOTER, rows: footerRows }]);
}

/**
 * A tile's position *within its band*, so the stagger sweep runs across the
 * band rather than inheriting a lead-in from the rows above it.
 */
export function regionCoords(index, cols, region) {
  const offset = index - region.start;
  return { row: Math.floor(offset / cols), col: offset % cols };
}

/**
 * Map a band's lines onto tile target states, band-relative and row-major.
 *
 * Always returns exactly `cols * region.height` entries whatever the input
 * looks like: short lines, missing lines, and a missing page all pad with
 * blanks rather than throwing.
 */
export function regionTargets(lines, region, cols, charToState, blank) {
  const source = Array.isArray(lines) ? lines : [];
  const targets = new Array(cols * region.height).fill(blank);
  for (let row = 0; row < region.height; row += 1) {
    const line = source[row] ?? '';
    for (let col = 0; col < cols; col += 1) {
      const state = charToState.get(line[col]);
      targets[row * cols + col] = state === undefined ? blank : state;
    }
  }
  return targets;
}

/**
 * Stitch each band's lines back into one full-height page, so the board can
 * still report what is physically on the glass.
 */
export function composeLines(regions, cols, linesFor) {
  const out = [];
  for (const region of regions) {
    const lines = linesFor(region) ?? [];
    for (let row = 0; row < region.height; row += 1) {
      out.push(String(lines[row] ?? '').padEnd(cols, ' ').slice(0, cols));
    }
  }
  return out;
}
