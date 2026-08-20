import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluate,
  triggersOf,
  occurrencesAfter,
  validateSchedule,
  zonedToUtc,
  expiryOf,
  describeSchedule,
  relativeWhen,
  isTimezone,
} from '../lib/board/schedule.mjs';

/**
 * The pinned scheduling semantics from RFC 0002 / the 4.0 plan. If one of
 * these needs to change, the docs and every display change with it.
 */

const item = (id, schedule, extra = {}) => ({
  id,
  schedule,
  createdAt: extra.createdAt ?? 0,
  computedDurationMs: extra.computedDurationMs ?? 5000,
  updatedAt: 1,
  payload: { text: id.toUpperCase(), options: {} },
});

const UTC = { timezone: 'UTC' };

/* ---- timezone resolution ---- */

test('zonedToUtc resolves plain wall times in fixture zones', () => {
  // 2026-06-15 09:00 in New York is EDT (UTC-4).
  assert.equal(zonedToUtc('America/New_York', 2026, 6, 15, 9, 0, 0), Date.UTC(2026, 5, 15, 13, 0, 0));
  // Kathmandu is UTC+5:45 year-round.
  assert.equal(zonedToUtc('Asia/Kathmandu', 2026, 6, 15, 9, 0, 0), Date.UTC(2026, 5, 15, 3, 15, 0));
  assert.equal(zonedToUtc('UTC', 2026, 1, 1, 0, 0, 0), Date.UTC(2026, 0, 1));
});

test('spring-forward erases 02:30; the trigger fires at the transition', () => {
  // US DST 2026 starts Sun Mar 8, 02:00 EST -> 03:00 EDT (07:00Z).
  assert.equal(
    zonedToUtc('America/New_York', 2026, 3, 8, 2, 30, 0),
    Date.UTC(2026, 2, 8, 7, 0, 0),
  );
});

test('fall-back repeats 01:30; the trigger fires at the first occurrence only', () => {
  // US DST 2026 ends Sun Nov 1: 01:30 EDT (05:30Z) then 01:30 EST (06:30Z).
  assert.equal(
    zonedToUtc('America/New_York', 2026, 11, 1, 1, 30, 0),
    Date.UTC(2026, 10, 1, 5, 30, 0),
  );
});

test('isTimezone accepts IANA names and refuses junk', () => {
  assert.ok(isTimezone('Europe/London'));
  assert.ok(!isTimezone('Mars/Olympus_Mons'));
  assert.ok(!isTimezone(''));
});

/* ---- triggers ---- */

test('interval anchors at the item’s createdAt', () => {
  const spec = { kind: 'interval', everyMs: 60_000 };
  const ctx = { tz: 'UTC', createdAtMs: 10_000 };
  assert.deepEqual(triggersOf(spec, ctx, 5_000), { last: null, next: 10_000, period: 60_000 });
  assert.deepEqual(triggersOf(spec, ctx, 130_000, ), { last: 130_000, next: 190_000, period: 60_000 });
});

test('everyN anchors at local midnight in the board timezone', () => {
  // Every 15 min in New York on a summer day: midnight EDT = 04:00Z.
  const spec = { kind: 'everyN', minutes: 15 };
  const ctx = { tz: 'America/New_York', createdAtMs: 0 };
  const nowMs = Date.UTC(2026, 5, 15, 4, 20, 0); // 00:20 local
  const { last, next } = triggersOf(spec, ctx, nowMs);
  assert.equal(last, Date.UTC(2026, 5, 15, 4, 15, 0));
  assert.equal(next, Date.UTC(2026, 5, 15, 4, 30, 0));
});

test('hourly at :15 holds through the small hours across midnight', () => {
  const spec = { kind: 'hourly', minute: 15 };
  const ctx = { tz: 'UTC', createdAtMs: 0 };
  const justPastMidnight = Date.UTC(2026, 5, 16, 0, 10, 0);
  const { last, next } = triggersOf(spec, ctx, justPastMidnight);
  assert.equal(last, Date.UTC(2026, 5, 15, 23, 15, 0)); // yesterday's series
  assert.equal(next, Date.UTC(2026, 5, 16, 0, 15, 0));
});

