/**
 * A card's face, as CSS.
 *
 * The real board is a canvas: `skins/procedural.mjs` paints every card from a
 * pack. But three places draw tiles in the DOM instead - the wordmark, the
 * dashboard's mini boards, and the posters on /new - because they have to
 * render on the server, before any canvas exists.
 *
 * Those CSS tiles used to be Classic and only Classic: a linear gradient of
 * three greys in design-tokens.css, with one hand-written override keyed on the
 * literal id `canary`. So a fourth design's poster silently came out in
 * Classic's colours, which is exactly what happened to Sorbet.
 *
 * This turns a pack into the handful of custom properties those tiles read, so
 * a CSS tile can wear any design without anybody writing more CSS.
 *
 * Nothing passes a pack today. It was written to fix the posters on /new, and
 * those then moved to the real engine on a canvas, which fixes it better - so
 * this path is currently exercised only by its own test. It is kept rather than
 * deleted because the dashboard's board cards are the obvious next caller: a
 * card wearing its board's design tells you which board it is at a glance,
 * and that wants the theme in the board list response. Until then, treat this
 * as not load-bearing.
 */

import { parseHex } from './tint.mjs';

const clamp255 = (n) => (n < 0 ? 0 : n > 255 ? 255 : Math.round(n));
const hex = ([r, g, b]) =>
  `#${[r, g, b].map((c) => clamp255(c).toString(16).padStart(2, '0')).join('')}`;

/** `amount` of the way from `rgb` toward white (positive) or black (negative). */
function shift(rgb, amount) {
  const target = amount >= 0 ? 255 : 0;
  const t = Math.abs(amount);
  return rgb.map((c) => c + (target - c) * t);
}

/**
 * The face colours a CSS tile needs from a pack.
 *
 * A canvas card is shaded by a real gradient; a CSS tile fakes it with three
 * stops, so the pack's `card.fill` is the middle and `motion.shading` decides
 * how far the other two travel. The ink is `glyph.fill`, except when a pack
 * draws its glyphs as an outline - Canary's fill is `transparent` and its
 * stroke is white - in which case the stroke is the colour you can see.
 *
 * @param {object} pack a validated theme pack
 * @returns {{hi: string, mid: string, lo: string, ink: string, edge: string}|null}
 */
export function faceColours(pack) {
  const base = parseHex(pack?.card?.fill);
  if (!base) return null;
  const shading = Number(pack?.motion?.shading);
  const strength = Number.isFinite(shading) ? Math.min(1, Math.max(0, shading)) : 0.5;

  const inkSource =
    pack.glyph?.fill && pack.glyph.fill !== 'transparent' ? pack.glyph.fill : pack.glyph?.stroke;
  const ink = parseHex(inkSource);
  const edge = parseHex(pack.card?.edge);
  // The seam across the middle of a card. It was a hard-coded near-black line,
  // which reads as a hinge on a charcoal card and as a strikethrough on a pale
  // one - every one of Sorbet's letters looked crossed out. It is in the pack.
  const hinge = parseHex(pack.hinge?.fill);

  return {
    hi: hex(shift(base, strength * 0.1)),
    mid: hex(base),
    lo: hex(shift(base, -strength * 0.22)),
    ink: ink ? hex(ink) : '#ece7dd',
    edge: edge ? hex(edge) : '#000000',
    hinge: hinge ? hex(hinge) : '#000000',
  };
}

/**
 * The same thing as a style object for a React element - the custom properties
 * `ui.css`'s tile rules already read, so applying a design is setting variables
 * on a wrapper rather than writing a new rule per design.
 *
 * Returns an empty object for a pack it cannot read, which leaves the tokens'
 * defaults in place rather than producing a colourless tile.
 */
export function faceStyle(pack) {
  const face = faceColours(pack);
  if (!face) return {};
  return {
    '--tile-hi': face.hi,
    '--tile-mid': face.mid,
    '--tile-lo': face.lo,
    '--ink': face.ink,
    '--tile-edge': face.edge,
    '--tile-hinge': face.hinge,
  };
}
