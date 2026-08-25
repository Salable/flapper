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
const MAX_COLS = 80;
export const MAX_ROWS = 40;

/**
 * How big a card is, as a share of the screen: cards across.
 *
 * All of this is scale. A board is drawn to fill whatever window it is in, so
 * nothing about the output depends on how big the glass physically is - only
 * on how many cards there are. That makes a real measurement a number with no
 * effect: two 16:9 screens of different sizes showing the same board look the
 * same, one just bigger. So a card size is a fraction of the screen, and the
 * screen is a shape.
 */
const CARD_SIZES = {
  huge: 8,
  large: 12,
  medium: 20,
  small: 32,
  tiny: 48,
};

/** The order they are offered in, biggest card first. */
export const CARD_SIZE_IDS = ['huge', 'large', 'medium', 'small', 'tiny'];

/** The shape a board is designed for when nobody has said otherwise. */
const DEFAULT_SCREEN = { w: 16, h: 9 };
const DEFAULT_CARD_SIZE = 'medium';

/** Cards across, for a size name. */
function colsForCardSize(size) {
  return CARD_SIZES[String(size)] ?? CARD_SIZES[DEFAULT_CARD_SIZE];
}

/**
 * The grid a card size makes on a screen of a given shape.
 *
 * The only way anything gets a column or row count. Cards across comes from
 * the size; cards down is whatever keeps them square on that shape. A 15:1
 * ticker and a 16:9 wall both work, because the shape is any two numbers.
 *
 * @param {string} [size] a key of CARD_SIZES
 * @param {{w: number, h: number}} [screen]
 * @param {number} [cardAspect] card height / card width; 1 is square
 * @returns {{cols: number, rows: number}}
 */
export function gridFor(size = DEFAULT_CARD_SIZE, screen = DEFAULT_SCREEN, cardAspect = 1) {
  const cols = Math.max(1, Math.min(MAX_COLS, colsForCardSize(size)));
  return { cols, rows: rowsThatFit(cols, screen?.w, screen?.h, cardAspect) };
}

/**
 * Rows that keep the cards square on a screen of this shape.
 *
 * With square cards a board that fills its screen has
 * `rows = cols / (screenW / screenH)`: twenty across on 16:9 is eleven down,
 * and twenty across on a portrait 9:16 panel is thirty-six.
 *
 * @param {number} cols cards across
 * @param {number} screenW the screen's width, in any unit
 * @param {number} screenH its height, in the same unit
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
  return clampRows(Math.round(across / ((w / h) * card)));
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

/**
 * A board's grid, from the board's own config.
 *
 * The only way anything gets a column or row count. A board records how big
 * its screen is and how big its cards are; the grid is worked out here, every
 * time, and is never written down - so there is no stored number to go stale,
 * disagree with the screen, or survive a template it came from.
 */
export function gridForConfig(config = {}) {
  return gridFor(config?.cardSize, config?.screen);
}

/**
 * A screen as people say it: "16:9" for one bought by its shape, "300 x 20cm"
 * for one measured - saying 15:1 about a ticker is true and tells you nothing.
 */
export function screenLabel(screen) {
  const { w, h } = reduced(screen);
  return `${trim(w)}:${trim(h)}`;
}

/**
 * A shape in its lowest terms, because a shape is a ratio and 300:20 is 15:1.
 *
 * Somebody giving the size of a ticker in centimetres and somebody giving its
 * proportions should land on the same board, and be told the same thing about
 * it - so what a screen is measured in never matters, only what it comes to.
 */
function reduced(screen) {
  const { w, h } = screenOf({ screen });
  // Whole numbers reduce exactly; anything else is scaled up until it does.
  const scale = Number.isInteger(w) && Number.isInteger(h) ? 1 : 100;
  const a = Math.round(w * scale);
  const b = Math.round(h * scale);
  const divisor = gcd(a, b) || 1;
  return { w: a / divisor, h: b / divisor };
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

/** A board's screen shape, filled in with the default where it says nothing. */
export function screenOf(config = {}) {
  const screen = config?.screen ?? {};
  return {
    w: Number(screen.w) > 0 ? Number(screen.w) : DEFAULT_SCREEN.w,
    h: Number(screen.h) > 0 ? Number(screen.h) : DEFAULT_SCREEN.h,
  };
}

/** The card size a board is on, filled in with the default. */
export function cardSizeOf(config = {}) {
  const size = String(config?.cardSize ?? '');
  return CARD_SIZE_IDS.includes(size) ? size : DEFAULT_CARD_SIZE;
}

function trim(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}
