/**
 * The themes a board can wear. Two kinds:
 *
 * - `sprite`: a folder of strips built by tools/build_assets.py from
 *   designer-rendered clips - same 42-state cycle, same frame structure,
 *   different paint. The original Classic and Canary.
 * - `procedural`: a theme pack (lib/board/theme-pack.mjs) the display draws
 *   from directly - palette, type, hinge, motion, per-glyph overrides. No
 *   art to build; a new look is a JSON edit.
 *
 * Either way the ring is the same, so switching theme is swapping the skin
 * under a board without touching its tiles (Flipboard.setSkin).
 *
 * A board's theme is part of its server config (`theme`), so every display
 * of that board agrees, and an agent can set it over PATCH /config. Pure and
 * client-safe: the display player, the settings page and the API validator
 * all import this. Procedural packs are validated at module load so a typo
 * here fails the test run, not the wall.
 */

import { validatePack } from './theme-pack.mjs';

function procedural(input) {
  const result = validatePack(input);
  if (!result.ok) throw new Error(`theme pack ${input.id}: ${result.errors.join('; ')}`);
  return Object.freeze({ kind: 'procedural', ...result.pack });
}

export const THEMES = Object.freeze({
  classic: Object.freeze({
    kind: 'sprite',
    id: 'classic',
    name: 'Classic',
    description: 'Charcoal tiles, bone glyphs - the original.',
    /** Where the strips and manifest live under /public. */
    path: '/assets',
  }),
  canary: Object.freeze({
    kind: 'sprite',
    id: 'canary',
    name: 'Canary',
    description: 'Norwich green tiles, white outline glyphs.',
    path: '/assets/canary',
  }),
  'classic-p': procedural({
    id: 'classic-p',
    name: 'Classic (drawn)',
    description: 'The Classic look, drawn live from a theme pack.',
  }),
  'canary-p': procedural({
    id: 'canary-p',
    name: 'Canary (drawn)',
    description: 'The Canary look, drawn live from a theme pack.',
    card: { fill: '#139a04', edge: '#000000', sheen: 0.05 },
    hinge: { fill: '#0c100a', highlight: 'rgba(255,255,255,0.55)', pin: '#2c2c2e' },
    glyph: { fill: 'transparent', stroke: '#ffffff', strokeWidth: 0.022, font: '500 0.86em "Helvetica Neue", Helvetica, Arial, sans-serif' },
    motion: { shading: 0.6 },
  }),
});

export const DEFAULT_THEME = 'classic';

export const THEME_IDS = Object.freeze(Object.keys(THEMES));

/** Is `id` a theme this build ships? */
export function isTheme(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(THEMES, id);
}

/**
 * The theme for a config value. Unknown or missing resolves to the default
 * rather than throwing: an old display meeting a theme it does not ship must
 * keep showing the message, just in the wrong colour.
 */
export function resolveTheme(id) {
  return isTheme(id) ? THEMES[id] : THEMES[DEFAULT_THEME];
}
