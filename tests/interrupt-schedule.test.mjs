import test from 'node:test';
import assert from 'node:assert/strict';
import { dueInterrupters } from '../lib/board/interrupt-schedule.mjs';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** 2026-09-15 17:00:00 UTC, and a few useful offsets from it. */
const FIVE_PM = Date.parse('2026-09-15T17:00:00Z');
const at = (ms) => FIVE_PM + ms;

const closing = { name: 'CLOSING', text: 'WE ARE CLOSED', durationMs: 5 * MINUTE, schedule: { kind: 'daily', at: '17:00' } };
const ctx = { createdAtMs: Date.parse('2026-09-01T00:00:00Z') };

test('nothing is due before its time', () => {
  assert.deepEqual(dueInterrupters([closing], at(-1), ctx), []);
});

test('five pm makes it due, and names the occurrence', () => {
  const due = dueInterrupters([closing], FIVE_PM, ctx);
  assert.equal(due.length, 1);
  assert.equal(due[0].preset.name, 'CLOSING');
  assert.equal(due[0].occurrenceMs, FIVE_PM);
});

test('it stays due through its window and stops at the end of it', () => {
  assert.equal(dueInterrupters([closing], at(4 * MINUTE), ctx).length, 1);
  assert.equal(dueInterrupters([closing], at(5 * MINUTE), ctx).length, 0, 'the window is closed, not reopened');
});

test('the same occurrence never fires twice', () => {
  const fired = { ...closing, firedForMs: FIVE_PM };
  assert.deepEqual(dueInterrupters([fired], at(MINUTE), ctx), [], 'a second read in the window');
  assert.deepEqual(dueInterrupters([fired], FIVE_PM, ctx), [], 'two displays on the same millisecond');
});

test("tomorrow's five pm is a new occurrence", () => {
  const fired = { ...closing, firedForMs: FIVE_PM };
  const due = dueInterrupters([fired], at(DAY), ctx);
  assert.equal(due.length, 1);
  assert.equal(due[0].occurrenceMs, at(DAY));
});

test('a board nobody read all weekend comes back to now, not to Friday', () => {
  assert.deepEqual(dueInterrupters([closing], at(3 * DAY + 6 * 60 * MINUTE), ctx), [], 'that window shut long ago');
});

test('an interrupter with no schedule is never due - it is fired by hand or by API', () => {
  assert.deepEqual(dueInterrupters([{ name: 'FIRE', text: 'X' }], FIVE_PM, ctx), []);
});

test('a scheduled interrupter with no duration is skipped rather than left open forever', () => {
  const noWindow = { ...closing, durationMs: undefined };
  assert.deepEqual(dueInterrupters([noWindow], FIVE_PM, ctx), []);
});

test('order is preserved, because order is the ranking', () => {
  const second = { ...closing, name: 'SECOND' };
  const due = dueInterrupters([closing, second], FIVE_PM, ctx);
  assert.deepEqual(due.map((row) => [row.preset.name, row.index]), [['CLOSING', 0], ['SECOND', 1]]);
});

test('the zone is the interrupter\'s own', () => {
  // 17:00 in Tokyo is 08:00 UTC, so UTC 17:00 is not that board's five pm.
  const tokyo = { ...closing, timezone: 'Asia/Tokyo' };
  assert.equal(dueInterrupters([tokyo], FIVE_PM, ctx).length, 0);
  assert.equal(dueInterrupters([tokyo], Date.parse('2026-09-15T08:00:00Z'), ctx).length, 1);
});
