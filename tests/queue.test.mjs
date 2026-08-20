import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, resetTestDb, makeTestUser } from '../lib/db/testing.mjs';
import { createBoard } from '../lib/db/boards.mjs';
import {
  listQueue,
  appendItem,
  insertAfterCurrent,
  setNow,
  updateItem,
  removeItem,
  reorderItem,
  advance,
  flushPending,
  clearQueue,
  MAX_ITEMS,
} from '../lib/db/queue.mjs';
import { TIERS, can, boardLimitFor, tierOf } from '../lib/db/entitlements.mjs';

let db;
let board;
before(async () => {
  db = await makeTestDb();
});
beforeEach(async () => {
  await resetTestDb(db);
  await makeTestUser(db, { id: 'u1' });
  board = await createBoard(db, { ownerId: 'u1', slug: 'queue-board' });
});

const msg = (text, extra = {}) => ({ payload: { text, options: {} }, ...extra });

async function state() {
  return listQueue(db, board.id);
}

function order(queue) {
  return queue.items.map((item) => item.payload.text);
}

/* ---- inserts & promotion ---- */

test('first append promotes itself to playing', async () => {
  const { item, promoted } = await appendItem(db, board.id, msg('A'));
  assert.equal(promoted, true);
  const queue = await state();
  assert.equal(queue.currentItemId, item.id);
  assert.equal(queue.currentState, 'playing');
  assert.equal(queue.epoch, 1);
});

test('appends land at the tail; next lands right after current; now preempts', async () => {
  await appendItem(db, board.id, msg('A'));
  await appendItem(db, board.id, msg('B'));
  await insertAfterCurrent(db, board.id, msg('NEXT'));
  assert.deepEqual(order(await state()), ['A', 'NEXT', 'B']);

  const { item: now } = await setNow(db, board.id, msg('NOW'));
  const queue = await state();
  assert.deepEqual(order(queue), ['NOW', 'A', 'NEXT', 'B']);
  assert.equal(queue.currentItemId, now.id);

  // Stacked nows nest ahead of the previously displaced item.
  await setNow(db, board.id, msg('NOW2'));
  assert.deepEqual(order(await state()), ['NOW2', 'NOW', 'A', 'NEXT', 'B']);
});

/* ---- advance ---- */

test('advance plays through in order and holds the last page', async () => {
  await appendItem(db, board.id, msg('A'));
  await appendItem(db, board.id, msg('B'));
  let queue = await state();

  const first = await advance(db, board.id, queue.currentItemId, queue.epoch);
  assert.equal(first.advanced, true);
  assert.equal(first.current.payload.text, 'B');
  assert.equal(first.currentState, 'playing');

  const second = await advance(db, board.id, first.current.id, first.epoch);
  assert.equal(second.advanced, true);
  // Nothing left: the finished item is kept and held, not deleted.
  assert.equal(second.currentState, 'holding');
  assert.equal(second.current.payload.text, 'B');

  // A new arrival replaces the held page and deletes the held row.
  await appendItem(db, board.id, msg('C'));
  queue = await state();
  assert.equal(queue.currentState, 'playing');
  assert.deepEqual(order(queue), ['C']);
});

test('advance is idempotent per play: wrong item, wrong epoch, or double-report no-op', async () => {
  await appendItem(db, board.id, msg('A'));
  await appendItem(db, board.id, msg('B'));
  const queue = await state();

  const real = await advance(db, board.id, queue.currentItemId, queue.epoch);
  assert.equal(real.advanced, true);
  // Mirror reports the same finish a moment later.
  const dupe = await advance(db, board.id, queue.currentItemId, queue.epoch);
  assert.equal(dupe.advanced, false);
  assert.equal(dupe.current.payload.text, 'B');

  const badEpoch = await advance(db, board.id, real.current.id, real.epoch + 5);
  assert.equal(badEpoch.advanced, false);
});

test('a loop item returns to the tail and a single-item loop plays itself', async () => {
  await appendItem(db, board.id, msg('L', { loop: true }));
  await appendItem(db, board.id, msg('B'));
  let queue = await state();

  const next = await advance(db, board.id, queue.currentItemId, queue.epoch);
  assert.equal(next.current.payload.text, 'B');
  assert.deepEqual(order(await state()), ['B', 'L']);

  const wrapped = await advance(db, board.id, next.current.id, next.epoch);
  assert.equal(wrapped.current.payload.text, 'L');
  // B was non-loop with something else present: deleted, not held.
  assert.deepEqual(order(await state()), ['L']);

  // Single looping item keeps playing itself, each play a fresh epoch.
  const again = await advance(db, board.id, wrapped.current.id, wrapped.epoch);
  assert.equal(again.current.payload.text, 'L');
  assert.equal(again.epoch, wrapped.epoch + 1);
});

test('epoch protects loop wraparound from a slow mirror', async () => {
  await appendItem(db, board.id, msg('L', { loop: true }));
  const q1 = await state();
  const play2 = await advance(db, board.id, q1.currentItemId, q1.epoch);
  // Slow mirror finally reports the FIRST play - same item id, old epoch.
  const stale = await advance(db, board.id, q1.currentItemId, q1.epoch);
  assert.equal(stale.advanced, false);
  assert.equal(stale.epoch, play2.epoch);
});

