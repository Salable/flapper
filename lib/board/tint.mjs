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

/**
 * The colours a tile passes through on its way somewhere.
 *
 * A tile only moves forward round the ring, so Z to A is thirty-odd steps and B
 * to C is one. That unevenness is the thing worth watching, and it can be made
 * visible: give the states a repeating pattern of colours and a tile going a
 * long way riffles through them while a tile going one step barely flickers.
 *
 * The pattern applies *only in flight*. A landed tile is always the design's
 * own card, so a green board is a green board at rest and the colour is
 * something you only catch while it is moving. That is the whole difference
 * between this and a per-state override, which would colour the letters
 * themselves and leave a resting board looking like a bag of sweets.
 *
 * `null` in the sequence means the base card, which is how "every fifth one is
 * amber" is written: four nulls and a colour.
 *
 * @param {Array<string|null>|null|undefined} flight
 * @param {number} state the ring index the tile is passing through
 * @returns {{r: number, g: number, b: number}|null}
 */
/**
 * A flight pattern that ramps smoothly through `stops`, one colour per step.
 *
 * `flightColour` indexes by the tile's *ring state*, so a short array cycles
 * fast: two colours over a 42-state ring strobe on alternate steps rather
 * than reading as a colour. Ramped to the ring's full length instead, a tile
 * moves through the stops in order as it travels, and tiles at different
 * points in their own flip show different shades at the same moment - which
 * is what makes a creature spread over several cards read as a gradient
 * rather than a flat block.
 *
 * @param {string[]} stops two or more #rgb/#rrggbb colours, in order
 * @param {number} length how many ring steps to spread them over
 * @returns {string[]} `length` colours, or [] if the stops cannot be read
 */
export function rampFlight(stops, length) {
  const rgbs = (Array.isArray(stops) ? stops : []).map(parseHex).filter(Boolean);
  if (rgbs.length === 0 || !Number.isFinite(length) || length < 1) return [];
  if (rgbs.length === 1) return Array.from({ length }, () => hex(rgbs[0]));
  const out = [];
  for (let step = 0; step < length; step += 1) {
    // Where this step falls across the whole ramp, in stop-index space.
    const at = (step / length) * (rgbs.length - 1);
    const lower = Math.min(rgbs.length - 2, Math.floor(at));
    const t = at - lower;
    const a = rgbs[lower];
    const b = rgbs[lower + 1];
    out.push(hex([
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t),
    ]));
  }
  return out;
}

/** [r,g,b] back to #rrggbb. */
function hex([r, g, b]) {
  return `#${[r, g, b].map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('')}`;
}

export function flightColour(flight, state) {
  if (!Array.isArray(flight) || flight.length === 0) return null;
  const index = ((Math.floor(Number(state)) % flight.length) + flight.length) % flight.length;
  const rgb = parseHex(flight[index]);
  return rgb ? { r: rgb[0], g: rgb[1], b: rgb[2] } : null;
}

/**
 * Drift: the wash, moving.
 *
 * A sign that says one thing says it forever, and a board holding a single
 * message is visually dead in a way a real installation never is. Rotating the
 * hue of every cell gives it a slow pulse without a single tile flipping - the
 * words stay put and the colour breathes underneath them.
 *
 * Applied to whatever grid it is given, so it works the same over a gradient,
 * over four corners, and over a photograph later.
 */

/** Hue rotation on one colour, in degrees. Cheap matrix, no HSL round trip. */
export function rotateHue(cell, degrees) {
  const radians = ((Number(degrees) || 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  // The luminance-preserving hue rotation matrix, so a drift changes the colour
  // and not how light the card is - which matters when the glyph has to stay
  // readable against it all the way round.
  const m = [
    0.213 + cos * 0.787 - sin * 0.213,
    0.715 - cos * 0.715 - sin * 0.715,
    0.072 - cos * 0.072 + sin * 0.928,
    0.213 - cos * 0.213 + sin * 0.143,
    0.715 + cos * 0.285 + sin * 0.14,
    0.072 - cos * 0.072 - sin * 0.283,
    0.213 - cos * 0.213 - sin * 0.787,
    0.715 - cos * 0.715 + sin * 0.715,
    0.072 + cos * 0.928 + sin * 0.072,
  ];
  const clamp = (n) => (n < 0 ? 0 : n > 255 ? 255 : Math.round(n));
  return {
    r: clamp(cell.r * m[0] + cell.g * m[1] + cell.b * m[2]),
    g: clamp(cell.r * m[3] + cell.g * m[4] + cell.b * m[5]),
    b: clamp(cell.r * m[6] + cell.g * m[7] + cell.b * m[8]),
  };
}

/** How many milliseconds one full turn of the drift takes, or 0 for none. */
export function driftPeriod(tint) {
  const period = Number(tint?.drift?.periodMs);
  return Number.isFinite(period) && period >= 1000 ? period : 0;
}

/**
 * Where a drift is in its turn at `now`, quantised to whole degrees.
 *
 * Quantised because the redraw is skipped when the angle has not moved: a slow
 * drift should not repaint the board sixty times a second to move the hue by a
 * fifth of a degree, least of all on the kind of hardware a wall runs on.
 */
export function driftAngle(period, now) {
  if (!period) return 0;
  return Math.round((((Number(now) || 0) % period) / period) * 360);
}

