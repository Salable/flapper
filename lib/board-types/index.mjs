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
   * A stored grid - and a stored layout - dropped on the way out.
   *
   * A grid is not a field a board has. Every read comes through here, so this
   * is where a cols/rows pair left over from an older board stops existing -
   * and nothing downstream can read one, because nothing downstream is given
   * one. Anything that needs a grid asks gridForConfig for it.
   *
   * `layout` went with it: a board used to be placeable in a percentage
   * rectangle of the screen, which meant four more numbers to type and a
   * board that could disagree with the screen it was derived from. A board
   * fills the screen it is on.
   *
   * The same for the six fields that describe how the board *moves*: Hold,
   * Scroll speed, Landing, Sweep, Sweep shape and Always flip. They are how
   * the design flips, not what a particular board is showing, and now live
   * on the design's pack (advanced) instead - resolveBoardTheme is where
   * anything that needs one of them gets it.
   */
  const {
    cols: _grid,
    rows: _gridRows,
    layout: _layout,
    dwellMs: _dwellMs,
    fastStepMs: _fastStepMs,
    landStepMs: _landStepMs,
    sweepMs: _sweepMs,
    staggerMode: _staggerMode,
    alwaysFlip: _alwaysFlip,
    ...rest
  } = migrated;
  return { ...rest, __v: type.configVersion };
}
