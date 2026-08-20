/**
 * Slot durations for clock boards: the same flip+dwell estimate the live
 * engine and /preview use, floored so a slot is long enough to be seen.
 * A pure function of (payload, config) - editing either recomputes it; time
 * and randomness never enter, so every recompute of the same inputs agrees.
 */

import { MIN_SLOT_MS } from '../board/schedule.mjs';

export function itemDurationMs(controller, payload) {
  try {
    const options = { ...((payload ?? {}).options ?? {}) };
    if (Array.isArray(payload?.rows)) options.rows = payload.rows;
    const { estimatedMs } = controller.preview(payload?.text ?? '', options);
    return Math.max(MIN_SLOT_MS, Math.round(estimatedMs));
  } catch {
    // An unplayable payload still occupies a well-defined (minimal) slot.
    return MIN_SLOT_MS;
  }
}