test('weekly triggers on its weekday only', () => {
  const spec = { kind: 'weekly', dow: 1, at: '09:00' }; // Mondays
  const ctx = { tz: 'UTC', createdAtMs: 0 };
  const wednesday = Date.UTC(2026, 5, 17, 12, 0, 0); // Wed Jun 17 2026
  const { last, next } = triggersOf(spec, ctx, wednesday);
  assert.equal(last, Date.UTC(2026, 5, 15, 9, 0, 0)); // Mon Jun 15
  assert.equal(next, Date.UTC(2026, 5, 22, 9, 0, 0)); // Mon Jun 22
});

/* ---- evaluation ---- */

test('nothing scheduled: no item, no next change', () => {
  assert.deepEqual(evaluate([], UTC, 1000), { item: null, nextChangeAtMs: null });
});

test('the 9:35 case: a short overlay expires and the longer item resumes', () => {
  const long = item('long', { kind: 'daily', at: '09:00', durationMs: 3_600_000 });
  const short = item('short', { kind: 'daily', at: '09:35', durationMs: 300_000 });
  const day = (h, m) => Date.UTC(2026, 5, 15, h, m, 0);
  assert.equal(evaluate([long, short], UTC, day(9, 20)).item.id, 'long');
  assert.equal(evaluate([long, short], UTC, day(9, 36)).item.id, 'short');
  // The overlay ends at 09:40; the hour-long item takes the glass back.
  assert.equal(evaluate([long, short], UTC, day(9, 41)).item.id, 'long');
  // And the overlay's end is the 09:36 evaluation's next change.
  assert.equal(evaluate([long, short], UTC, day(9, 36)).nextChangeAtMs, day(9, 40));
});

test('exact ties rotate by trigger count instead of shadowing forever', () => {
  const a = item('a', { kind: 'interval', everyMs: 60_000, durationMs: 60_000 });
  const b = item('b', { kind: 'interval', everyMs: 60_000, durationMs: 60_000 });
  const winners = new Set();
  for (const minute of [0, 1, 2, 3]) {
    winners.add(evaluate([a, b], UTC, minute * 60_000 + 1000).item.id);
  }
  assert.deepEqual([...winners].sort(), ['a', 'b']);
  // And the rotation is deterministic: same instant, same winner, every time.
  assert.equal(
    evaluate([a, b], UTC, 61_000).item.id,
    evaluate([b, a], UTC, 61_000).item.id,
  );
});

test('durationMs null = a standing sign until its own next trigger', () => {
  const sign = item('sign', { kind: 'interval', everyMs: 600_000, durationMs: null });
  // Active at any point in the cycle, not just the first seconds.
  assert.equal(evaluate([sign], UTC, 599_000).item.id, 'sign');
  // A timed overlay wins its window, then the sign resumes.
  const flash = item('flash', { kind: 'once', atMs: 300_000, durationMs: 5_000 });
  assert.equal(evaluate([sign, flash], UTC, 302_000).item.id, 'flash');
  assert.equal(evaluate([sign, flash], UTC, 306_000).item.id, 'sign');
});

test('a once item plays its window and never again', () => {
  const shot = item('shot', { kind: 'once', atMs: 10_000, durationMs: 5_000 });
  assert.equal(evaluate([shot], UTC, 9_000).item, null);
  assert.equal(evaluate([shot], UTC, 9_000).nextChangeAtMs, 10_000);
  assert.equal(evaluate([shot], UTC, 12_000).item.id, 'shot');
  assert.equal(evaluate([shot], UTC, 16_000).item, null);
});

test('default duration comes from the computed flip+dwell estimate', () => {
  const shot = item('shot', { kind: 'once', atMs: 10_000 }, { computedDurationMs: 8_000 });
  assert.equal(evaluate([shot], UTC, 17_000).item.id, 'shot');
  assert.equal(evaluate([shot], UTC, 19_000).item, null);
});

