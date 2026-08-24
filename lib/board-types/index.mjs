/**
 * The board-type registry. Adding a type is two lines: import its
 * definition here, and register its client pieces in
 * components/board-types/registry.ts. The contract harness keeps the two
 * lists identical and the definitions honest - see docs/BOARD-TYPES.md.
 */

import live from './live/definition.mjs';
import scheduled from './scheduled/definition.mjs';
import shared from './shared/definition.mjs';

const TYPES = [live, scheduled, shared];

export const BOARD_TYPES = new Map(TYPES.map((type) => [type.id, type]));

/** Unknown types resolve to null; callers degrade to the paused presentation. */
export function getBoardType(id) {
  return BOARD_TYPES.get(id) ?? null;
}

/** Config as the type currently understands it (lazy version migration). */
export function migratedConfig(type, config = {}) {
  const version = config.__v ?? type.configVersion;
  let migrated = config;
  if (version !== type.configVersion) {
    migrated = type.migrateConfig(config, version) ?? config;
  }
  /*
   * A stored grid is dropped on the way out, and never put back.
   *
   * A grid is not a field a board has. Every read comes through here, so this
   * is where a cols/rows pair left over from an older board stops existing -
   * and nothing downstream can read one, because nothing downstream is given
   * one. Anything that needs a grid asks gridForConfig for it.
   */
  const { cols: _grid, rows: _gridRows, ...rest } = migrated;
  return { ...rest, __v: type.configVersion };
}
