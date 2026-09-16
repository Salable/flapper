/**
 * What an og-image needs to draw a board's current state as a static
 * split-flap grid: the same layout()/layoutRows() the real display runs a
 * message through, resolved once here rather than inside the route handler
 * itself - so this has the same `node --test` coverage as the rest of
 * lib/board/, and the route only has to turn it into JSX.
 */

import { layout, layoutRows, charsetFromManifest } from './layout.mjs';
import { RING } from './ring.mjs';
import { resolveBoardTheme } from './board-theme.mjs';
import { gridForConfig } from './geometry.mjs';

const CHARSET = charsetFromManifest({ cycle: RING });

/**
 * @param {{ name: string, config: object, currentPayload: { text?: string, rows?: string[] } | null }} board
 * @returns {{ cols: number, rows: number, grid: string[], pack: object }} `grid`
 *   is always exactly `rows` strings of exactly `cols` characters, same
 *   contract as `layout()`'s own pages.
 */
export function ogCardData(board) {
  const config = board?.config ?? {};
  const { pack } = resolveBoardTheme(config);
  const { cols, rows } = gridForConfig(config);
  const payload = board?.currentPayload ?? null;

  // An idle board (no currentItemId, or its item since removed) has no
  // payload at all - that's not "blank", it's nothing to show, so the
  // board's own name stands in rather than an empty card nobody typed.
  if (payload === null) {
    return { cols, rows, grid: layout(board?.name || 'FLAPPER', { cols, rows, charset: CHARSET }).pages[0], pack };
  }

  // Rows-mode is laid out literally, one input row per board row - the same
  // rule the real display follows (lib/board/player.mjs `playableOf`), so a
  // sign built with explicit rows never gets silently re-wrapped here.
  if (Array.isArray(payload.rows)) {
    return { cols, rows, grid: layoutRows(payload.rows, { cols, rows, charset: CHARSET }).pages[0], pack };
  }

  const text = payload.text ?? '';
  const source = text.trim() !== '' ? text : board?.name || 'FLAPPER';
  return { cols, rows, grid: layout(source, { cols, rows, charset: CHARSET }).pages[0], pack };
}
