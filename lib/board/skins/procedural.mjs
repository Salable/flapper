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
 * A card is baked with vignette and grunge (paintCard), so it reads as two
 * separate painted-metal vanes that have actually hung on a wall rather than
 * a flat plastic rectangle - grunge before the vignette, since dust sits on
 * the face itself and the vignette is the light falling off toward the edge
 * of the whole card. Baked in, not drawn per frame: it costs nothing beyond
 * the one-time cost of building the 42 cards, and it rides along for free
 * with every half of the flap, at rest or in flight.
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
    // A little light from above - baked as a genuine step at the hinge
    // line, not one smooth gradient blended across it.
    //
    // The two halves are two separate pieces of metal, each catching the
    // light on its own, not one continuous sheet - but a single gradient
    // top-to-bottom does not know the hinge line exists, so a card cut
    // exactly in half there produced two slices that were pixel-for-pixel
    // continuous: nothing in the image gave the cut anywhere to be. Baked
    // in here instead of drawn per frame in drawTile, so it costs nothing
    // extra and, because paintCard is always asked for a `size` that
    // matches the tile it will be sliced into, the step lands exactly on
    // the seam the two drawImage calls in drawTile will later cut along.
    const h = size / 2;
    if (ctx.clip) {
      ctx.save();
      roundedRect(ctx, inset, inset, size - inset * 2, size - inset * 2, Math.max(0, radius - inset));
      ctx.clip();

      const top = ctx.createLinearGradient(0, 0, 0, h);
      top.addColorStop(0, `rgba(255,255,255,${card.sheen.toFixed(3)})`);
      top.addColorStop(1, `rgba(255,255,255,${(card.sheen * 0.15).toFixed(3)})`);
      ctx.fillStyle = top;
      ctx.fillRect(0, 0, size, h);

      const bottom = ctx.createLinearGradient(0, h, 0, size);
      bottom.addColorStop(0, `rgba(0,0,0,${(card.sheen * 1.6).toFixed(3)})`);
      bottom.addColorStop(1, `rgba(0,0,0,${(card.sheen * 0.6).toFixed(3)})`);
      ctx.fillStyle = bottom;
      ctx.fillRect(0, h, size, size - h);

      ctx.restore();
    } else {
      // No clip support (the stub 2D context in tests, which never reads a
      // pixel back) - the old single whole-card gradient.
      const g = ctx.createLinearGradient(0, 0, 0, size);
      g.addColorStop(0, `rgba(255,255,255,${card.sheen.toFixed(3)})`);
      g.addColorStop(0.3, 'rgba(255,255,255,0)');
      g.addColorStop(0.7, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${(card.sheen * 1.5).toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.fill();
    }
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
  } else if (char !== ' ') {
    ctx.font = fontForSize(glyph.font, size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const gx = size / 2;
    const gy = size * glyph.baseline;
    if (glyph.stroke) {
      ctx.lineWidth = size * glyph.strokeWidth;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = glyph.stroke;
      ctx.strokeText(char, gx, gy);
    }
    if (glyph.fill !== 'transparent') {
      ctx.fillStyle = glyph.fill;
      ctx.fillText(char, gx, gy);
    }
  }

  // Both fall through even for a blank or an art card - dust settles on an
  // empty tile the same as a lettered one, and the vignette is the light
  // falling off the whole card, not something the glyph earns.
  paintGrunge(ctx, size, card.grunge);
  paintVignette(ctx, size, card.vignette);
}

/**
 * Grime, not a filter: a scatter of small dark specks plus a couple of
 * softer pooled smudges, baked once per state so it costs nothing at draw
 * time. Randomised per build (skin swap, resize) rather than seeded - it is
 * decoration, not anything a test or a viewer compares frame to frame.
 */
function paintGrunge(ctx, size, strength) {
  if (!(strength > 0) || !ctx.arc) return;
  ctx.save();
  const specks = Math.round(size * 0.5 * strength);
  for (let i = 0; i < specks; i += 1) {
    const px = Math.random() * size;
    const py = Math.random() * size;
    const r = size * (0.002 + Math.random() * 0.008);
    ctx.fillStyle = `rgba(0,0,0,${(Math.random() * 0.4 * strength).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }
  if (!ctx.createRadialGradient) {
    ctx.restore();
    return;
  }
  const smudges = Math.max(1, Math.round(2.5 * strength));
  for (let i = 0; i < smudges; i += 1) {
    const px = Math.random() * size;
    const py = Math.random() * size;
    const r = size * (0.14 + Math.random() * 0.2);
    const g = ctx.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, `rgba(0,0,0,${(0.1 * strength).toFixed(3)})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Light falling off toward the edge of the card - depth a flat fill can't give. */
function paintVignette(ctx, size, strength) {
  if (!(strength > 0) || !ctx.createRadialGradient) return;
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.22, size / 2, size / 2, size * 0.74);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength.toFixed(3)})`);
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();
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
    /** Colours a tile passes through on the way, applied only in flight. */
    this.flight = pack.flight ?? null;
    this.flightStrength = pack.flightStrength ?? 1;
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
    const { motion, hinge, card } = this.pack;
    const cur = this.cards[state];
    const next = this.cards[(state + 1) % this.cards.length];
    const h = size / 2;
    const inFlight = progress > 0;
    // Hoisted so both the clipped block below and the gap-bleed shadow
    // after it can read them without recomputing.
    const theta = progress * Math.PI; // 0..π through the hinge line
    const k = Math.cos(theta); // foreshortening: +1 flat on top, -1 flat on bottom

    ctx.save();
    ctx.translate(x, y);

    // Everything about the tile itself - both static halves, the flap and
    // its shading, the hinge and its pins - stays inside the card's own
    // rounded silhouette. Clipped once here rather than per shape: the
    // flap-in-flight shading below is a plain fillRect spanning the tile's
    // full box, and a plain rect ignores rounding - without this it washed
    // squarely over all four corners, a rounded card wearing a rectangular
    // overlay. The gap-bleed shadow further down deliberately paints past
    // `size` into the gap between tiles, so it stays outside this clip.
    if (ctx.clip) {
      ctx.save();
      roundedRect(ctx, 0, 0, size, size, size * card.radius);
      ctx.clip();
    }

    // The static halves.
    ctx.drawImage(inFlight ? next : cur, 0, 0, size, h, 0, 0, size, h);
    ctx.drawImage(cur, 0, h, size, h, 0, h, size, h);

    if (inFlight) {
      const persp = motion.perspective;

      // The card under the flap, shaded - darker while the flap stands over
      // it, peaking with the flap flat-on (θ=90°). Drawn before the flap
      // itself, over both static halves already drawn above, so what the
      // flap draws on top of it a moment later is unaffected - only the
      // resting card underneath darkens, not the moving piece. This is
      // `motion.shading` now, not `motion.shadow` - the flap no longer
      // shades itself as it turns (below), so the field that used to darken
      // it darkens what it stands over instead; `shadow` stays what it
      // always was, the cast shadow reaching past the tile's own edge.
      ctx.fillStyle = `rgba(0,0,0,${(motion.shading * 0.6 * Math.sin(theta)).toFixed(3)})`;
      ctx.fillRect(0, 0, size, size);

      // The flap in the air is lit from above, not turning into shadow - it
      // stands away from the board catching more of the room's light than
      // either resting half does, brightest as it passes flat-on and fading
      // back to nothing at either end of the swing, where it is
      // effectively part of a resting card again.
      const lit = motion.highlight * Math.sin(theta);

      ctx.save();
      ctx.translate(0, h);
      if (k >= 0) {
        // First half: the current top face folding down toward us.
        ctx.scale(1, Math.max(k, 0.001));
        if (persp) widen(ctx, size, 1 + persp * (1 - k) * 0.2);
        ctx.translate(0, -h);
        ctx.drawImage(cur, 0, 0, size, h, 0, 0, size, h);
        shade(ctx, size, h, 0, lit);
      } else {
        // Second half: the next bottom face, seen unfolding, mirrored about the hinge.
        ctx.scale(1, Math.max(-k, 0.001));
        if (persp) widen(ctx, size, 1 + persp * (1 + k) * 0.2);
        ctx.drawImage(next, 0, h, size, h, 0, 0, size, h);
        shade(ctx, size, h, 0, lit);
      }
      ctx.restore();
    }

    // The hinge: a dark band where the two flaps meet, and the pins. A
    // gap with one soft peak in the middle and nothing either side of it
    // read as a glow sitting on the card rather than a seam cut into it -
    // real depth has a bottom to it, not just a point. Flat and dark across
    // the middle third, feathered only at the two edges where the vane
    // faces resume.
    const band = size * hinge.thickness;
    if (ctx.createLinearGradient) {
      const g = ctx.createLinearGradient(0, h - band / 2, 0, h + band / 2);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.02, hinge.fill);
      g.addColorStop(0.98, hinge.fill);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = hinge.fill;
    }
    ctx.fillRect(0, h - band / 2, size, band);
    if (hinge.highlight) {
      // A bevel: the lower flap's top edge catching the light right where
      // it emerges from the gap - at the dark band's own lower edge, not
      // floating in open space a little further down. Once the band's dark
      // region was widened to a flat middle rather than one soft point,
      // leaving the highlight where it was left a visible gap of plain
      // card colour between the two, reading as two disconnected marks
      // rather than one lit edge right at the seam.
      ctx.fillStyle = hinge.highlight;
      ctx.fillRect(0, h + band * 0.15, size, Math.max(1, band * 0.08));
    }
    ctx.fillStyle = hinge.pin;
    const pw = size * hinge.pinWidth;
    const ph = size * hinge.pinHeight;
    ctx.fillRect(0, h - ph / 2, pw, ph);
    ctx.fillRect(size - pw, h - ph / 2, pw, ph);

    if (ctx.clip) ctx.restore(); // undo the rounded clip

    if (inFlight && ctx.createLinearGradient) {
      // A little lift off the board while the flap is in the air - a soft
      // shadow bleeding into the gap below the tile, not just the shading
      // it throws onto its own lower half. Peaks with the flap flat-on at
      // the midpoint (sin θ), same as the in-card shadow above. Outside the
      // rounded clip deliberately - the gap between tiles is nobody else's
      // canvas space, so painting past `size` here never gets overwritten
      // by a neighbour drawn later in the same frame, and there is no
      // rounded corner out there to leak past in the first place.
      const bleed = size * 0.07 * Math.sin(theta);
      const g = ctx.createLinearGradient(0, size, 0, size + bleed);
      g.addColorStop(0, `rgba(0,0,0,${(motion.shadow * 0.6 * Math.sin(theta)).toFixed(3)})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, size, size, bleed);
    }

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
