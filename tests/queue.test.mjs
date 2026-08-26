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
  removeByLabel,
  reorderItem,
  advance,
  flushPending,
  clearQueue,
  sweepExpiredLive,
  MAX_ITEMS,
} from '../lib/db/queue.mjs';

let db;
let board;
before(async () => {
  db = await makeTestDb();
});
beforeEach(async () => {
  await resetTestDb(db);
  await makeTestUser(db, { id: 'u1' });
  // A generous cap: these tests exercise ordering mechanics, not the roll.
  board = await createBoard(db, { ownerId: 'u1', slug: 'queue-board', config: { queueCap: 500 } });
});

const msg = (text, extra = {}) => ({ payload: { text, options: {} }, ...extra });

/** A fired saved interrupter's own shape - `interrupt: true` plus the
 * preset's name as `label`, exactly what `fireInterrupter` builds and what
 * `removeByLabel` matches against. */
const interrupt = (text, label, extra = {}) => ({
  payload: { text, options: { interrupt: true, label } },
  ...extra,
});

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

test('removeByLabel clears every instance of one fired interrupter, current and pending, and promotes the head', async () => {
  await appendItem(db, board.id, msg('SLIDE'));
  await setNow(db, board.id, interrupt('FIRE', 'FIRE'));
  // A second fire while the first is still live - the duplicate a real
  // re-click produces, since nothing at this layer refuses it.
  await setNow(db, board.id, interrupt('FIRE', 'FIRE'));
  let queue = await state();
  assert.equal(
    queue.items.filter((item) => item.payload.options.label === 'FIRE').length,
    2,
    'both fires queued their own instance',
  );

  const { removed } = await removeByLabel(db, board.id, 'FIRE');
  assert.equal(removed, 2, 'both instances removed in one call');
  queue = await state();
  assert.equal(
    queue.items.filter((item) => item.payload.options.label === 'FIRE').length,
    0,
    'neither instance survives - not just the one that was current',
  );
  assert.equal(queue.currentState, 'playing');
  assert.deepEqual(order(queue), ['SLIDE'], 'the original slide, not a duplicate, took the head back');
});

test('removeByLabel matches case-insensitively and never touches a different label', async () => {
  await setNow(db, board.id, interrupt('GOAL', 'GOAL'));
  const { removed: none } = await removeByLabel(db, board.id, 'fire');
  assert.equal(none, 0, 'nothing of that name exists');
  let queue = await state();
  assert.deepEqual(order(queue), ['GOAL'], "an unrelated dismiss leaves GOAL's own live instance alone");

  const { removed } = await removeByLabel(db, board.id, 'goal');
  assert.equal(removed, 1, 'case-insensitive match against the saved name GOAL');
  queue = await state();
  assert.equal(queue.items.length, 0);
});

