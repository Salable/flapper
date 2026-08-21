/**
 * The ring: the states every tile can rest on, in the order a flap travels
 * through them. A split-flap tile only moves forward, so getting from Z to A
 * means passing every digit and the punctuation - this order is the board's
 * whole character model, and the API's charset, the layout engine's
 * substitution table and every theme's cards all derive from it.
 *
 * `name` is how a state is referred to (the blank and the punctuation have
 * spelled-out names); `char` is what a user types to reach it.
 *
 * Changing this is changing the API contract every board advertises.
 */

export const RING = Object.freeze(
  [
    ['blank', ' '],
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('').map((c) => [c, c]),
    ['fullstop', '.'],
    ['comma', ','],
    ['!', '!'],
    ['(', '('],
    [')', ')'],
  ].map(([name, char]) => Object.freeze({ name, char })),
);

/**
 * Advertised in /capabilities as `tileSize`. Cards are drawn at whatever
 * size the tile is on screen; this is the nominal resolution the glyph
 * metrics in a theme pack were tuned against.
 */
export const NOMINAL_TILE_SIZE = 256;

/** The characters the ring can show, in ring order. */
export function ringChars() {
  return RING.map((state) => state.char);
}
