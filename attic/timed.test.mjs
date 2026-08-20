import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBroker } from '../lib/broker/memory.mjs';
import { makeTestDb, resetTestDb, makeTestUser } from '../lib/db/testing.mjs';
import { scheduleAt, nextBoundaryMs, cycleItems } from '../lib/board/schedule.mjs';
import {
  createBoard,
  postMessage,
  getQueue,
  queueMode,
  queueAttach,
  queueDetach,
  accountTier,
  advanceQueue,
  clearBoard,
} from '../lib/api/handlers.mjs';
import { mintDisplayToken } from '../lib/api/display-token.mjs';

/* ---- the pure schedule ---- */

const loopItem = (id, durationMs) => ({
  id,
  loop: true,
  playAtMs: null,
  computedDurationMs: durationMs,
});

test('scheduleAt walks the cycle by the clock and wraps', () => {
  const timeline = {
    items: [loopItem('a', 1000), loopItem('b', 2000), loopItem('c', 1000)],
    cycleAnchorMs: 10_000,
    cycleMs: 4000,
  };
  assert.equal(scheduleAt(timeline, 10_000).item.id, 'a');
  assert.equal(scheduleAt(timeline, 10_999).item.id, 'a');
  assert.equal(scheduleAt(timeline, 11_000).item.id, 'b');
  assert.equal(scheduleAt(timeline, 13_500).item.id, 'c');
  // Wraps: one full cycle later it is 'a' again, and ends when 'a' does.
  const wrapped = scheduleAt(timeline, 14_200);
  assert.equal(wrapped.item.id, 'a');
  assert.equal(wrapped.endsAtMs, 15_000);
  // Before the anchor also resolves (negative offsets wrap).
  assert.equal(scheduleAt(timeline, 9_500).item.id, 'c');
});

test('an active one-shot shadows the cycle; boundaries clamp to its start', () => {
  const shot = { id: 's', loop: false, playAtMs: 12_000, computedDurationMs: 1000 };
  const timeline = {
    items: [loopItem('a', 10_000), shot],
    cycleAnchorMs: 10_000,
    cycleMs: 10_000,
  };
  // Before the shot: cycle item, but the slot end clamps to the shot's start.
  const before = scheduleAt(timeline, 11_000);
  assert.equal(before.item.id, 'a');
  assert.equal(before.endsAtMs, 12_000);
  // During the shot: it shows, ending at its own end.
  const during = scheduleAt(timeline, 12_500);
  assert.equal(during.item.id, 's');
  assert.equal(during.endsAtMs, 13_000);
  // After: back to the cycle.
  assert.equal(scheduleAt(timeline, 13_100).item.id, 'a');
  assert.equal(nextBoundaryMs(timeline, 11_000), 12_000);
});

test('an empty cycle is idle until a scheduled one-shot arrives', () => {
  const shot = { id: 's', loop: false, playAtMs: 5000, computedDurationMs: 1000 };
  const timeline = { items: [shot], cycleAnchorMs: null, cycleMs: 0 };
  const idle = scheduleAt(timeline, 1000);
  assert.equal(idle.item, null);
  assert.equal(idle.endsAtMs, 5000); // wake up when the shot starts
  assert.equal(scheduleAt(timeline, 5500).item.id, 's');
  assert.equal(cycleItems(timeline.items).length, 0);
});

/* ---- the API surface ---- */

const BASE = 'https://flapper.test';
let db;
before(async () => {
  db = await makeTestDb();
});
let broker;
beforeEach(async () => {
  await resetTestDb(db);
  await makeTestUser(db, { id: 'owner' });
  broker = new MemoryBroker();
});

const asUser = (id) => async () => ({ user: { id } });
const ctx = (slug, who = 'owner') => ({ broker, db, slug, getSession: asUser(who) });

function call(handler, context, { method = 'POST', body, key } = {}) {
  return handler(
    new Request(`${BASE}/x`, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      headers: {
        'content-type': 'application/json',
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
    }),
    context,
  );
}

async function jsonOf(promise) {
  const response = await promise;
  return { status: response.status, body: await response.json() };
}

async function makeBoard(slug) {
  const { body } = await jsonOf(
    call(createBoard, ctx(undefined), { body: { slug } }),
  );
  return body;
}

const goPlus = () => call(accountTier, ctx(undefined), { body: { tier: 'plus' } });
const goStandard = () => call(accountTier, ctx(undefined), { body: { tier: 'standard' } });

test('timed mode is Plus: 403 on standard, on after upgrade, compiled', async () => {
  const board = await makeBoard('timed-board');
  const denied = await jsonOf(call(queueMode, ctx(board.slug), { body: { mode: 'timed' } }));
  assert.equal(denied.status, 403);
  assert.match(denied.body.error, /Plus/);

  await goPlus();
  const on = await jsonOf(call(queueMode, ctx(board.slug), { body: { mode: 'timed' } }));
  assert.equal(on.status, 200);
  assert.equal(on.body.mode, 'timed');

  // Loop messages join the cycle with compiled durations.
  await call(postMessage, ctx(board.slug), { body: { text: 'AAA', loop: true }, key: board.apiKey });
  await call(postMessage, ctx(board.slug), { body: { text: 'BBB', loop: true }, key: board.apiKey });
  const q = (await jsonOf(call(getQueue, ctx(board.slug), { method: 'GET' }))).body;
  assert.equal(q.mode, 'timed');
  assert.equal(q.items.length, 2);
  assert.ok(q.items.every((item) => item.computedDurationMs >= 3000));
  assert.equal(q.cycleMs, q.items.reduce((sum, item) => sum + item.computedDurationMs, 0));
  assert.ok(q.cycleAnchorMs > 0);
  assert.ok(q.serverNowMs > 0);

  // A one-shot gets an absolute play moment instead of joining the cycle.
  await call(postMessage, ctx(board.slug), { body: { text: 'ONCE' }, key: board.apiKey });
  const q2 = (await jsonOf(call(getQueue, ctx(board.slug), { method: 'GET' }))).body;
  const shot = q2.items.find((item) => item.payload.text === 'ONCE');
  assert.ok(shot.playAtMs >= q2.cycleAnchorMs);
  // The cycle is loop items only.
  assert.equal(q2.cycleMs, q2.items.filter((i) => i.loop).reduce((s, i) => s + i.computedDurationMs, 0));

  // Advance is a harmless no-op on a timed queue.
  const displayToken = await mintDisplayToken({ id: board.boardId, apiKey: board.apiKey });
  const adv = await jsonOf(
    call(advanceQueue, ctx(board.slug), { body: { itemId: 'x', epoch: 0 }, key: displayToken }),
  );
  assert.equal(adv.body.advanced, false);
  assert.equal(adv.body.mode, 'timed');
});

