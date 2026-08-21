/**
 * Theme packs: the data that describes how a procedural board looks.
 *
 * A pack is a plain JSON object - palette, glyph typography, hinge, motion
 * feel, and per-state overrides (a red `!`, a logo drawn in place of `(`).
 * It is what a built-in theme is made of, what the theme builder edits, and
 * what a user will one day upload. So it is validated here, in pure code
 * with no canvas, and the renderer (skins/procedural.mjs) trusts the result.
 *
 * A pack may not change the ring in this phase. The ring is server-side
 * state - the API's charset, substitution table and per-board AGENTS.md all
 * derive from it - so `ring` is reserved and refused until that story lands.
 */

import { RING } from './ring.mjs';

/** The states a pack paints: the ring, one card each. */
export const DEFAULT_CYCLE = RING;

export const PACK_DEFAULTS = Object.freeze({
  // Measured from the original Classic clips at 256 px: face #2b2b2b, a
  // black edge 3% wide, a soft hinge band ~11% tall, pins too small to see.
  card: Object.freeze({ fill: '#2b2b2b', edge: '#000000', radius: 0.05, inset: 0.03, sheen: 0.06 }),
  hinge: Object.freeze({ fill: '#141414', highlight: null, thickness: 0.11, pin: '#3c3c3e', pinWidth: 0.025, pinHeight: 0.07 }),
  glyph: Object.freeze({
    fill: '#efe9df',
    stroke: null,
    strokeWidth: 0.03,
    font: '700 0.86em Arimo, "Helvetica Neue", Helvetica, Arial, sans-serif',
    baseline: 0.51,
  }),
  motion: Object.freeze({ shading: 0.72, shadow: 0.45, highlight: 0.15, perspective: 0 }),
  /**
   * Arimo is metric-compatible with Helvetica/Arial and ships with the app
   * (public/fonts/arimo, Apache 2.0), so the glyphs land in the same place on
   * a Linux TV as on the macOS kiosk. A pack that declares its own fonts
   * replaces this list.
   */
  fonts: Object.freeze([
    Object.freeze({ family: 'Arimo', src: '/fonts/arimo/Arimo-400.woff2', weight: '400' }),
    Object.freeze({ family: 'Arimo', src: '/fonts/arimo/Arimo-500.woff2', weight: '500' }),
    Object.freeze({ family: 'Arimo', src: '/fonts/arimo/Arimo-700.woff2', weight: '700' }),
  ]),
});

/** Numeric fields and the range each must sit in. */
export const RANGES = Object.freeze({
  'card.radius': [0, 0.5],
  'card.inset': [0, 0.2],
  'card.sheen': [0, 1],
  'hinge.thickness': [0, 0.3],
  'hinge.pinWidth': [0, 0.3],
  'hinge.pinHeight': [0, 0.5],
  'glyph.strokeWidth': [0, 0.2],
  'glyph.baseline': [0.3, 0.7],
  'motion.shading': [0, 1],
  'motion.shadow': [0, 1],
  'motion.highlight': [0, 1],
  'motion.perspective': [0, 1],
});

const COLOR = /^(#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\([\d\s.,%/]+\)|hsla?\([\d\s.,%/deg]+\)|transparent)$/i;
/** A CSS font shorthand with the size in em, so it scales with the tile. */
const FONT = /^(?:(?:normal|italic|oblique|bold|bolder|lighter|\d{3}|small-caps)\s+)*\d*\.?\d+em\s+\S.*$/;
/** Ids and art keys: short, url-safe. */
const KEY = /^[a-z0-9][a-z0-9-]{0,39}$/i;

/** A sanity bound on any pack this validator will look at; boards get a tighter one (board-theme.mjs). */
const MAX_PACK_BYTES = 256 * 1024;

function isColor(value) {
  return typeof value === 'string' && COLOR.test(value.trim());
}

function get(object, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), object);
}

/**
 * Validate a pack. Returns `{ ok: true, pack }` with defaults filled in, or
 * `{ ok: false, errors: string[] }` naming every problem found - a builder
 * wants all of them at once, not the first.
 */
