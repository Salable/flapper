/**
 * Timed-mode playback as a pure function of the clock (RFC 0002, cycle
 * model). Shared verbatim by the server (re-anchoring, boundary splicing)
 * and every display - which is exactly why boards agree without coordinating:
 * they all evaluate the same function of the same timeline.
 *
 * The timeline has two layers: scheduled one-shots (absolute `playAtMs`,
 * played once, earliest first - this is also how "play now" works) shadow
 * the repeating cycle of loop items underneath.
 */

/** The repeating cycle: loop items with compiled durations, in queue order. */
export function cycleItems(items) {
  return items.filter((item) => item.loop && !item.playAtMs && (item.computedDurationMs ?? 0) > 0);
}

function oneShots(items) {
  return items
    .filter((item) => item.playAtMs && (item.computedDurationMs ?? 0) > 0)
    .sort((a, b) => a.playAtMs - b.playAtMs || (a.id < b.id ? -1 : 1));
}

export function activeOneShot(items, nowMs) {
  return (
    oneShots(items).find(
      (item) => item.playAtMs <= nowMs && nowMs < item.playAtMs + item.computedDurationMs,
    ) ?? null
  );
}

function nextOneShotStart(items, nowMs) {
  const upcoming = oneShots(items).find((item) => item.playAtMs > nowMs);
  return upcoming ? upcoming.playAtMs : null;
}

/**
 * What the glass should show at `nowMs`, and when that changes next.
 * @returns {{item: object|null, endsAtMs: number|null, kind: 'oneshot'|'cycle'|'idle'}}
 */
export function scheduleAt({ items, cycleAnchorMs, cycleMs }, nowMs) {
  const clampToShot = (endsAtMs) => {
    const next = nextOneShotStart(items, nowMs);
    if (next === null) return endsAtMs;
    return endsAtMs === null ? next : Math.min(endsAtMs, next);
  };

  const shot = activeOneShot(items, nowMs);
  if (shot) {
    return { item: shot, endsAtMs: shot.playAtMs + shot.computedDurationMs, kind: 'oneshot' };
  }

  const cycle = cycleItems(items);
  const total = cycle.reduce((sum, item) => sum + item.computedDurationMs, 0);
  if (cycle.length === 0 || !total || !cycleMs || cycleAnchorMs == null) {
    return { item: null, endsAtMs: clampToShot(null), kind: 'idle' };
  }

  const span = Math.max(total, 1);
  const offset = (((nowMs - cycleAnchorMs) % span) + span) % span;
  let cursor = 0;
  for (const item of cycle) {
    cursor += item.computedDurationMs;
    if (offset < cursor) {
      return { item, endsAtMs: clampToShot(nowMs + (cursor - offset)), kind: 'cycle' };
    }
  }
  // Unreachable while durations are positive; be safe.
  return { item: cycle[0], endsAtMs: clampToShot(nowMs + cycle[0].computedDurationMs), kind: 'cycle' };
}

/** Where a spliced one-shot should start: the end of the current slot. */
export function nextBoundaryMs(snapshot, nowMs) {
  const { endsAtMs } = scheduleAt(snapshot, nowMs);
  return endsAtMs ?? nowMs;
}

/** The cycle offset at which `itemId` starts, for re-anchoring after edits. */
export function cycleStartOffset(items, itemId) {
  let cursor = 0;
  for (const item of cycleItems(items)) {
    if (item.id === itemId) return cursor;
    cursor += item.computedDurationMs;
  }
  return null;
}
