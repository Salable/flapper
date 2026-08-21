/**
 * The tile-art themes a board can wear. A theme is a complete set of sprite
 * strips built by tools/build_assets.py - same 42-state cycle, same frame
 * structure, different paint - so switching theme is swapping the bitmaps
 * under a board without touching its tiles.
 *
 * A board's theme is part of its server config (`theme`), so every display
 * of that board agrees, and an agent can set it over PATCH /config. Pure and
 * client-safe: the display player and the settings page both import this.
 */

export const THEMES = Object.freeze({
  classic: Object.freeze({
    id: 'classic',
    name: 'Classic',
    description: 'Charcoal tiles, bone glyphs - the original.',
    /** Where the strips and manifest live under /public. */
    path: '/assets',
  }),
  canary: Object.freeze({
    id: 'canary',
    name: 'Canary',
    description: 'Norwich green tiles, white outline glyphs.',
    path: '/assets/canary',
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
