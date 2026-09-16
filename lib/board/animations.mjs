/**
 * Animations: a whole board's worth of motion, as a function of the frame.
 *
 * A fidget is one card briefly wrong (idle.mjs). A traveller is one creature
 * walking the edge (travellers.mjs). An animation is the third thing: the
 * board *is* the picture, every cell in play, nothing underneath it that has
 * to be put back. Dan, 27 Aug 2026: "a fidget is an animation that happens
 * TO the board slide, while an animation is basically a full thing."
 *
 * Pure, like the rest of lib/board: `frameOf` is a deterministic function of
 * the frame number and the grid, so the whole of what an animation looks
 * like is testable with no timer, no canvas and no board. Whoever owns the
 * clock decides when to ask.
 *
 * Output is per-cell colour rather than per-cell glyph, because that is what
 * these three are: colour is the picture. A card wearing a colour carries no
 * letter (fidgets.mjs's own rule for a colour beat), so an animation frame
 * needs to say nothing about characters at all.
 */

/** Frames on which both axes turn at once, up to and including `frame` -
 * every one of those was counted twice by summing the two axes. */
function cornersBefore(spanX, spanY, frame) {
  if (spanX <= 0 || spanY <= 0) return 0;
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const both = (spanX / gcd(spanX, spanY)) * spanY;
  return Math.floor(frame / both);
}

/** Cells are addressed flat, `row * cols + col`, the same as everywhere. */
const at = (cols, x, y) => y * cols + x;

/**
 * How finely the hue is sampled, in degrees.
 *
 * Every distinct colour a frame names costs the renderer a baked set of
 * cards (flipboard's `washFor`), so a continuous hue is not free: sampled
 * every degree, one rainbow walks through 360 of them and bakes a canvas
 * per ring state for each. Twelve degrees is thirty colours end to end,
 * which on a wall of cards is still a smooth sweep - the cards are large,
 * far apart, and never side by side with the shade they came from.
 */
const HUE_STEP = 12;

/** Hue to hex, with saturation and lightness fixed - these are signs, not
 * photographs, and a card's colour has to survive being seen from a room
 * away. `h` wraps, so callers can just keep adding, and it is quantised to
 * HUE_STEP so the set of colours in play stays small and repeatable. */
function hue(raw) {
  const h = Math.round(raw / HUE_STEP) * HUE_STEP;
  const s = 0.72;
  const l = 0.55;
  const k = (n) => (n + (((h % 360) + 360) % 360) / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const byte = (v) =>
    Math.round(255 * v)
      .toString(16)
      .padStart(2, '0');
  return `#${byte(f(0))}${byte(f(8))}${byte(f(4))}`;
}

/**
 * An explosion: a ring of colour leaving the middle, hot at the centre and
 * cooling as it goes. Ends when the ring has left the board, so the run
 * length is the far corner's distance plus the width of the ring itself.
 */
const explosion = {
  id: 'explosion',
  label: 'Explosion',
  frameMs: 90,
  /** How wide the moving band is, in cells. */
  band: 3,
  /** Hot to cool, sampled across the band. */
  ramp: ['#ffe9a3', '#ffb03a', '#e0503f'],
  frameOf(cols, rows, frame) {
    const cx = (cols - 1) / 2;
    const cy = (rows - 1) / 2;
    const cells = [];
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const distance = Math.hypot(x - cx, y - cy);
        // +1 so frame 0 is already alight. On an even-sided grid the centre
        // falls between cells, so the nearest one is ~0.7 away and a bare
        // `frame - distance` would spend its first frame showing nothing.
        const age = frame + 1 - distance;
        // Behind the front, and not yet past the trailing edge.
        if (age < 0 || age >= this.band) continue;
        cells.push({ index: at(cols, x, y), colour: this.ramp[Math.min(this.ramp.length - 1, Math.floor(age))] });
      }
    }
    return cells;
  },
  runLength(cols, rows) {
    /*
     * The last frame that still lights something, plus one.
     *
     * A cell is lit while `0 <= frame + 1 - distance < band`, so the
     * furthest cell goes dark once `frame >= maxDistance + band - 1`. The
     * old value was one higher than that, which spent the final frame of
     * every loop on a completely blank board - a visible stutter between
     * one explosion and the next.
     */
    return Math.ceil(Math.hypot((cols - 1) / 2, (rows - 1) / 2) + this.band - 1);
  },
};

