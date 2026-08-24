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

/** The grid limits every door onto a board's geometry enforces. */
export const MAX_COLS = 80;
export const MAX_ROWS = 40;

/**
 * How big a card is, in millimetres.
 *
 * A real size, not a share of the screen. A card's job is to be read from
 * somewhere in the room, and that is a physical fact - so "large" has to mean
 * the same thing on a 32-inch monitor and on a stadium wall, and the number
 * that changes between them is how many fit. Expressing this as a column count
 * got it exactly backwards: it kept the grid constant and let the cards
 * stretch, so a bigger screen bought you bigger letters instead of more board.
 *
 * The steps are roughly a doubling apart, which is about the smallest
 * difference that reads as a different size across a room.
 */
const CARD_SIZES = {
  huge: 150,
  large: 100,
  medium: 60,
  small: 40,
  tiny: 25,
};

/** The order they are offered in, biggest card first. */
export const CARD_SIZE_IDS = ['huge', 'large', 'medium', 'small', 'tiny'];

/** What a board is designed for when nobody has said otherwise: a 55" 16:9 wall. */
export const DEFAULT_SCREEN = { w: 16, h: 9, diagonalIn: 55 };
export const DEFAULT_CARD_SIZE = 'medium';

/** Millimetres across a card, for a size name. */
export function cardSizeMm(size) {
  return CARD_SIZES[String(size)] ?? CARD_SIZES[DEFAULT_CARD_SIZE];
}

const MM_PER_INCH = 25.4;

/**
 * The physical size of a screen, from its diagonal and its shape.
 *
 * A diagonal is the one measurement anybody actually knows about a screen -
 * it is what is written on the box - and with the aspect ratio it gives the
 * width and height, which is what the cards have to fit into.
 *
 * @returns {{ widthMm: number, heightMm: number }}
 */
export function screenSizeMm(screen = DEFAULT_SCREEN) {
  const w = Number(screen?.w) > 0 ? Number(screen.w) : DEFAULT_SCREEN.w;
  const h = Number(screen?.h) > 0 ? Number(screen.h) : DEFAULT_SCREEN.h;
  const diagonalIn =
    Number(screen?.diagonalIn) > 0 ? Number(screen.diagonalIn) : DEFAULT_SCREEN.diagonalIn;
  // The diagonal splits into width and height by the aspect ratio: for a w:h
  // screen, the diagonal is sqrt(w^2 + h^2) in the same units.
  const diagonalUnits = Math.hypot(w, h);
  const mmPerUnit = (diagonalIn * MM_PER_INCH) / diagonalUnits;
  return { widthMm: w * mmPerUnit, heightMm: h * mmPerUnit };
}

/**
 * The grid a card size makes on a screen of a given size.
 *
 * The only way a board gets a column or row count. Both are consequences of
 * two things somebody actually knows - how big the screen is, and how big the
 * cards should be - so neither is ever typed, in a template, a config, or the
 * editor.
 *
 * @param {string} [size] a key of CARD_SIZES
 * @param {{w: number, h: number, diagonalIn: number}} [screen]
 * @param {number} [cardAspect] card height / card width; 1 is square
 * @returns {{cols: number, rows: number}}
 */
export function gridFor(size = DEFAULT_CARD_SIZE, screen = DEFAULT_SCREEN, cardAspect = 1) {
  const { widthMm, heightMm } = screenSizeMm(screen);
  const cardW = cardSizeMm(size);
  const aspect = Number(cardAspect) > 0 ? Number(cardAspect) : 1;
  const cardH = cardW * aspect;
  const cols = Math.max(1, Math.min(MAX_COLS, Math.floor(widthMm / cardW)));
  const rows = Math.max(1, Math.min(MAX_ROWS, Math.floor(heightMm / cardH)));
  return { cols, rows };
}

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