export function validatePack(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['pack must be an object'] };
  }
  const size = JSON.stringify(input).length;
  if (size > MAX_PACK_BYTES) errors.push(`pack is ${size} bytes; limit is ${MAX_PACK_BYTES}`);

  if (input.id !== undefined && !(typeof input.id === 'string' && KEY.test(input.id))) {
    errors.push('id must be 1-40 url-safe characters');
  }
  if (input.name !== undefined && typeof input.name !== 'string') errors.push('name must be a string');
  if (input.ring !== undefined) errors.push('ring cannot be changed by a pack yet');

  const pack = {
    id: input.id,
    name: input.name ?? input.id,
    description: typeof input.description === 'string' ? input.description : '',
    card: { ...PACK_DEFAULTS.card, ...(input.card || {}) },
    hinge: { ...PACK_DEFAULTS.hinge, ...(input.hinge || {}) },
    glyph: { ...PACK_DEFAULTS.glyph, ...(input.glyph || {}) },
    motion: { ...PACK_DEFAULTS.motion, ...(input.motion || {}) },
    states: {},
    art: { ...(input.art || {}) },
    fonts: Array.isArray(input.fonts) ? input.fonts : [...PACK_DEFAULTS.fonts],
  };

  for (const section of ['card', 'hinge', 'glyph', 'motion']) {
    if (input[section] !== undefined && (typeof input[section] !== 'object' || Array.isArray(input[section]))) {
      errors.push(`${section} must be an object`);
    }
  }
  for (const key of ['card.fill', 'card.edge', 'hinge.fill', 'hinge.pin', 'glyph.fill']) {
    if (!isColor(get(pack, key))) errors.push(`${key} must be a colour`);
  }
  if (pack.glyph.stroke !== null && !isColor(pack.glyph.stroke)) errors.push('glyph.stroke must be a colour or null');
  if (pack.hinge.highlight !== null && !isColor(pack.hinge.highlight)) errors.push('hinge.highlight must be a colour or null');
  if (typeof pack.glyph.font !== 'string' || !FONT.test(pack.glyph.font.trim())) {
    errors.push('glyph.font must be a CSS font shorthand sized in em, e.g. "700 0.86em Helvetica"');
  }
  for (const [key, [lo, hi]] of Object.entries(RANGES)) {
    const value = get(pack, key);
    if (typeof value !== 'number' || !Number.isFinite(value) || value < lo || value > hi) {
      errors.push(`${key} must be a number between ${lo} and ${hi}`);
    }
  }

  for (const [key, value] of Object.entries(pack.art)) {
    if (!KEY.test(key)) errors.push(`art key ${JSON.stringify(key)} must be url-safe`);
    // Root-relative (shipped with the app) or an inline PNG/WebP. Never a
    // remote URL: cross-origin decode fails without CORS, and a board must
    // not be able to make every viewer fetch a third party. Never SVG:
    // createImageBitmap support is patchy and the editor rasterises anyway.
    if (typeof value !== 'string' || !/^(data:image\/(png|webp);base64,|\/)/.test(value)) {
      errors.push(`art.${key} must be a root-relative path or a data:image/png or data:image/webp URI`);
    }
  }
  pack.fonts.forEach((font, i) => {
    if (!font || typeof font.family !== 'string' || typeof font.src !== 'string') {
      errors.push(`fonts[${i}] needs family and src`);
    } else if (!/^\//.test(font.src)) {
      errors.push(`fonts[${i}].src must be a root-relative path`);
    } else if (font.weight !== undefined && !/^(\d{3}|normal|bold)$/.test(String(font.weight))) {
      errors.push(`fonts[${i}].weight must be a CSS font-weight`);
    }
  });

  const known = new Set(DEFAULT_CYCLE.map((s) => s.char));
  const states = input.states || {};
  if (typeof states !== 'object' || Array.isArray(states)) {
    errors.push('states must be an object keyed by character');
  } else {
    for (const [char, override] of Object.entries(states)) {
      if (!known.has(char)) {
        errors.push(`states[${JSON.stringify(char)}] is not in the ring`);
        continue;
      }
      if (!override || typeof override !== 'object') {
        errors.push(`states[${JSON.stringify(char)}] must be an object`);
        continue;
      }
      const entry = {};
      if (override.card) entry.card = { ...override.card };
      if (override.glyph) entry.glyph = { ...override.glyph };
      if (override.art !== undefined) {
        if (!pack.art[override.art]) errors.push(`states[${JSON.stringify(char)}].art refers to unknown art ${JSON.stringify(override.art)}`);
        entry.art = override.art;
      }
      for (const key of ['card.fill', 'card.edge']) {
        const v = get(entry, key);
        if (v !== undefined && !isColor(v)) errors.push(`states[${JSON.stringify(char)}].${key} must be a colour`);
      }
      const gf = entry.glyph?.fill;
      if (gf !== undefined && !isColor(gf)) errors.push(`states[${JSON.stringify(char)}].glyph.fill must be a colour`);
      const gs = entry.glyph?.stroke;
      if (gs !== undefined && gs !== null && !isColor(gs)) errors.push(`states[${JSON.stringify(char)}].glyph.stroke must be a colour or null`);
      const font = entry.glyph?.font;
      if (font !== undefined && !(typeof font === 'string' && FONT.test(font.trim()))) {
        errors.push(`states[${JSON.stringify(char)}].glyph.font must be a CSS font shorthand sized in em`);
      }
      pack.states[char] = entry;
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, pack };
}

/**
 * The fully-resolved look of one state: pack defaults with that state's
 * overrides merged a level deep. What the card painter reads.
 */
export function resolveStateStyle(pack, char) {
  const override = pack.states?.[char] || {};
  return {
    card: { ...pack.card, ...(override.card || {}) },
    glyph: { ...pack.glyph, ...(override.glyph || {}) },
    art: override.art ?? null,
  };
}

/** Turn an em-sized font shorthand into px for a tile of `size`. */
export function fontForSize(font, size) {
  return font.replace(/(\d*\.?\d+)em/, (_, em) => `${Math.max(1, Math.round(Number(em) * size))}px`);
}
