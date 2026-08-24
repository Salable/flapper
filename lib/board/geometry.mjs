/**
 * How many cards fit.
 *
 * A board used to be an arbitrary grid: pick 20 columns and 8 rows and find
 * out on the wall whether that suited the screen. But the two are not
 * independent - a screen has a shape, a card has a shape, and between them
 * they decide the grid. With square cards a board that fills its screen has
 * `rows = cols / (screenW / screenH)`: twenty across on 16:9 is eleven down,
 * and twenty across on a portrait 9:16 panel is thirty-six.
 *
 * Cards are square today (the renderer's whole card cache is `size × size`),
 * so `cardAspect` is here for the day they are not, and defaults to 1.
 */

/** The grid limits the config validator and the sliders agree on. */
export const MAX_COLS = 80;
export const MAX_ROWS = 40;

/**
 * Rows that fill a screen of this shape at `cols` cards across.
 *
 * @param {number} cols cards across
 * @param {number} screenW screen width, in any unit
 * @param {number} screenH screen height, in the same unit
 * @param {number} [cardAspect] card height / card width; 1 is square
 * @returns {number} cards down, clamped to the grid's limits
 */
export function rowsThatFit(cols, screenW, screenH, cardAspect = 1) {
  const across = Number(cols);
  const w = Number(screenW);
  const h = Number(screenH);
  const card = Number(cardAspect);
  if (!Number.isFinite(across) || across <= 0) return 1;
  if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) return 1;
  if (!Number.isFinite(card) || card <= 0) return 1;
  const screenAspect = w / h;
  return clampRows(Math.round(across / (screenAspect * card)));
}

/** Keep a row count inside what a board may have. */
export function clampRows(rows) {
  return Math.max(1, Math.min(MAX_ROWS, Math.round(Number(rows) || 1)));
}

/**
 * How a board of `cols × rows` sits in a region of a given shape: filling it,
 * or fitting one axis and leaving bands on the other.
 *
 * @returns {'exact' | 'bands-sides' | 'bands-top-bottom'}
 */
export function fitInRegion(cols, rows, regionW, regionH) {
  const board = Number(cols) / Number(rows);
  const region = Number(regionW) / Number(regionH);
  if (!Number.isFinite(board) || !Number.isFinite(region)) return 'exact';
  if (Math.abs(region - board) < 0.02) return 'exact';
  return region > board ? 'bands-sides' : 'bands-top-bottom';
}
