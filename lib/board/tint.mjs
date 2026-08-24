/**
 * Tint: a colour per cell, so the board can carry a wash across the grid.
 *
 * A real split-flap board has identical tiles, so this is deliberately
 * un-real - a pale rose corner fading to pale blue, or a photograph the board
 * approximates at twenty by eight. Both are the same thing: a colour for every
 * (row, col), sampled as the tile is drawn.
 *
 * It is stored as a formula, not as data. A gradient is two colours and an
 * angle - about sixty bytes - where the grid it produces would be one colour
 * per cell. Only a photograph needs the grid itself, and that arrives by
 * drawing the image into a cols x rows canvas and reading it back (the browser
 * does the downsampling, which is exactly the roughness wanted).
 *
 * The composite mode matters more than it looks. `overlay` leaves black black
 * and white white while colouring what is between them, so a design whose
 * glyph is pure black or pure white keeps a readable letter and only the card
 * face takes the hue - no need to cache the card and the glyph separately.
 */

/** Composite modes a tint may use, and what each is for. */
export const TINT_MODES = Object.freeze({
  /** Colours midtones, protects black and white. The default, and the one that keeps glyphs readable. */
  overlay: 'overlay',
  /** Washes everything toward the colour, glyph included. Muddier, occasionally what you want. */
  wash: 'source-over',
  /** Darkens. Good over a light card, ruinous over a dark one. */
  multiply: 'multiply',
  /** Lightens. The mirror of multiply. */
  screen: 'screen',
});

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#abc` or `#aabbcc` to `[r, g, b]`, or null. */
export function parseHex(value) {
  if (typeof value !== 'string' || !HEX.test(value.trim())) return null;
  let hex = value.trim().slice(1);
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Where a cell sits along a gradient's axis, 0 to 1.
 *
 * The axis is `angle` degrees clockwise from "left to right", so 0 runs across
 * the board, 90 runs down it, and 45 runs corner to corner. A single row or a
 * single column still has to land somewhere sensible, hence the guards.
 */
export function axisPosition(col, row, cols, rows, angleDeg) {
  const fx = cols > 1 ? col / (cols - 1) : 0.5;
  const fy = rows > 1 ? row / (rows - 1) : 0.5;
  const radians = ((Number(angleDeg) || 0) * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  // Project onto the axis, then map from the axis's own range back to 0..1 so
  // the two stops always land on opposite corners whatever the angle.
  const projected = fx * dx + fy * dy;
  const span = Math.abs(dx) + Math.abs(dy);
  const origin = Math.min(0, dx) + Math.min(0, dy);
  return span === 0 ? 0.5 : clamp01((projected - origin) / span);
}

/**
 * The colour grid a gradient produces: `rows * cols` entries of
 * `{ r, g, b }`, in row-major order, ready to index as `row * cols + col`.
 *
 * Interpolated in plain sRGB. Not perceptually even - a proper job would go
 * through oklab - but for two pastels a few steps apart the difference is not
 * visible on a board, and this stays pure and cheap.
 *
 * @param {{from?: string, to?: string, angle?: number}|null|undefined} gradient
 * @returns {Array<{r: number, g: number, b: number}>|null} null if unusable
 */
export function gradientGrid(gradient, cols, rows) {
  const from = parseHex(gradient?.from);
  const to = parseHex(gradient?.to);
  const across = Math.floor(Number(cols));
  const down = Math.floor(Number(rows));
  if (!from || !to) return null;
  if (!Number.isFinite(across) || !Number.isFinite(down) || across < 1 || down < 1) return null;

  const grid = new Array(across * down);
  for (let row = 0; row < down; row += 1) {
    for (let col = 0; col < across; col += 1) {
      const t = axisPosition(col, row, across, down, gradient.angle);
      grid[row * across + col] = {
        r: Math.round(from[0] + (to[0] - from[0]) * t),
        g: Math.round(from[1] + (to[1] - from[1]) * t),
        b: Math.round(from[2] + (to[2] - from[2]) * t),
      };
    }
  }
  return grid;
}

/**
 * A colour in each corner, blended across the grid.
 *
 * A two-stop gradient runs along one axis, so everything on a line square to it
 * is the same colour. Real sorbet is not like that - it is several fruits at
 * once, aqua in one corner and lemon in another and coral in a third - and no
 * single axis produces it. Four corners and a bilinear blend do, for the cost
 * of two more colours.
 *
 * @param {{tl?: string, tr?: string, bl?: string, br?: string}|null|undefined} corners
 * @returns {Array<{r: number, g: number, b: number}>|null} null if unusable
 */
export function cornersGrid(corners, cols, rows) {
  const tl = parseHex(corners?.tl);
  const tr = parseHex(corners?.tr);
  const bl = parseHex(corners?.bl);
  const br = parseHex(corners?.br);
  const across = Math.floor(Number(cols));
  const down = Math.floor(Number(rows));
  if (!tl || !tr || !bl || !br) return null;
  if (!Number.isFinite(across) || !Number.isFinite(down) || across < 1 || down < 1) return null;

  const grid = new Array(across * down);
  for (let row = 0; row < down; row += 1) {
    // A single row or column sits in the middle of its axis rather than at one
    // end, so a one-row board is not simply its top edge.
    const fy = down > 1 ? row / (down - 1) : 0.5;
    for (let col = 0; col < across; col += 1) {
      const fx = across > 1 ? col / (across - 1) : 0.5;
      const cell = { r: 0, g: 0, b: 0 };
      const channels = ['r', 'g', 'b'];
      for (let i = 0; i < 3; i += 1) {
        const top = tl[i] + (tr[i] - tl[i]) * fx;
        const bottom = bl[i] + (br[i] - bl[i]) * fx;
        cell[channels[i]] = Math.round(top + (bottom - top) * fy);
      }
      grid[row * across + col] = cell;
    }
  }
  return grid;
}

/**
 * The grid a tint spec produces for a given board, or null for no tint.
 *
 * Shaped so an image-derived grid drops into the same slot later: whatever
 * produces the array, the renderer only ever indexes it.
 */
export function tintGrid(tint, cols, rows) {
  if (!tint || typeof tint !== 'object') return null;
  if (tint.corners) return cornersGrid(tint.corners, cols, rows);
  if (tint.gradient) return gradientGrid(tint.gradient, cols, rows);
  return null;
}

/** The canvas composite mode a tint asks for, defaulting to the safe one. */
export function tintMode(tint) {
  const named = tint && typeof tint.mode === 'string' ? TINT_MODES[tint.mode] : undefined;
  return named ?? TINT_MODES.overlay;
}

/** How strongly a tint applies, 0 to 1. */
export function tintStrength(tint) {
  const value = Number(tint?.strength);
  return Number.isFinite(value) ? clamp01(value) : 1;
}