test('a failing item is skipped; a looping poison item dies after three failures', async () => {
  await appendItem(db, board.id, msg('BAD'));
  await appendItem(db, board.id, msg('GOOD'));
  let queue = await state();
  const after = await advance(db, board.id, queue.currentItemId, queue.epoch, {
    error: { message: 'layout failed' },
  });
  assert.equal(after.current.payload.text, 'GOOD');
  assert.deepEqual(order(await state()), ['GOOD']);

  // Looping poison: cycles at most three times, then is deleted.
  await clearQueue(db, board.id);
  await appendItem(db, board.id, msg('POISON', { loop: true }));
  for (let i = 0; i < 3; i += 1) {
    queue = await state();
    await advance(db, board.id, queue.currentItemId, queue.epoch, { error: { message: 'boom' } });
  }
  const emptied = await state();
  assert.equal(emptied.items.length, 0);
  assert.equal(emptied.currentState, 'idle');
});

/* ---- edits ---- */

test('editing bumps updatedAt; unknown items 404', async () => {
  const { item } = await appendItem(db, board.id, msg('A'));
  const updated = await updateItem(db, board.id, item.id, {
    payload: { text: 'EDITED', options: {} },
    loop: true,
  });
  assert.equal(updated.payload.text, 'EDITED');
  assert.equal(updated.loop, true);
  assert.ok(updated.updatedAt >= item.updatedAt);
  await assert.rejects(updateItem(db, board.id, 'nope', {}), (e) => e.status === 404);
  await assert.rejects(updateItem(db, board.id, item.id, { loop: 'yes' }), (e) => e.status === 422);
});

test('removing the current item skips to the head; removing the last goes idle', async () => {
  await appendItem(db, board.id, msg('A'));
  await appendItem(db, board.id, msg('B'));
  let queue = await state();
  await removeItem(db, board.id, queue.currentItemId);
  queue = await state();
  assert.equal(queue.currentState, 'playing');
  assert.deepEqual(order(queue), ['B']);

  await removeItem(db, board.id, queue.currentItemId);
  queue = await state();
  assert.equal(queue.currentState, 'idle');
  assert.equal(queue.items.length, 0);
});

test('reorder places after an anchor; the playing item is immovable', async () => {
  await appendItem(db, board.id, msg('A'));
  await appendItem(db, board.id, msg('B'));
  await appendItem(db, board.id, msg('C'));
  await appendItem(db, board.id, msg('D'));
  let queue = await state();
  const ids = Object.fromEntries(queue.items.map((item) => [item.payload.text, item.id]));

  await reorderItem(db, board.id, ids.D, ids.B);
  assert.deepEqual(order(await state()), ['A', 'B', 'D', 'C']);

  // null = front of pending (right after the playing item).
  await reorderItem(db, board.id, ids.C, null);
  assert.deepEqual(order(await state()), ['A', 'C', 'B', 'D']);

  await assert.rejects(reorderItem(db, board.id, ids.A, ids.B), (e) => /playing/.test(e.message));
  await assert.rejects(reorderItem(db, board.id, ids.B, ids.B), (e) => e.status === 422);
  await assert.rejects(reorderItem(db, board.id, 'nope', null), (e) => e.status === 404);
});

test('repeated next-inserts survive gap exhaustion via reindex', async () => {
  await appendItem(db, board.id, msg('A'));
  await appendItem(db, board.id, msg('Z'));
  for (let i = 0; i < 60; i += 1) {
    await insertAfterCurrent(db, board.id, msg(`N${i}`));
  }
  const queue = await state();
  assert.equal(queue.items.length, 62);
  assert.equal(queue.items[0].payload.text, 'A');
  assert.equal(queue.items[1].payload.text, 'N59');
  assert.equal(queue.items.at(-1).payload.text, 'Z');
  // Order strictly increasing under (position, id).
  for (let i = 1; i < queue.items.length; i += 1) {
    assert.ok(
      queue.items[i].position > queue.items[i - 1].position ||
        (queue.items[i].position === queue.items[i - 1].position &&
          queue.items[i].id > queue.items[i - 1].id),
    );
  }
});

/* ---- bulk + caps ---- */

test('flush drops pending only; clear empties and blanks', async () => {
  await appendItem(db, board.id, msg('A'));
  await appendItem(db, board.id, msg('B'));
  await appendItem(db, board.id, msg('C'));
  assert.equal(await flushPending(db, board.id), 2);
  let queue = await state();
  assert.deepEqual(order(queue), ['A']);
  assert.equal(queue.currentState, 'playing');

  assert.equal(await clearQueue(db, board.id), 1);
  queue = await state();
  assert.equal(queue.items.length, 0);
  assert.equal(queue.currentState, 'idle');
  assert.equal(queue.currentItemId, null);
});

test('the queue refuses growth past the cap with a 429', { timeout: 120000 }, async () => {
  const rows = Array.from({ length: MAX_ITEMS }, (_, i) => msg(`M${i}`));
  for (const entry of rows) await appendItem(db, board.id, entry);
  await assert.rejects(appendItem(db, board.id, msg('OVER')), (e) => e.status === 429);
});

/* ---- entitlements ---- */

test('tiers: standard caps boards at 3, plus is unlimited; unknown tiers read standard', () => {
  assert.equal(boardLimitFor('standard'), 3);
  assert.equal(boardLimitFor('plus'), Infinity);
  assert.equal(can('standard', 'sharedQueues'), false);
  assert.equal(can('plus', 'sharedQueues'), true);
  assert.equal(tierOf({ tier: 'gibberish' }), 'standard');
  assert.ok(Object.isFrozen(TIERS.standard));
});