test('nextChangeAtMs is the earliest of ends and upcoming triggers', () => {
  const a = item('a', { kind: 'once', atMs: 10_000, durationMs: 20_000 });
  const b = item('b', { kind: 'once', atMs: 15_000, durationMs: 2_000 });
  // At 11s: a is on; the next change is b's trigger at 15s, not a's end at 30s.
  assert.equal(evaluate([a, b], UTC, 11_000).nextChangeAtMs, 15_000);
  // At 16s: b overlays; next change is b's end at 17s.
  assert.equal(evaluate([a, b], UTC, 16_000).nextChangeAtMs, 17_000);
});

test('an invalid timezone degrades to UTC instead of crashing the board', () => {
  const it = item('x', { kind: 'daily', at: '09:00', durationMs: 60_000 });
  const result = evaluate([it], { timezone: 'Nowhere/Bad' }, Date.UTC(2026, 5, 15, 9, 0, 30));
  assert.equal(result.item.id, 'x');
});

/* ---- helpers ---- */

test('occurrencesAfter previews the next occurrences', () => {
  const ctx = { tz: 'UTC', createdAtMs: 0 };
  assert.deepEqual(
    occurrencesAfter({ kind: 'interval', everyMs: 60_000 }, ctx, 30_000, 3),
    [60_000, 120_000, 180_000],
  );
  assert.deepEqual(occurrencesAfter({ kind: 'once', atMs: 5_000 }, ctx, 10_000, 3), []);
});

test('expiryOf materializes once expiries with grace; repeats never expire', () => {
  assert.equal(expiryOf({ kind: 'once', atMs: 10_000, durationMs: 5_000 }, 3_000), 75_000);
  assert.equal(expiryOf({ kind: 'once', atMs: 10_000 }, 4_000), 74_000);
  assert.equal(expiryOf({ kind: 'once', atMs: 10_000, durationMs: null }, 3_000), null);
  assert.equal(expiryOf({ kind: 'daily', at: '09:00' }, 3_000), null);
});

test('validateSchedule normalizes good specs and 422s bad ones', () => {
  assert.deepEqual(validateSchedule({ kind: 'daily', at: '09:00' }), { kind: 'daily', at: '09:00' });
  assert.deepEqual(
    validateSchedule({ kind: 'interval', everyMs: 5000, durationMs: null }),
    { kind: 'interval', everyMs: 5000, durationMs: null },
  );
  const bad = [
    { kind: 'sometimes' },
    { kind: 'interval', everyMs: 100 },
    { kind: 'daily', at: '25:00' },
    { kind: 'weekly', at: '09:00', dow: 9 },
    { kind: 'once', atMs: -5 },
    { kind: 'hourly', minute: 75 },
    { kind: 'once', atMs: 1000, durationMs: 5 },
    'daily',
  ];
  for (const spec of bad) {
    assert.throws(() => validateSchedule(spec), (e) => e.status === 422, JSON.stringify(spec));
  }
});

test('describeSchedule reads like a schedule', () => {
  assert.equal(describeSchedule({ kind: 'daily', at: '09:00' }), 'daily at 09:00');
  assert.equal(describeSchedule({ kind: 'interval', everyMs: 90_000 }), 'every 90s');
  assert.equal(describeSchedule({ kind: 'hourly', minute: 5 }), 'hourly at :05');
});

test('relativeWhen phrases distances unmistakably', () => {
  assert.equal(relativeWhen(1000, 500), 'now');
  assert.equal(relativeWhen(45_000, 0), 'in 45s');
  assert.equal(relativeWhen(5 * 60_000, 0), 'in 5 min');
  assert.equal(relativeWhen(3 * 3_600_000, 0), 'in 3 h');
  assert.equal(relativeWhen(3 * 86_400_000, 0), 'in 3 days');
});
