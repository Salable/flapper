/**
 * The contract between the engine and whatever paints a tile.
 *
 * @typedef {object} Skin
 * @property {ReadonlyArray<{name: string, char: string}>} cycle the ring, in order; index = state
 * @property {number} tileSize nominal resolution the pack's metrics were tuned at; reported in capabilities
 * @property {(size: number) => void} [prepare] called once per draw with the tile
 *   edge in device px, before any drawTile - build or refresh caches here
 * @property {(ctx: CanvasRenderingContext2D, state: number, progress: number,
 *   x: number, y: number, size: number) => void} drawTile paint state `state`
 *   at rest (progress 0) or `progress` of the way through its flap to the
 *   next state, filling the square at (x, y) of edge `size`
 */

export {};
