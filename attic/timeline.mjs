/**
 * Compiling a timed queue: give every item a duration (the same estimate the
 * live engine and /preview use, so a slot is long enough to actually flip
 * through and dwell on the message), sum the loop items into the cycle, and
 * re-anchor so the item currently on the glass does not jump under an edit.
 */

import manifest from '../../public/assets/manifest.json' with { type: 'json' };
import { headlessController } from './headless-board.mjs';
import { scheduleAt, cycleItems, cycleStartOffset } from '../board/schedule.mjs';
import * as queuesDb from '../db/queues.mjs';
import { listQueue } from '../db/queue.mjs';

/** A slot never runs shorter than this - a flip needs time to be seen. */
const MIN_SLOT_MS = 3000;

export function itemDurationMs(controller, item) {
  try {
    const payload = item.payload ?? {};
    const options = { ...(payload.options ?? {}) };
    if (Array.isArray(payload.rows)) options.rows = payload.rows;
    const { estimatedMs } = controller.preview(payload.text ?? '', options);
    return Math.max(MIN_SLOT_MS, Math.round(estimatedMs));
  } catch {
    // An unplayable item still occupies a well-defined (minimal) slot rather
    // than corrupting the cycle length.
    return MIN_SLOT_MS;
  }
}

/**
 * Recompute durations and the cycle for a timed queue, anchored so whatever
 * the old timeline says is showing right now begins its slot at `nowMs` in
 * the new one (the current item restarts rather than jumps away).
 */
export async function recompileQueue(db, board, nowMs = Date.now()) {
  const before = await listQueue(db, board.id);
  if (!before || before.mode !== 'timed') return null;

  const showing = scheduleAt(
    { items: before.items, cycleAnchorMs: before.cycleAnchorMs, cycleMs: before.cycleMs },
    nowMs,
  );

  const controller = headlessController(manifest, board.config);
  const durations = before.items.map((item) => [item.id, itemDurationMs(controller, item)]);
  const byId = new Map(durations);
  const recompiled = before.items.map((item) => ({
    ...item,
    computedDurationMs: byId.get(item.id),
  }));
  const cycle = cycleItems(recompiled);
  const cycleMs = cycle.reduce((sum, item) => sum + item.computedDurationMs, 0);

  let anchorMs = nowMs;
  if (showing.kind === 'cycle' && showing.item) {
    const startOffset = cycleStartOffset(recompiled, showing.item.id);
    if (startOffset !== null) anchorMs = nowMs - startOffset;
  }

  await queuesDb.setCompiled(db, before.queueId, { durations, cycleMs, anchorMs });
  return { cycleMs, anchorMs };
}