test('sharing: attach needs Plus + timed + an empty source queue; both boards see one queue', async () => {
  const first = await makeBoard('first-board');
  const second = await makeBoard('second-board');
  await goPlus();

  // Attach refuses while the queue is live.
  const notTimed = await jsonOf(
    call(queueAttach, ctx(first.slug), { body: { board: second.slug } }),
  );
  assert.equal(notTimed.status, 422);
  assert.match(notTimed.body.error, /timed/);

  await call(queueMode, ctx(first.slug), { body: { mode: 'timed' } });
  await call(postMessage, ctx(first.slug), { body: { text: 'SHARED', loop: true }, key: first.apiKey });

  // A source board with leftover messages must be cleared first.
  await call(postMessage, ctx(second.slug), { body: { text: 'LEFTOVER' }, key: second.apiKey });
  const dirty = await jsonOf(call(queueAttach, ctx(first.slug), { body: { board: second.slug } }));
  assert.equal(dirty.status, 422);
  assert.match(dirty.body.error, /clear/);
  await call(clearBoard, ctx(second.slug), { body: {}, key: second.apiKey });

  const attached = await jsonOf(call(queueAttach, ctx(first.slug), { body: { board: second.slug } }));
  assert.equal(attached.status, 200);

  const q1 = (await jsonOf(call(getQueue, ctx(first.slug), { method: 'GET' }))).body;
  const q2 = (await jsonOf(call(getQueue, ctx(second.slug), { method: 'GET' }))).body;
  assert.equal(q1.items[0].payload.text, 'SHARED');
  assert.deepEqual(q2.items.map((i) => i.id), q1.items.map((i) => i.id));
  assert.equal(q2.mode, 'timed');
  assert.equal(q2.cycleAnchorMs, q1.cycleAnchorMs);

  // A mutation through either board nudges every attached display.
  await call(postMessage, ctx(second.slug), { body: { text: 'MORE', loop: true }, key: second.apiKey });
  const nudged1 = await broker.commandsAfter(first.boardId, '0', 100);
  const nudged2 = await broker.commandsAfter(second.boardId, '0', 100);
  assert.ok(nudged1.length > 0);
  assert.ok(nudged2.length > 0);

  // Switching back to live is refused while shared.
  const back = await jsonOf(call(queueMode, ctx(first.slug), { body: { mode: 'live' } }));
  assert.equal(back.status, 422);
  assert.match(back.body.error, /detach/);
});

test('downgrade goes dormant (configurable), never destroys; detach frees a board', async () => {
  const first = await makeBoard('main-wall');
  const second = await makeBoard('side-wall');
  await goPlus();
  await call(queueMode, ctx(first.slug), { body: { mode: 'timed' } });
  await call(postMessage, ctx(first.slug), { body: { text: 'KEEP ME', loop: true }, key: first.apiKey });
  await call(queueAttach, ctx(first.slug), { body: { board: second.slug } });

  await goStandard();
  const q1 = (await jsonOf(call(getQueue, ctx(first.slug), { method: 'GET' }))).body;
  assert.equal(q1.dormant, true); // timed itself is Plus: everything pauses
  assert.equal(q1.dormancyDisplay, 'card');
  assert.equal(q1.items.length, 1); // nothing deleted

  // The display style is the owner's choice even while dormant.
  const style = await jsonOf(
    call(queueMode, ctx(first.slug), { body: { dormancyDisplay: 'blank' } }),
  );
  assert.equal(style.status, 200);
  assert.equal(
    (await jsonOf(call(getQueue, ctx(first.slug), { method: 'GET' }))).body.dormancyDisplay,
    'blank',
  );

  // Re-upgrade reactivates in place.
  await goPlus();
  assert.equal((await jsonOf(call(getQueue, ctx(first.slug), { method: 'GET' }))).body.dormant, false);

  // Detach the second board onto its own fresh live queue.
  const detached = await jsonOf(call(queueDetach, ctx(second.slug), { body: {} }));
  assert.equal(detached.status, 200);
  const q2 = (await jsonOf(call(getQueue, ctx(second.slug), { method: 'GET' }))).body;
  assert.equal(q2.mode, 'live');
  assert.equal(q2.items.length, 0);
  // And now the first queue can go back to live.
  assert.equal(
    (await jsonOf(call(queueMode, ctx(first.slug), { body: { mode: 'live' } }))).status,
    200,
  );
});

test('tier switching validates and round-trips', async () => {
  assert.equal((await jsonOf(goPlus())).body.tier, 'plus');
  assert.equal(
    (await jsonOf(call(accountTier, ctx(undefined), { body: { tier: 'gold' } }))).status,
    422,
  );
  assert.equal((await jsonOf(goStandard())).body.tier, 'standard');
});