test('removeByLabel is a no-op, not an error, when nothing of that name is queued', async () => {
  await appendItem(db, board.id, msg('SLIDE'));
  const { removed } = await removeByLabel(db, board.id, 'NEVER FIRED');
  assert.equal(removed, 0);
  const queue = await state();
  assert.deepEqual(order(queue), ['SLIDE'], 'untouched');
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

test('the absolute backstop still refuses growth past MAX_ITEMS', { timeout: 120000 }, async () => {
  const big = await createBoard(db, {
    ownerId: 'u1',
    slug: 'backstop-board',
    config: { queueCap: MAX_ITEMS + 100 },
  });
  const rows = Array.from({ length: MAX_ITEMS }, (_, i) => msg(`M${i}`));
  for (const entry of rows) await appendItem(db, big.id, entry);
  await assert.rejects(appendItem(db, big.id, msg('OVER')), (e) => e.status === 429);
});

test('a live board rolls: the 6th message drops the oldest waiting one', async () => {
  const small = await createBoard(db, { ownerId: 'u1', slug: 'rolling-board' });
  for (const text of ['A', 'B', 'C', 'D', 'E']) await appendItem(db, small.id, msg(text));
  const { item } = await appendItem(db, small.id, msg('F'));
  const queue = await listQueue(db, small.id);
  assert.equal(queue.items.length, 5);
  // A is playing (current) so B - the oldest *waiting* - rolled off.
  assert.deepEqual(queue.items.map((entry) => entry.payload.text), ['A', 'C', 'D', 'E', 'F']);
  assert.equal(queue.currentItemId, queue.items[0].id);
  assert.ok(item.id);
});

test('a held item does not count against the cap it is about to vacate', async () => {
  // A cap-1 "standing sign" board: the one message it holds is stale the
  // moment a replacement arrives, so the replacement must not be rejected
  // (or rolled against) as if the held row were still occupying the slot.
  const one = await createBoard(db, { ownerId: 'u1', slug: 'standing-sign', config: { queueCap: 1 } });
  const { item: a } = await appendItem(db, one.id, msg('A'));
  const drained = await advance(db, one.id, a.id, (await listQueue(db, one.id)).epoch);
  assert.equal(drained.currentState, 'holding');

  const { item: b, promoted } = await appendItem(db, one.id, msg('B'));
  assert.equal(promoted, true);
  const queue = await listQueue(db, one.id);
  assert.deepEqual(order(queue), ['B']);
  assert.equal(queue.currentItemId, b.id);
  assert.equal(queue.currentState, 'playing');
});

test('a cap-1 board can still be interrupted - now does not protect the item it is about to displace', async () => {
  // A "sign" is a cap-1 live board holding one message that is always
  // playing - so of the type's own roll rule, nothing but that one item
  // ever exists to roll, and it's exempt as "the one on the glass". Firing
  // priority: now (an interrupter, always) on a board like this used to
  // hit that rule head-on: reject, "clear it first".
  const sign = await createBoard(db, { ownerId: 'u1', slug: 'sign-board', config: { queueCap: 1 } });
  const { item: welcome } = await appendItem(db, sign.id, msg('WELCOME'));
  const before = await listQueue(db, sign.id);
  assert.equal(before.currentItemId, welcome.id);

  const { item: fire } = await setNow(db, sign.id, msg('FIRE'));
  const queue = await listQueue(db, sign.id);
  assert.deepEqual(order(queue), ['FIRE', 'WELCOME'], 'displaced, not deleted - it resumes once FIRE is done');
  assert.equal(queue.currentItemId, fire.id);

  // The absolute backstop still applies regardless - unaffected by this.
  const many = await createBoard(db, { ownerId: 'u1', slug: 'sign-backstop', config: { queueCap: MAX_ITEMS + 100 } });
  for (let i = 0; i < MAX_ITEMS; i += 1) await appendItem(db, many.id, msg(`M${i}`));
  await assert.rejects(setNow(db, many.id, msg('OVER')), (e) => e.status === 429);
});

/* ---- expiry (interrupters given a duration rather than "until dismissed") ---- */

test('sweepExpiredLive drops an expired item that is only waiting, untouched otherwise', async () => {
  await appendItem(db, board.id, msg('A')); // playing
  await appendItem(db, board.id, msg('EXPIRED', { expiresAtMs: 1000 }));
  await appendItem(db, board.id, msg('C'));
  const dropped = await sweepExpiredLive(db, board.id, 2000);
  assert.equal(dropped, 1);
  const queue = await listQueue(db, board.id);
  assert.deepEqual(order(queue), ['A', 'C']);
  assert.equal(queue.currentState, 'playing');
});

test('sweepExpiredLive moves the board on when the expired item is the one showing', async () => {
  const { item: a } = await appendItem(db, board.id, msg('A', { expiresAtMs: 1000 }));
  await appendItem(db, board.id, msg('B'));
  const before = await listQueue(db, board.id);
  assert.equal(before.currentItemId, a.id); // A promoted itself on first append

  const dropped = await sweepExpiredLive(db, board.id, 2000);
  assert.equal(dropped, 1);
  const queue = await listQueue(db, board.id);
  assert.deepEqual(order(queue), ['B']);
  assert.equal(queue.currentState, 'playing');
  assert.equal(queue.items[0].payload.text, 'B');
});

test('sweepExpiredLive is a no-op with nothing due yet', async () => {
  await appendItem(db, board.id, msg('A', { expiresAtMs: 5000 }));
  assert.equal(await sweepExpiredLive(db, board.id, 1000), 0);
  assert.deepEqual(order(await listQueue(db, board.id)), ['A']);
});
