/**
 * Board settings persistence: what a display remembers between reloads.
 *
 * Kept flat on purpose - `loadSettings` is a one-level spread over the
 * defaults, so a stored nested value would replace its default wholesale with
 * no per-key merge. Bump the key when a default changes that a stored value
 * would otherwise shadow.
 */

import { DEFAULTS } from './flipboard.js';
import { CONTROLLER_DEFAULTS } from './controller.mjs';

export const SETTINGS_KEY = 'flapper.settings.v1';

export function defaultSettings() {
  return {
    cols: DEFAULTS.cols,
    rows: DEFAULTS.rows,
    footerRows: DEFAULTS.footerRows,
    align: DEFAULTS.align,
    valign: DEFAULTS.valign,
    wrap: DEFAULTS.wrap,
    fastStepMs: DEFAULTS.fastStepMs,
    landStepMs: DEFAULTS.landStepMs,
    sweepMs: DEFAULTS.sweepMs,
    staggerMode: DEFAULTS.staggerMode,
    alwaysFlip: DEFAULTS.alwaysFlip,
    dwellMs: CONTROLLER_DEFAULTS.dwellMs,
    playlist: 'FLAPPER\nHELLO\nDEPARTURES\nNOW BOARDING',
  };
}

/** @param {Pick<Storage, 'getItem'>} [storage] */
export function loadSettings(storage) {
  let stored = {};
  try {
    stored = JSON.parse(storage?.getItem(SETTINGS_KEY)) || {};
  } catch {
    stored = {};
  }
  return { ...defaultSettings(), ...stored };
}

/** @param {Pick<Storage, 'setItem'>} [storage] */
export function saveSettings(storage, settings) {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* not worth surfacing */
  }
}