/**
 * A rainbow: every cell lit, hue sliding along the diagonal. Unlike the
 * other two this has no natural end - it is a loop, so its run length is one
 * full turn of the hue.
 */
const rainbow = {
  id: 'rainbow',
  label: 'Rainbow',
  frameMs: 110,
  /** Degrees of hue per cell along the diagonal, and per frame. */
  perCell: 14,
  perFrame: 9,
  frameOf(cols, rows, frame) {
    const cells = [];
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        cells.push({ index: at(cols, x, y), colour: hue((x + y) * this.perCell + frame * this.perFrame) });
      }
    }
    return cells;
  },
  runLength() {
    return Math.ceil(360 / this.perFrame);
  },
};

/**
 * The bouncing logo. A block drifting at one cell per frame on each axis,
 * turning round at the walls, changing colour every time it does - and the
 * corner, which is the whole reason anybody watches one of these.
 *
 * Position is computed rather than accumulated (a triangle wave over the
 * frame number), so any frame can be asked for on its own and two displays
 * showing the same board agree without talking to each other - the same
 * property `lib/board/schedule.mjs` relies on.
 */
const bounce = {
  id: 'bounce',
  label: 'Bouncing logo',
  frameMs: 130,
  /** The block's own size, in cells. */
  w: 3,
  h: 2,
  colours: ['#e0503f', '#e8a33c', '#4a90d9', '#7fbf5f', '#cfc0e6', '#f7f0e0'],
  /** A triangle wave: 0..span, back down to 0, with no state kept. */
  fold(n, span) {
    if (span <= 0) return 0;
    const period = span * 2;
    const p = ((n % period) + period) % period;
    return p <= span ? p : period - p;
  },
  /**
   * How many times it has turned round by this frame - which is what picks
   * the colour, so the colour changes on the bounce and not before.
   *
   * A corner is *one* bounce, not two. Summing the axes counted it twice
   * and the palette jumped a colour; on a board where the two spans are
   * equal every bounce is a corner, so half the palette was unreachable and
   * the logo only ever wore three of its six colours.
   */
  bouncesBy(cols, rows, frame) {
    const spanX = Math.max(0, cols - this.w);
    const spanY = Math.max(0, rows - this.h);
    const turns = (span) => (span <= 0 ? 0 : Math.floor(frame / span));
    // Summing the axes counts a corner - both turning on the same frame -
    // once for each, so take those back out.
    return turns(spanX) + turns(spanY) - cornersBefore(spanX, spanY, frame);
  },
  frameOf(cols, rows, frame) {
    const x0 = this.fold(frame, Math.max(0, cols - this.w));
    const y0 = this.fold(frame, Math.max(0, rows - this.h));
    const colour = this.colours[this.bouncesBy(cols, rows, frame) % this.colours.length];
    const cells = [];
    for (let y = y0; y < Math.min(rows, y0 + this.h); y += 1) {
      for (let x = x0; x < Math.min(cols, x0 + this.w); x += 1) {
        cells.push({ index: at(cols, x, y), colour });
      }
    }
    return cells;
  },
  /** Never ends on its own - it is shown for as long as it is given. */
  runLength() {
    return Infinity;
  },
};

export const ANIMATIONS = Object.freeze({ explosion, rainbow, bounce });

export const ANIMATION_IDS = Object.freeze(Object.keys(ANIMATIONS));

/** The spec by name, or null - the same shape `traveller(name)` has. */
export function animation(name) {
  return Object.prototype.hasOwnProperty.call(ANIMATIONS, name) ? ANIMATIONS[name] : null;
}

/** One frame: `[{index, colour}]`, flat indices into a cols x rows grid. */
export function animationFrame(spec, cols, rows, frame) {
  if (!spec || cols <= 0 || rows <= 0 || frame < 0) return [];
  return spec.frameOf(cols, rows, frame);
}

/** How many frames a run is, or Infinity for one that just keeps going. */
export function animationRunLength(spec, cols, rows) {
  return spec ? spec.runLength(cols, rows) : 0;
}
