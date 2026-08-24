/**
 * The procedural skin: draws the flap from a theme pack, no pre-rendered art.
 *
 * Each state is painted once into an offscreen "card" at the current tile
 * size (paintCard, pure). A tile at rest is the card. A tile mid-flap is the
 * split-flap mechanism itself: the top half already shows the *next* card,
 * the bottom half still shows the *current* one, and between them the flap
 * falls - the current card's top half foreshortened by cos θ and darkened as
 * it turns away from the light, then, past the hinge, the next card's bottom
 * half seen from behind and unfolding onto the lower card, which it shades
 * while it is in the air.
 *
 * Memory is 42 cards × size² × 4 bytes: ~11 MB at 256 px.
 */

import { DEFAULT_CYCLE, resolveStateStyle, fontForSize } from '../theme-pack.mjs';
import { NOMINAL_TILE_SIZE } from '../ring.mjs';

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

/**
 * Paint one state's card - the whole tile at rest - into a `size`×`size`
 * context. Pure: everything it reads is in `style` and `art`.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} size tile edge in px
 * @param {string} char the glyph to draw
 * @param {ReturnType<typeof resolveStateStyle>} style
 * @param {CanvasImageSource|null} art an image to draw instead of the glyph
 */
export function paintCard(ctx, size, char, style, art = null) {
  const { card, glyph } = style;
  const radius = size * card.radius;
  const inset = size * card.inset;

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = card.edge;
  roundedRect(ctx, 0, 0, size, size, radius);
  ctx.fill();
  ctx.fillStyle = card.fill;
  roundedRect(ctx, inset, inset, size - inset * 2, size - inset * 2, Math.max(0, radius - inset));
  ctx.fill();
  if (card.sheen > 0 && ctx.createLinearGradient) {
    // A little light from above: the face brightens toward the top edge and
    // falls off toward the bottom, the way the painted tiles do.
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, `rgba(255,255,255,${card.sheen.toFixed(3)})`);
    g.addColorStop(0.3, 'rgba(255,255,255,0)');
    g.addColorStop(0.7, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${(card.sheen * 1.5).toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fill();
  }

  if (art) {
    // Art fills the card less a margin; aspect preserved, centred.
    const box = size * 0.72;
    const w = art.width || box;
    const h = art.height || box;
    const scale = Math.min(box / w, box / h);
    const dw = w * scale;
    const dh = h * scale;
    ctx.drawImage(art, (size - dw) / 2, (size - dh) / 2, dw, dh);
    return;
  }
  if (char === ' ') return;

  ctx.font = fontForSize(glyph.font, size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const x = size / 2;
  const y = size * glyph.baseline;
  if (glyph.stroke) {
    ctx.lineWidth = size * glyph.strokeWidth;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = glyph.stroke;
    ctx.strokeText(char, x, y);
  }
  if (glyph.fill !== 'transparent') {
    ctx.fillStyle = glyph.fill;
    ctx.fillText(char, x, y);
  }
}

export class ProceduralSkin {
  /**
   * @param {object} pack a pack that has passed validatePack
   * @param {object} [resources]
   * @param {Map<string, CanvasImageSource>} [resources.arts] decoded images by art key
   * @param {(size: number) => HTMLCanvasElement|OffscreenCanvas} [resources.createCanvas]
   */
  constructor(pack, { arts = new Map(), createCanvas } = {}) {
    this.pack = pack;
    this.arts = arts;
    this.cycle = DEFAULT_CYCLE;
    /** Nominal resolution for capabilities; cards are built at the real size. */
    this.tileSize = NOMINAL_TILE_SIZE;
    this.createCanvas =
      createCanvas ||
      ((size) => {
        if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(size, size);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        return canvas;
      });
    this.cards = [];
    this.cardSize = 0;
    /**
     * The pack's wash across the grid, if it has one. Carried on the skin
     * rather than plumbed through options so it arrives everywhere a pack
     * already arrives - the display and the editor's preview alike.
     */
    this.tint = pack.tint ?? null;
  }

  /** (Re)build the cards when the tile size changes. */
  prepare(size) {
    if (size === this.cardSize && this.cards.length === this.cycle.length) return;
    this.cardSize = size;
    this.cards = this.cycle.map((state) => {
      const canvas = this.createCanvas(size);
      const ctx = canvas.getContext('2d');
      const style = resolveStateStyle(this.pack, state.char);
      paintCard(ctx, size, state.char, style, style.art ? this.arts.get(style.art) || null : null);
      return canvas;
    });
  }

  drawTile(ctx, state, progress, x, y, size) {
    if (size !== this.cardSize) this.prepare(size);
    const { motion, hinge } = this.pack;
    const cur = this.cards[state];
    const next = this.cards[(state + 1) % this.cards.length];
    const h = size / 2;
    const inFlight = progress > 0;

    ctx.save();
    ctx.translate(x, y);

    // The static halves.
    ctx.drawImage(inFlight ? next : cur, 0, 0, size, h, 0, 0, size, h);
    ctx.drawImage(cur, 0, h, size, h, 0, h, size, h);

    if (inFlight) {
      const theta = progress * Math.PI; // 0..π through the hinge line
      const k = Math.cos(theta); // foreshortening: +1 flat on top, -1 flat on bottom
      const persp = motion.perspective;
      // Shadow the falling flap throws onto the lower card.
      ctx.fillStyle = `rgba(0,0,0,${(motion.shadow * Math.sin(theta)).toFixed(3)})`;
      ctx.fillRect(0, h, size, h * 0.5 * Math.sin(theta));

      ctx.save();
      ctx.translate(0, h);
      if (k >= 0) {
        // First half: the current top face folding down toward us.
        ctx.scale(1, Math.max(k, 0.001));
        if (persp) widen(ctx, size, 1 + persp * (1 - k) * 0.2);
        ctx.translate(0, -h);
        ctx.drawImage(cur, 0, 0, size, h, 0, 0, size, h);
        shade(ctx, size, h, motion.shading * (1 - k), motion.highlight * (1 - k));
      } else {
        // Second half: the next bottom face, seen unfolding, mirrored about the hinge.
        ctx.scale(1, Math.max(-k, 0.001));
        if (persp) widen(ctx, size, 1 + persp * (1 + k) * 0.2);
        ctx.drawImage(next, 0, h, size, h, 0, 0, size, h);
        shade(ctx, size, h, motion.shading * (1 + k) * 0.8, 0);
      }
      ctx.restore();
    }

    // The hinge: a soft dark band where the two flaps meet, and the pins.
    const band = size * hinge.thickness;
    if (ctx.createLinearGradient) {
      const g = ctx.createLinearGradient(0, h - band / 2, 0, h + band / 2);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.5, hinge.fill);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = hinge.fill;
    }
    ctx.fillRect(0, h - band / 2, size, band);
    if (hinge.highlight) {
      // A bevel: the lower flap's top edge catching the light just above the gap.
      ctx.fillStyle = hinge.highlight;
      ctx.fillRect(0, h - band * 0.18, size, Math.max(1, band * 0.12));
    }
    ctx.fillStyle = hinge.pin;
    const pw = size * hinge.pinWidth;
    const ph = size * hinge.pinHeight;
    ctx.fillRect(0, h - ph / 2, pw, ph);
    ctx.fillRect(size - pw, h - ph / 2, pw, ph);

    ctx.restore();
  }
}

function widen(ctx, size, factor) {
  ctx.translate(size / 2, 0);
  ctx.scale(factor, 1);
  ctx.translate(-size / 2, 0);
}

/** Darken a flap face as it turns from the light; a little sheen near the fold. */
function shade(ctx, w, h, dark, sheen) {
  if (dark > 0) {
    ctx.fillStyle = `rgba(0,0,0,${Math.min(1, dark).toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
  }
  if (sheen > 0 && ctx.createLinearGradient) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, `rgba(255,255,255,${Math.min(1, sheen).toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}
