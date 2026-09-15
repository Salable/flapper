/**
 * Which saved interrupters the clock says are due.
 *
 * A live board has nothing ticking it forward on its own, so a read of its
 * queue is the only moment there is (the same reasoning `sweepExpiredLive`
 * already runs on). This module answers one question at that moment: since
 * the last time we looked, has a scheduled interrupter's window opened?
 *
 * Pure, and takes `nowMs`, so the whole rule is testable without a clock,
 * a database or a board.
 */

import { triggersOf } from './schedule.mjs';

/**
 * @param presets  board.config.interrupters
 * @param nowMs
 * @param ctx      {createdAtMs} the board's own createdAt, the anchor an
 *                 `interval` spec counts from
 * @returns presets that should fire now, each with the occurrence instant
 *          that made it due - `[{preset, index, occurrenceMs}]`, in the
 *          presets' own order, which is also their ranking.
 */
export function dueInterrupters(presets, nowMs, ctx = {}) {
  const due = [];
  (presets ?? []).forEach((preset, index) => {
    if (!preset?.schedule) return;
    const { last } = triggersOf(preset.schedule, { tz: preset.timezone, createdAtMs: ctx.createdAtMs ?? 0 }, nowMs);
    if (last === null) return;

    // Already dealt with: `firedForMs` records the occurrence, not the
    // moment we noticed it, so two reads a millisecond apart cannot fire
    // the same 5pm twice - and neither can two displays.
    if (typeof preset.firedForMs === 'number' && preset.firedForMs >= last) return;

    // A window that has already closed is not worth opening. Catches a
    // board nobody read all weekend: it comes back showing what is true
    // now, not Friday's announcement.
    const durationMs = preset.durationMs;
    if (!(typeof durationMs === 'number' && durationMs > 0)) return;
    if (last + durationMs <= nowMs) return;

    due.push({ preset, index, occurrenceMs: last });
  });
  return due;
}
