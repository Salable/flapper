/**
 * The theme presets a board can wear. A theme is a theme pack
 * (lib/board/theme-pack.mjs) - palette, type, hinge, motion, per-glyph
 * overrides - that the display draws from directly. No art to build; a new
 * look is a JSON edit, and every preset is validated at module load so a
 * typo here fails the test run, not the wall.
 *
 * The ring is the same for every theme, so switching is swapping the skin
 * under a board without touching its tiles (Flipboard.setSkin).
 *
 * A board's theme is part of its server config (`theme`), so every display
 * of that board agrees, and an agent can set it over PATCH /config. Pure and
 * client-safe: the display player, the settings page and the API validator
 * all import this.
 */

import { validatePack } from './theme-pack.mjs';

function preset(input) {
  const result = validatePack(input);
  if (!result.ok) throw new Error(`theme ${input.id}: ${result.errors.join('; ')}`);
  return Object.freeze({ ...result.pack, id: input.id, name: input.name, description: input.description });
}

export const THEMES = Object.freeze({
  classic: preset({
    id: 'classic',
    name: 'Classic',
    description: 'Charcoal tiles, bone glyphs - the original.',
  }),
  canary: preset({
    id: 'canary',
    name: 'Canary',
    description: 'Norwich green tiles, white outline glyphs.',
    card: { fill: '#139a04', edge: '#000000', sheen: 0.05 },
    hinge: { fill: '#0c100a', highlight: 'rgba(255,255,255,0.55)', pin: '#2c2c2e' },
    glyph: { fill: 'transparent', stroke: '#ffffff', strokeWidth: 0.022, font: '500 0.86em Arimo, "Helvetica Neue", Helvetica, Arial, sans-serif' },
    motion: { shading: 0.6 },
  }),
  /**
   * The first design with a wash across the grid: pale rose in one corner
   * fading to pale blue in the other, and a near-black glyph, because bone
   * ink on a pastel card is mush. A light card carries the tint; `overlay`
   * leaves the dark letter alone.
   */
  sorbet: preset({
    id: 'sorbet',
    name: 'Sorbet',
    description: 'Pastel tiles washed corner to corner, dark glyphs.',
    card: { fill: '#e8e4de', edge: '#cfc9c0', sheen: 0.04, radius: 0.06 },
    hinge: { fill: '#cfc9c0', highlight: 'rgba(255,255,255,0.6)', pin: '#b8b2a8' },
    glyph: { fill: '#1a1a1c', font: '700 0.82em Arimo, "Helvetica Neue", Helvetica, Arial, sans-serif' },
    motion: { shading: 0.42, shadow: 0.28, highlight: 0.2 },
    // Four fruits, not two: aqua and sky along the top, lemon and coral along
    // the bottom, blended across the grid. A two-stop gradient runs along one
    // axis and makes every line square to it the same colour, which is not
    // what a sorbet looks like.
    tint: {
      corners: { tl: '#7af0e0', tr: '#8ecff5', bl: '#f7ee79', br: '#f4738d' },
      mode: 'multiply',
      strength: 0.9,
    },
  }),
});

export const DEFAULT_THEME = 'classic';

export const THEME_IDS = Object.freeze(Object.keys(THEMES));

/**
 * Ids boards were given while the drawn themes ran alongside the original
 * pre-rendered ones. Stored config may still say them; they resolve to the
 * theme they were twins of, but are not accepted on write.
 */
const LEGACY_THEME_IDS = Object.freeze({ 'classic-p': 'classic', 'canary-p': 'canary' });

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
  const mapped = typeof id === 'string' && LEGACY_THEME_IDS[id] ? LEGACY_THEME_IDS[id] : id;
  return isTheme(mapped) ? THEMES[mapped] : THEMES[DEFAULT_THEME];
}
