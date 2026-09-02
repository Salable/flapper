import test, { before, beforeEach } from 'node:test';
import { gridFor, gridForConfig } from '../lib/board/geometry.mjs';
import { MAX_DWELL_MS } from '../lib/board/track.mjs';
import assert from 'node:assert/strict';
import { MemoryBroker } from '../lib/broker/memory.mjs';
import { makeTestDb, resetTestDb, makeTestUser } from '../lib/db/testing.mjs';
import {
  createBoard,
  boardIndex,
  boardPatch,
  boardDelete,
  rotateKey,
  health,
  capabilities,
  status,
  postMessage,
  preview,
  flushQueue,
  clearBoard,
  patchConfig,
  postState,
  exportQueue,
  agentsDoc,
  commandEvents,
  stateEvents,
  getQueue,
  patchQueueItem,
  deleteQueueItem,
  reorderQueue,
  advanceQueue,
  getBoardKey,
  getTheme,
  listInterrupters,
  saveInterrupter,
  deleteInterrupter,
  fireInterrupter,
  dismissInterrupter,
  reorderInterrupters,
  requestLicence,
  listLicenceRequests,
} from '../lib/api/handlers.mjs';
import { mintDisplayToken } from '../lib/api/display-token.mjs';
import { BOARD_TYPES } from '../lib/board-types/index.mjs';
import { TEMPLATES } from '../lib/board-types/templates.mjs';
import * as schema from '../lib/db/schema.mjs';
import { eq } from 'drizzle-orm';

/**
 * The whole API surface, driven as plain (Request) -> Response calls against a
 * MemoryBroker and an in-memory PGlite: no Next, no sockets, no Better Auth -
 * sessions are stubbed through the injected getSession.
 */

const BASE = 'https://flapper.test';

let db;
before(async () => {
  db = await makeTestDb();
});

let broker;
beforeEach(async () => {
  await resetTestDb(db);
  await makeTestUser(db, { id: 'owner' });
  await makeTestUser(db, { id: 'stranger' });
  broker = new MemoryBroker();
});

const asUser = (id) => async () => ({ user: { id } });
const anonymous = async () => null;

/**
 * A licence reader that answers the same allowance for everyone, injected
 * the way getSession is. Left off, ctx carries no `licence` and the handlers
 * fall back to the real reader - which, with no SALABLE_API_KEY in the test
 * environment, is the unlicensed build: every type, no cap, no gate. That is
 * what keeps the rest of this suite about the API rather than about billing.
 */
const stubLicence = (allowance) => ({
  configured: true,
  allowanceFor: async () => allowance,
  forget: () => {},
});

function ctx(slug, sessionUserId, licence) {
  return {
    broker,
    db,
    slug,
    getSession: sessionUserId ? asUser(sessionUserId) : anonymous,
    ...(licence ? { licence } : {}),
  };
}

function call(handler, context, path, { method = 'GET', body, key, headers = {} } = {}) {
  const request = new Request(`${BASE}${path}`, {
    method,
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    headers: {
      'content-type': 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...headers,
    },
  });
  return handler(request, context);
}

async function jsonOf(responsePromise) {
  const response = await responsePromise;
  return { status: response.status, body: await response.json() };
}

async function makeBoard({ ownerId = 'owner', slug = 'test-board', ...rest } = {}) {
  const result = await jsonOf(
    call(createBoard, ctx(undefined, ownerId), '/api/boards', {
      method: 'POST',
      // seed: false - these tests want a truly empty queue to build their
      // own state on, not the friendly default a real bare create gets.
      body: { slug, seed: false, ...rest },
    }),
  );
  assert.equal(result.status, 201, JSON.stringify(result.body));
  // The create response carries no key (it would land in agent transcripts);
  // the helper fetches it the way a caller must - as its own explicit ask.
  const key = await jsonOf(call(getBoardKey, ctx(result.body.slug, ownerId), '/key'));
  assert.equal(key.status, 200);
  return { ...result.body, apiKey: key.body.apiKey };
}

/* ---- templates ---- */

test('a template seeds the queue and presets config; the body still wins', async () => {
  const created = await jsonOf(
    call(createBoard, ctx(undefined, 'owner'), '/api/boards', {
      method: 'POST',
      body: { template: 'office-clock', name: 'Desk', timezone: 'Europe/London', fallback: 'TEA' },
    }),
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.type, 'scheduled');
  assert.equal(created.body.template, 'office-clock');
  assert.equal(created.body.seeded, 3);
  const q = (await jsonOf(call(getQueue, ctx(created.body.slug, 'owner'), '/queue'))).body;
  assert.equal(q.items.length, 3);
  assert.deepEqual(q.items.map((item) => item.schedule.kind), ['daily', 'daily', 'daily']);
  assert.equal(q.config.timezone, 'Europe/London');
  assert.equal(q.config.fallback, 'TEA');

  // A live template with display config: theme and grid land in config.
  const match = await jsonOf(
    call(createBoard, ctx(undefined, 'owner'), '/api/boards', {
      method: 'POST',
      body: { template: 'match-day', name: 'NCFC' },
    }),
  );
  assert.equal(match.status, 201);
  assert.equal(match.body.type, 'live');
  const mq = (await jsonOf(call(getQueue, ctx(match.body.slug, 'owner'), '/queue'))).body;
  assert.equal(mq.config.theme, 'canary');
  // A card size is what the template sets; the grid is not stored at all, so
  // the board has no cols/rows of its own and answers with what its screen
  // and its card size come to.
  assert.equal(mq.config.cardSize, 'small');
  assert.equal(mq.config.cols, undefined, 'a board does not store a grid');
  assert.equal(mq.config.rows, undefined, 'a board does not store a grid');
  assert.deepEqual(gridForConfig(mq.config), gridFor('small'));
  assert.equal(mq.items.length, 2);
  assert.equal(mq.items[0].payload.text, 'ON THE BALL CITY');

  // A template is a default, not a lock: name a design and it wins. This is
  // how "make a board in this" works from the designs gallery, and it is the
  // same door an agent asking for a theme by name comes through.
  const chosen = await jsonOf(
    call(createBoard, ctx(undefined, 'owner'), '/api/boards', {
      method: 'POST',
      body: { template: 'match-day', name: 'NCFC pastel', theme: 'sorbet' },
    }),
  );
  assert.equal(chosen.status, 201, JSON.stringify(chosen.body));
  const cq = (await jsonOf(call(getQueue, ctx(chosen.body.slug, 'owner'), '/queue'))).body;
  assert.equal(cq.config.theme, 'sorbet', 'the named design beat the template');
  assert.equal(cq.config.cardSize, 'small', "the template's other config still applies");

  // And a design this build does not ship is refused rather than defaulted.
  const unknown = await jsonOf(
    call(createBoard, ctx(undefined, 'owner'), '/api/boards', {
      method: 'POST',
      body: { template: 'match-day', name: 'Tartan', theme: 'tartan' },
    }),
  );
  assert.equal(unknown.status, 422, JSON.stringify(unknown.body));

  // A design too big for a board to wear is refused at creation, not accepted
  // and then quietly rendered as the preset on every display. A design may be
  // 256 KB; a board's override is capped at 64 KB with eight arts.
  const { createDesign } = await import('../lib/db/designs.mjs');
  const { validatePack } = await import('../lib/board/theme-pack.mjs');
  const art = `data:image/png;base64,iVBORw0KGgo${'A'.repeat(30_000)}`;
  const heavy = validatePack({
    id: 'heavy',
    art: { 'art-1': art, 'art-2': art, 'art-3': art },
    states: { A: { art: 'art-1' }, B: { art: 'art-2' }, C: { art: 'art-3' } },
  });
  assert.equal(heavy.ok, true, 'legal as a design');
  const big = await createDesign(db, { ownerId: 'owner', name: 'Too big', pack: heavy.pack });
  const refused = await jsonOf(
    call(createBoard, ctx(undefined, 'owner'), '/api/boards', {
      method: 'POST',
      body: { template: 'sign', name: 'Heavy', designId: big.id },
    }),
  );
  assert.ok(refused.status === 413 || refused.status === 422, `got ${refused.status}`);
  assert.match(refused.body.error, /too large for a board to wear/);

  // Every template creates cleanly - the content test checks shape, this
  // checks the whole path including ingest and the queue cap.
  for (const id of TEMPLATES.keys()) {
    const result = await jsonOf(
      call(createBoard, ctx(undefined, 'owner'), '/api/boards', {
        method: 'POST',
        body: { template: id, name: id },
      }),
    );
    assert.equal(result.status, 201, `${id}: ${JSON.stringify(result.body)}`);
  }
});

test('a board with no template lands with a placeholder, not a blank glass; seed: false opts out', async () => {
  const bare = await jsonOf(
    call(createBoard, ctx(undefined, 'owner'), '/api/boards', {
      method: 'POST',
      body: { name: 'Bare' },
    }),
  );
  assert.equal(bare.status, 201, JSON.stringify(bare.body));
  assert.equal(bare.body.seeded, 1, 'the default placeholder counts as seeded too, same as a template would');
  const q = (await jsonOf(call(getQueue, ctx(bare.body.slug, 'owner'), '/queue'))).body;
  assert.equal(q.items.length, 1);
  assert.equal(q.items[0].payload.text, 'PUT TEXT IN ME');
  assert.equal(q.items[0].loop, true);

  const empty = await jsonOf(
    call(createBoard, ctx(undefined, 'owner'), '/api/boards', {
      method: 'POST',
      body: { name: 'Empty', slug: 'opts-out', seed: false },
    }),
  );
  assert.equal(empty.status, 201, JSON.stringify(empty.body));
  const eq = (await jsonOf(call(getQueue, ctx(empty.body.slug, 'owner'), '/queue'))).body;
  assert.equal(eq.items.length, 0);

  // seed: false never touches a template that was actually named - only
  // the friendly default a bare create would otherwise get.
  const withTemplate = await jsonOf(
    call(createBoard, ctx(undefined, 'owner'), '/api/boards', {
      method: 'POST',
      body: { template: 'sign', name: 'Still seeded', slug: 'still-seeded', seed: false },
    }),
  );
  assert.equal(withTemplate.status, 201, JSON.stringify(withTemplate.body));
  const tq = (await jsonOf(call(getQueue, ctx(withTemplate.body.slug, 'owner'), '/queue'))).body;
  assert.equal(tq.items.length, 1);
  assert.equal(tq.items[0].payload.text, 'WELCOME');

  // A scheduled type has no sensible text-only default - a bare clock
  // board still lands empty rather than with a schedule-less guess.
  const clock = await jsonOf(
    call(createBoard, ctx(undefined, 'owner'), '/api/boards', {
      method: 'POST',
      body: { type: 'scheduled', name: 'Clock', slug: 'bare-clock', timezone: 'Europe/London' },
    }),
  );
  assert.equal(clock.status, 201, JSON.stringify(clock.body));
  const cq = (await jsonOf(call(getQueue, ctx(clock.body.slug, 'owner'), '/queue'))).body;
  assert.equal(cq.items.length, 0);
});

test('an unknown template, or a type that contradicts it, is a 422', async () => {
  const unknown = await jsonOf(
    call(createBoard, ctx(undefined, 'owner'), '/api/boards', {
      method: 'POST',
      body: { template: 'tartan', name: 'x' },
    }),
  );
  assert.equal(unknown.status, 422);
  assert.match(unknown.body.error, /unknown template "tartan"/);
  const clash = await jsonOf(
    call(createBoard, ctx(undefined, 'owner'), '/api/boards', {
      method: 'POST',
      body: { template: 'welcome', type: 'scheduled', name: 'x' },
    }),
  );
  assert.equal(clash.status, 422);
  assert.match(clash.body.error, /is a live board/);
});

/* ---- lifecycle ---- */

test('creating a board needs a session and returns urls but never the key', async () => {
  const denied = await jsonOf(
    call(createBoard, ctx(), '/api/boards', { method: 'POST', body: {} }),
  );
  assert.equal(denied.status, 401);

  const raw = await jsonOf(
    call(createBoard, ctx(undefined, 'owner'), '/api/boards', { method: 'POST', body: { slug: 'keyless' } }),
  );
  assert.equal(raw.status, 201);
  assert.equal(raw.body.apiKey, undefined);

  const board = await makeBoard({ name: 'Lobby' });
  assert.match(board.boardId, /^[0-9a-z]{16}$/);
  assert.match(board.apiKey, /^[0-9a-f]{64}$/);
  assert.equal(board.slug, 'test-board');
  assert.equal(board.url, `${BASE}/b/test-board`);
  assert.equal(board.apiBase, `${BASE}/api/b/test-board`);
});

test('an unknown slug is a 404 on every route', async () => {
  for (const handler of [boardIndex, health, capabilities, status, agentsDoc]) {
    const { status: code, body } = await jsonOf(call(handler, ctx('nope-nope'), '/x'));
    assert.equal(code, 404);
    assert.match(body.error, /unknown board/);
  }
});

test('owner can rename, re-slug and toggle privacy; others cannot', async () => {
  const board = await makeBoard();
  const c = (who) => ctx(board.slug, who);

  assert.equal(
    (await call(boardPatch, ctx(board.slug), '/x', { method: 'PATCH', body: { name: 'X' } })).status,
    401,
  );
  assert.equal(
    (await call(boardPatch, c('stranger'), '/x', { method: 'PATCH', body: { name: 'X' } })).status,
    403,
  );
  const unknownKey = await jsonOf(
    call(boardPatch, c('owner'), '/x', { method: 'PATCH', body: { color: 'red' } }),
  );
  assert.equal(unknownKey.status, 422);

  const renamed = await jsonOf(
    call(boardPatch, c('owner'), '/x', {
      method: 'PATCH',
      body: { name: 'Departures', slug: 'departures', private: true },
    }),
  );
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.slug, 'departures');
  assert.equal(renamed.body.private, true);
  // The old slug is gone.
  assert.equal((await call(boardIndex, ctx(board.slug), '/x')).status, 404);
});

test('rotate mints a new key and the old one stops working', async () => {
  const board = await makeBoard();
  const rotated = await jsonOf(
    call(rotateKey, ctx(board.slug, 'owner'), '/x', { method: 'POST' }),
  );
  assert.equal(rotated.status, 200);
  assert.notEqual(rotated.body.apiKey, board.apiKey);

  const oldKey = await call(postMessage, ctx(board.slug), '/x', {
    method: 'POST',
    body: { text: 'HI' },
    key: board.apiKey,
  });
  assert.equal(oldKey.status, 401);
  const newKey = await call(postMessage, ctx(board.slug), '/x', {
    method: 'POST',
    body: { text: 'HI' },
    key: rotated.body.apiKey,
  });
  assert.equal(newKey.status, 202);
});

test('delete requires the owner and clears the realtime channel', async () => {
  const board = await makeBoard();
  await broker.appendCommand(board.boardId, { method: 'enqueue', params: {} });
  assert.equal(
    (await call(boardDelete, ctx(board.slug, 'stranger'), '/x', { method: 'DELETE' })).status,
    403,
  );
  assert.equal(
    (await call(boardDelete, ctx(board.slug, 'owner'), '/x', { method: 'DELETE' })).status,
    200,
  );
  assert.equal((await call(boardIndex, ctx(board.slug), '/x')).status, 404);
  assert.equal(await broker.latestCommandId(board.boardId), '0');
});

/* ---- write auth ---- */

test('writes need the API key or the owner session; strangers get nothing', async () => {
  const board = await makeBoard();
  const message = { method: 'POST', body: { text: 'HI' } };

  assert.equal((await call(postMessage, ctx(board.slug), '/x', message)).status, 401);
  assert.equal(
    (await call(postMessage, ctx(board.slug), '/x', { ...message, key: 'wrong' })).status,
    401,
  );
  assert.equal(
    (await call(postMessage, ctx(board.slug), '/x', { ...message, key: board.apiKey })).status,
    202,
  );
  // The Settings path: the owner's session is a write credential everywhere.
  assert.equal((await call(postMessage, ctx(board.slug, 'owner'), '/x', message)).status, 202);
  assert.equal((await call(postMessage, ctx(board.slug, 'stranger'), '/x', message)).status, 401);

  assert.equal(
    (await call(flushQueue, ctx(board.slug), '/x', { method: 'DELETE', body: {} })).status,
    401,
  );
  assert.equal(
    (await call(clearBoard, ctx(board.slug), '/x', { method: 'POST', body: {} })).status,
    401,
  );
  assert.equal(
    (await call(patchConfig, ctx(board.slug, 'owner'), '/x', { method: 'PATCH', body: { cardSize: 'small' } }))
      .status,
    200,
  );
  assert.equal(
    (await call(patchConfig, ctx(board.slug, 'stranger'), '/x', { method: 'PATCH', body: { cols: 30 } }))
      .status,
    401,
  );
});

test('boards are created as a type; unknown types are named 422s', async () => {
  const live = await jsonOf(
    call(createBoard, ctx(undefined, 'owner'), '/api/boards', {
      method: 'POST',
      body: { slug: 'typed-board', type: 'live', queueCap: 3 },
    }),
  );
  assert.equal(live.status, 201);
  assert.equal(live.body.type, 'live');

  const bad = await jsonOf(
    call(createBoard, ctx(undefined, 'owner'), '/api/boards', {
      method: 'POST',
      body: { slug: 'weird-board', type: 'hologram' },
    }),
  );
  assert.equal(bad.status, 422);
  assert.match(bad.body.error, /unknown board type/);

  const badParam = await jsonOf(
    call(createBoard, ctx(undefined, 'owner'), '/api/boards', {
      method: 'POST',
      body: { slug: 'capless-board', type: 'live', queueCap: 999 },
    }),
  );
  assert.equal(badParam.status, 422);
  assert.match(badParam.body.error, /queueCap/);
});

test('a live board rolls its queue at the cap instead of refusing', async () => {
  const board = await makeBoard({ slug: 'ticker-board', type: 'live', queueCap: 3 });
  const send = (text) =>
    call(postMessage, ctx(board.slug), '/message', {
      method: 'POST',
      body: { text },
      key: board.apiKey,
    });
  for (const text of ['A', 'B', 'C', 'D']) assert.equal((await send(text)).status, 202);
  const q = (await jsonOf(call(getQueue, ctx(board.slug), '/queue'))).body;
  assert.equal(q.items.length, 3);
  // A is on the glass; B - the oldest waiting - rolled off.
  assert.deepEqual(q.items.map((item) => item.payload.text), ['A', 'C', 'D']);
});

test('deactivation pauses the display, keeps the queue, and exports items', async () => {
  const board = await makeBoard({ slug: 'pause-board' });
  await call(postMessage, ctx(board.slug), '/message', {
    method: 'POST',
    body: { text: 'KEEP ME', loop: true },
    key: board.apiKey,
  });

  const off = await jsonOf(
    call(boardPatch, ctx(board.slug, 'owner'), '/x', {
      method: 'PATCH',
      body: { status: 'deactivated' },
    }),
  );
  assert.equal(off.status, 200);

  const q = (await jsonOf(call(getQueue, ctx(board.slug), '/queue'))).body;
  assert.equal(q.paused, true);
  assert.equal(q.status, 'deactivated');
  assert.equal(q.items.length, 1);

  const exported = (await jsonOf(call(exportQueue, ctx(board.slug, 'owner'), '/export'))).body;
  assert.equal(exported.items.length, 1);
  assert.equal(exported.items[0].payload.text, 'KEEP ME');
  assert.equal(exported.items[0].loop, true);

  // Reactivation is one PATCH; nothing was lost.
  await call(boardPatch, ctx(board.slug, 'owner'), '/x', {
    method: 'PATCH',
    body: { status: 'active' },
  });
  assert.equal((await jsonOf(call(getQueue, ctx(board.slug), '/queue'))).body.paused, false);
});

/* ---- privacy matrix ---- */

test('private boards gate reads: none 403, key 200, ?key= 200, owner 200, stranger 403', async () => {
  const board = await makeBoard({ slug: 'secret-board' });
  await call(boardPatch, ctx(board.slug, 'owner'), '/x', { method: 'PATCH', body: { private: true } });

  const readers = [
    [status, '/status', {}],
    [capabilities, '/capabilities', {}],
    [health, '/health', {}],
    [boardIndex, '/', {}],
    [agentsDoc, '/AGENTS.md', {}],
    [preview, '/preview', { method: 'POST', body: { text: 'X' } }],
  ];

  for (const [handler, path, opts] of readers) {
    assert.equal((await call(handler, ctx(board.slug), path, opts)).status, 403, `anon ${path}`);
    assert.equal(
      (await call(handler, ctx(board.slug, 'stranger'), path, opts)).status,
      403,
      `stranger ${path}`,
    );
    assert.notEqual(
      (await call(handler, ctx(board.slug), path, { ...opts, key: board.apiKey })).status,
      403,
      `bearer ${path}`,
    );
    assert.notEqual(
      (await call(handler, ctx(board.slug), `${path}?key=${board.apiKey}`, opts)).status,
      403,
      `query ${path}`,
    );
    assert.notEqual(
      (await call(handler, ctx(board.slug, 'owner'), path, opts)).status,
      403,
      `owner ${path}`,
    );
  }
});

test('public boards keep open reads', async () => {
  const board = await makeBoard();
  assert.equal((await call(status, ctx(board.slug), '/status')).status, 200);
  assert.equal(
    (await call(preview, ctx(board.slug), '/preview', { method: 'POST', body: { text: 'HI' } })).status,
    200,
  );
  const doc = await call(agentsDoc, ctx(board.slug), '/AGENTS.md');
  assert.equal(doc.status, 200);
  const text = await doc.text();
  assert.ok(text.includes(`${BASE}/api/b/${board.slug}/message`));
  assert.ok(text.includes('API key'));
});

/* ---- messages ---- */

test('a message lands in the server queue and nudges displays', async () => {
  const board = await makeBoard();
  const { status: code, body } = await jsonOf(
    call(postMessage, ctx(board.slug), '/message', {
      method: 'POST',
      body: { text: 'HELLO' },
      key: board.apiKey,
    }),
  );
  assert.equal(code, 202);
  assert.ok(body.id);
  assert.equal(body.loop, false);
  // A person's count, not the ordering key: first in line, nothing ahead.
  assert.equal(body.position, 1);
  assert.equal(body.ahead, 0);
  const second = (
    await jsonOf(call(postMessage, ctx(board.slug), '/message', { method: 'POST', body: { text: 'TWO' }, key: board.apiKey }))
  ).body;
  assert.equal(second.position, 2);
  assert.equal(second.ahead, 1);
  const jumped = (
    await jsonOf(
      call(postMessage, ctx(board.slug), '/message', { method: 'POST', body: { text: 'NOW', priority: 'now' }, key: board.apiKey }),
    )
  ).body;
  assert.equal(jumped.position, 1);
  await call(deleteQueueItem, { ...ctx(board.slug), itemId: second.id }, `/queue/${second.id}`, { method: 'DELETE', key: board.apiKey });
  await call(deleteQueueItem, { ...ctx(board.slug), itemId: jumped.id }, `/queue/${jumped.id}`, { method: 'DELETE', key: board.apiKey });

  const q = (await jsonOf(call(getQueue, ctx(board.slug), '/queue'))).body;
  assert.equal(q.items.length, 1);
  assert.equal(q.items[0].payload.text, 'HELLO');
  assert.equal(q.currentItemId, body.id);
  assert.equal(q.currentState, 'playing');

  const [nudged] = await broker.commandsAfter(board.boardId, '0', 10);
  assert.equal(nudged.cmd.method, 'sync');
  assert.equal(nudged.cmd.params.currentItemId, body.id);
});

test('priorities place items; repeat is accepted as the loop alias', async () => {
  const board = await makeBoard();
  const send = (body) =>
    jsonOf(call(postMessage, ctx(board.slug), '/message', { method: 'POST', body, key: board.apiKey }));
  await send({ text: 'A' });
  await send({ text: 'B' });
  await send({ text: 'NEXT', priority: 'next' });
  const now = await send({ text: 'NOW', priority: 'now', repeat: true });
  assert.equal(now.body.loop, true);

  const q = (await jsonOf(call(getQueue, ctx(board.slug), '/queue'))).body;
  assert.deepEqual(q.items.map((item) => item.payload.text), ['NOW', 'A', 'NEXT', 'B']);
  assert.equal(q.currentItemId, now.body.id);
});

test('invalid options are refused with the desktop wording', async () => {
  const board = await makeBoard();
  for (const [body, pattern] of [
    [{ text: 'X', priority: 'urgent' }, /priority must be one of normal, next, now/],
    [{ rows: ['AB'], align: 'left' }, /align does not apply when rows is given/],
    [{ text: 'X', region: '  ' }, /region must be a non-empty string/],
    [{ text: 'X', repeat: 'true' }, /repeat must be true or false/],
  ]) {
    const result = await jsonOf(
      call(postMessage, ctx(board.slug), '/message', { method: 'POST', body, key: board.apiKey }),
    );
    assert.equal(result.status, 422, JSON.stringify(body));
    assert.match(result.body.error, pattern);
  }
});

test('bands are deferred: any non-main region is refused', async () => {
  const board = await makeBoard();
  const result = await jsonOf(
    call(postMessage, ctx(board.slug), '/message', {
      method: 'POST',
      body: { text: 'X', region: 'footer' },
      key: board.apiKey,
    }),
  );
  assert.equal(result.status, 422);
  assert.match(result.body.error, /multi-band.*future release/);
  // Naming main explicitly still works.
  const ok = await call(postMessage, ctx(board.slug), '/message', {
    method: 'POST',
    body: { text: 'X', region: 'main' },
    key: board.apiKey,
  });
  assert.equal(ok.status, 202);
});

test('a malformed body is a 400 and an oversized one a 413', async () => {
  const board = await makeBoard();
  const opts = { method: 'POST', key: board.apiKey };
  assert.equal(
    (await call(postMessage, ctx(board.slug), '/message', { ...opts, body: '{oops' })).status,
    400,
  );
  assert.equal(
    (await call(postMessage, ctx(board.slug), '/message', { ...opts, body: '[1,2]' })).status,
    400,
  );
  const huge = JSON.stringify({ text: 'A'.repeat(300 * 1024) });
  assert.equal(
    (await call(postMessage, ctx(board.slug), '/message', { ...opts, body: huge })).status,
    413,
  );
});

/* ---- preview & capabilities ---- */

test('preview lays out against the stored config and reports diagnostics', async () => {
  const board = await makeBoard();
  const { status: code, body } = await jsonOf(
    call(preview, ctx(board.slug), '/preview', { method: 'POST', body: { text: 'R&D 50%' } }),
  );
  assert.equal(code, 200);
  assert.ok(body.pages[0].some((line) => line.includes('R AND D')));
  assert.ok(body.diagnostics);
  assert.ok(body.estimatedMs > 0);
});

test('preview refuses priority and repeat', async () => {
  const board = await makeBoard();
  for (const body of [{ text: 'X', priority: 'now' }, { text: 'X', repeat: true }]) {
    const result = await jsonOf(
      call(preview, ctx(board.slug), '/preview', { method: 'POST', body }),
    );
    assert.equal(result.status, 422);
    assert.match(result.body.error, /does not apply to preview/);
  }
});

test('capabilities and config round-trip through Postgres, and nudge displays', async () => {
  const board = await makeBoard();
  const before = (await jsonOf(call(capabilities, ctx(board.slug), '/capabilities'))).body;
  assert.deepEqual(before.regions, ['main']);
  assert.equal(before.grid.cols, 20);

  const patched = await jsonOf(
    call(patchConfig, ctx(board.slug), '/config', {
      method: 'PATCH',
      body: { cardSize: 'small' },
      key: board.apiKey,
    }),
  );
  assert.equal(patched.status, 200);

  const after = (await jsonOf(call(capabilities, ctx(board.slug), '/capabilities'))).body;
  // The grid the card size makes, because a board no longer stores one.
  assert.equal(after.grid.cols, gridFor('small').cols);

  const commands = await broker.commandsAfter(board.boardId, '0', 10);
  assert.equal(commands[0].cmd.method, 'sync');
});

test('a board\'s own theme: stored sparse, kept out of /queue, served by /theme with a revision', async () => {
  const board = await makeBoard();
  const before = (await jsonOf(call(getQueue, ctx(board.slug), '/queue'))).body;
  assert.match(before.themeRev, /^[0-9a-f]{16}$/);
  assert.equal('themePack' in before.config, false);

  // Send a whole-ish pack; what is stored is the difference from Classic.
  const patched = await jsonOf(
    call(patchConfig, ctx(board.slug), '/config', {
      method: 'PATCH',
      body: { themePack: { card: { fill: '#f4efe6', edge: '#000000' }, glyph: { fill: '#1f2a44' } } },
      key: board.apiKey,
    }),
  );
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  assert.deepEqual(patched.body.config.themePack, { card: { fill: '#f4efe6' }, glyph: { fill: '#1f2a44' } });
  assert.notEqual(patched.body.themeRev, before.themeRev);

  const after = (await jsonOf(call(getQueue, ctx(board.slug), '/queue'))).body;
  assert.equal(after.themeRev, patched.body.themeRev);
  assert.equal('themePack' in after.config, false, 'the pack does not ride along with every queue poll');

  const theme = await call(getTheme, ctx(board.slug), '/theme');
  assert.equal(theme.status, 200);
  assert.equal(theme.headers.get('etag'), `"${after.themeRev}"`);
  const themeBody = await theme.json();
  assert.equal(themeBody.theme, 'classic');
  assert.deepEqual(themeBody.themePack, { card: { fill: '#f4efe6' }, glyph: { fill: '#1f2a44' } });
  assert.equal(themeBody.pack.card.fill, '#f4efe6');
  assert.equal(themeBody.pack.card.edge, '#000000');
  assert.equal(themeBody.rev, after.themeRev);

  const unchanged = await call(getTheme, ctx(board.slug), '/theme', { headers: { 'if-none-match': `"${after.themeRev}"` } });
  assert.equal(unchanged.status, 304);

  // An unrelated config change leaves the revision alone.
  await call(patchConfig, ctx(board.slug), '/config', { method: 'PATCH', body: { cols: 24 }, key: board.apiKey });
  assert.equal((await jsonOf(call(getQueue, ctx(board.slug), '/queue'))).body.themeRev, after.themeRev);

  // Switching preset keeps the overrides that still differ.
  const swapped = await jsonOf(
    call(patchConfig, ctx(board.slug), '/config', { method: 'PATCH', body: { theme: 'canary' }, key: board.apiKey }),
  );
  assert.equal(swapped.body.config.theme, 'canary');
  assert.notEqual(swapped.body.themeRev, after.themeRev);

  // null resets.
  const reset = await jsonOf(
    call(patchConfig, ctx(board.slug), '/config', { method: 'PATCH', body: { themePack: null }, key: board.apiKey }),
  );
  assert.equal(reset.body.config.themePack, null);

  // Refusals carry the validator's words and statuses.
  const bad = await jsonOf(
    call(patchConfig, ctx(board.slug), '/config', { method: 'PATCH', body: { themePack: { glyph: { fill: 'nope' } } }, key: board.apiKey }),
  );
  assert.equal(bad.status, 422);
  assert.match(bad.body.error, /glyph.fill/);
  const fat = await jsonOf(
    call(patchConfig, ctx(board.slug), '/config', {
      method: 'PATCH',
      body: { themePack: { card: { fill: '#' + 'f'.repeat(70000) } } },
      key: board.apiKey,
    }),
  );
  assert.equal(fat.status, 413);

  const caps = (await jsonOf(call(capabilities, ctx(board.slug), '/capabilities'))).body;
  assert.deepEqual(caps.themePack.presets.map((p) => p.id), ['classic', 'canary', 'sorbet', 'carnival', 'carrow-road-yellow', 'carrow-road-green']);
  assert.equal(typeof caps.themePack.maxBytes, 'number');
});

test('/theme follows the board\'s read access: private boards need the key or the owner', async () => {
  const board = await makeBoard();
  await call(boardPatch, ctx(board.slug, 'owner'), '/x', { method: 'PATCH', body: { private: true } });
  assert.equal((await call(getTheme, ctx(board.slug), '/theme')).status, 403);
  assert.equal((await call(getTheme, ctx(board.slug, 'stranger'), '/theme')).status, 403);
  assert.equal((await call(getTheme, ctx(board.slug), '/theme', { key: board.apiKey })).status, 200);
  assert.equal((await call(getTheme, ctx(board.slug, 'owner'), '/theme')).status, 200);
});

test('bands cannot be configured back in yet: footerRows and per-band settings 422', async () => {
  const board = await makeBoard();
  for (const body of [{ footerRows: 2 }, { regions: { footer: { dwellMs: 8000 } } }]) {
    const result = await jsonOf(
      call(patchConfig, ctx(board.slug), '/config', { method: 'PATCH', body, key: board.apiKey }),
    );
    assert.equal(result.status, 422, JSON.stringify(body));
    assert.match(result.body.error, /future release/);
  }
  // footerRows: 0 stays legal - it is the current truth.
  const zero = await call(patchConfig, ctx(board.slug), '/config', {
    method: 'PATCH',
    body: { footerRows: 0 },
    key: board.apiKey,
  });
  assert.equal(zero.status, 200);
});

test('an account with no licence cannot create a board at all', async () => {
  const denied = await jsonOf(
    call(
      createBoard,
      ctx(undefined, 'owner', stubLicence({ licensed: false, maxBoards: 0, types: [], privateBoards: false, source: 'salable' })),
      '/api/boards',
      { method: 'POST', body: { slug: 'no-licence' } },
    ),
  );
  assert.equal(denied.status, 403);
  assert.match(denied.body.error, /licence/);
  assert.equal(denied.body.need, 'board_create');
});

test('the free allowance is one board, and the second is a 402 that says get in touch', async () => {
  const free = stubLicence({ licensed: true, maxBoards: 1, types: ['live'], privateBoards: false, source: 'salable' });
  const first = await jsonOf(
    call(createBoard, ctx(undefined, 'owner', free), '/api/boards', {
      method: 'POST',
      body: { slug: 'first-board' },
    }),
  );
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const second = await jsonOf(
    call(createBoard, ctx(undefined, 'owner', free), '/api/boards', {
      method: 'POST',
      body: { slug: 'second-board' },
    }),
  );
  assert.equal(second.status, 402);
  assert.match(second.body.error, /covers 1 board/);
  assert.match(second.body.error, /get in touch/);
});

test('a type that names an entitlement is refused with a 402 without it - on the shared create path', async () => {
  // Not a synthetic type: `scheduled` names board_type_scheduled, so this is
  // the shipped paywall, on the path the MCP create_board tool shares.
  const free = stubLicence({ licensed: true, maxBoards: 5, types: ['live'], privateBoards: false, source: 'salable' });
  const denied = await jsonOf(
    call(createBoard, ctx(undefined, 'owner', free), '/api/boards', {
      method: 'POST',
      body: { slug: 'clock-board', type: 'scheduled' },
    }),
  );
  assert.equal(denied.status, 402);
  assert.equal(denied.body.need, 'board_type_scheduled');
  assert.match(denied.body.error, /get in touch/);
  assert.match(denied.body.getInTouch, /need=board_type_scheduled$/);

  // Grant it and the identical request goes through.
  const paid = stubLicence({
    licensed: true,
    maxBoards: 5,
    types: ['live', 'scheduled'],
    privateBoards: false,
    source: 'salable',
  });
  const allowed = await jsonOf(
    call(createBoard, ctx(undefined, 'owner', paid), '/api/boards', {
      method: 'POST',
      body: { slug: 'clock-board', type: 'scheduled' },
    }),
  );
  assert.equal(allowed.status, 201, JSON.stringify(allowed.body));
});

test('at the limit and asking for a paid type, the type is what you are told about', async () => {
  // Two things are wrong and only one refusal fits in a response. "Delete a
  // board first" would send someone to delete a board and hit a second no.
  const free = stubLicence({ licensed: true, maxBoards: 1, types: ['live'], privateBoards: false, source: 'salable' });
  await jsonOf(
    call(createBoard, ctx(undefined, 'owner', free), '/api/boards', { method: 'POST', body: { slug: 'the-one' } }),
  );
  const refused = await jsonOf(
    call(createBoard, ctx(undefined, 'owner', free), '/api/boards', {
      method: 'POST',
      body: { slug: 'a-clock', type: 'scheduled' },
    }),
  );
  assert.equal(refused.status, 402);
  assert.equal(refused.body.need, 'board_type_scheduled');
});

test('going private needs the entitlement; coming back public never does', async () => {
  const free = stubLicence({ licensed: true, maxBoards: 5, types: ['live'], privateBoards: false, source: 'salable' });
  const board = await makeBoard({ slug: 'privacy-licence' });
  const denied = await jsonOf(
    call(boardPatch, ctx(board.slug, 'owner', free), '/api/boards', {
      method: 'PATCH',
      body: { private: true },
    }),
  );
  assert.equal(denied.status, 402);
  assert.equal(denied.body.need, 'board_private');

  const paid = stubLicence({ licensed: true, maxBoards: 5, types: ['live'], privateBoards: true, source: 'salable' });
  const hidden = await jsonOf(
    call(boardPatch, ctx(board.slug, 'owner', paid), '/api/boards', {
      method: 'PATCH',
      body: { private: true },
    }),
  );
  assert.equal(hidden.status, 200);
  assert.equal(hidden.body.private, true);

  // The licence lapses. What it did stays undoable.
  const shown = await jsonOf(
    call(boardPatch, ctx(board.slug, 'owner', free), '/api/boards', {
      method: 'PATCH',
      body: { private: false },
    }),
  );
  assert.equal(shown.status, 200);
  assert.equal(shown.body.private, false);
});

test('a 402 tells a machine what was refused and a person where to go about it', async () => {
  const free = stubLicence({ licensed: true, maxBoards: 1, types: ['live'], privateBoards: false, source: 'salable' });
  await jsonOf(
    call(createBoard, ctx(undefined, 'owner', free), '/api/boards', { method: 'POST', body: { slug: 'only-one' } }),
  );
  const refused = await jsonOf(
    call(createBoard, ctx(undefined, 'owner', free), '/api/boards', { method: 'POST', body: { slug: 'one-more' } }),
  );
  assert.equal(refused.status, 402);
  // The words are for the person; these two are for whatever is calling.
  assert.equal(refused.body.need, 'boards');
  assert.equal(refused.body.getInTouch, `${BASE}/account/licence?need=boards`);
});

test('a get-in-touch ask is saved, and asking twice is the same ask rather than a second lead', async () => {
  const first = await jsonOf(
    call(requestLicence, ctx(undefined, 'owner'), '/api/licence-requests', {
      method: 'POST',
      body: { need: 'boards', message: 'Six departure boards, one per platform.' },
    }),
  );
  assert.equal(first.status, 201);
  assert.equal(first.body.request.need, 'boards');
  assert.equal(first.body.request.handledAt, null);

  const again = await jsonOf(
    call(requestLicence, ctx(undefined, 'owner'), '/api/licence-requests', {
      method: 'POST',
      body: { need: 'boards', message: 'Still six.' },
    }),
  );
  assert.equal(again.status, 200);
  assert.equal(again.body.alreadyOpen, true);
  assert.equal(again.body.request.id, first.body.request.id);

  // A different need is a different ask.
  const other = await jsonOf(
    call(requestLicence, ctx(undefined, 'owner'), '/api/licence-requests', {
      method: 'POST',
      body: { need: 'board_private', message: 'Staff-only rota.' },
    }),
  );
  assert.equal(other.status, 201);

  const mine = await jsonOf(call(listLicenceRequests, ctx(undefined, 'owner'), '/api/licence-requests'));
  assert.equal(mine.status, 200);
  assert.equal(mine.body.requests.length, 2);
  assert.equal(mine.body.requestable.boards, 'More boards');
  // Somebody else's queue is not yours.
  const theirs = await jsonOf(call(listLicenceRequests, ctx(undefined, 'stranger'), '/api/licence-requests'));
  assert.equal(theirs.body.requests.length, 0);
});

test('a need outside the list is refused by name, and a blank ask is refused too', async () => {
  const unknown = await jsonOf(
    call(requestLicence, ctx(undefined, 'owner'), '/api/licence-requests', {
      method: 'POST',
      body: { need: 'board.everything', message: 'the lot' },
    }),
  );
  assert.equal(unknown.status, 422);
  assert.match(unknown.body.error, /board_type_scheduled/);

  const blank = await jsonOf(
    call(requestLicence, ctx(undefined, 'owner'), '/api/licence-requests', {
      method: 'POST',
      body: { need: 'boards', message: '   ' },
    }),
  );
  assert.equal(blank.status, 422);
  assert.match(blank.body.error, /what you need it for/);
});

test('nobody asks us anything anonymously', async () => {
  const anon = await jsonOf(
    call(requestLicence, ctx(undefined), '/api/licence-requests', {
      method: 'POST',
      body: { need: 'boards', message: 'hello' },
    }),
  );
  assert.equal(anon.status, 401);
});

test('a patched type param is validated by its own schema and stored coerced', async () => {
  const board = await makeBoard();
  const patch = (body) =>
    jsonOf(call(patchConfig, ctx(board.slug), '/config', { method: 'PATCH', body, key: board.apiKey }));
  const bad = await patch({ queueCap: 'abc' });
  assert.equal(bad.status, 422);
  assert.match(bad.body.error, /queueCap/);
  const tooBig = await patch({ queueCap: 500 });
  assert.equal(tooBig.status, 422);
  const good = await patch({ queueCap: '7' });
  assert.equal(good.status, 200);
  assert.equal(good.body.config.queueCap, 7, 'the number, not the string');
});

/* ---- flush & clear ---- */

test('flush drops pending with a synchronous count; clear empties and blanks', async () => {
  const board = await makeBoard();
  const key = board.apiKey;
  const send = (text) =>
    call(postMessage, ctx(board.slug), '/message', { method: 'POST', body: { text }, key });
  await send('A');
  await send('B');
  await send('C');

  const flushed = await jsonOf(
    call(flushQueue, ctx(board.slug), '/queue', { method: 'DELETE', body: {}, key }),
  );
  assert.equal(flushed.status, 200);
  assert.equal(flushed.body.removed, 2); // the current item keeps playing

  const cleared = await jsonOf(
    call(clearBoard, ctx(board.slug), '/clear', { method: 'POST', body: {}, key }),
  );
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.removed, 1);

  const q = (await jsonOf(call(getQueue, ctx(board.slug), '/queue'))).body;
  assert.equal(q.items.length, 0);
  assert.equal(q.currentState, 'idle');
  const last = (await broker.commandsAfter(board.boardId, '0', 100)).at(-1);
  assert.equal(last.cmd.method, 'clear');
});

test('the queue is editable over the API: patch, delete, reorder', async () => {
  const board = await makeBoard();
  const key = board.apiKey;
  const send = async (text) =>
    (await jsonOf(
      call(postMessage, ctx(board.slug), '/message', { method: 'POST', body: { text }, key }),
    )).body.id;
  const a = await send('A');
  const b = await send('B');
  const c = await send('C');

  const edited = await jsonOf(
    call(patchQueueItem, { ...ctx(board.slug), itemId: b }, '/queue/items/x', {
      method: 'PATCH',
      body: { text: 'B EDITED', loop: true },
      key,
    }),
  );
  assert.equal(edited.status, 200);
  assert.equal(edited.body.item.payload.text, 'B EDITED');
  assert.equal(edited.body.item.loop, true);

  assert.equal(
    (await call(reorderQueue, ctx(board.slug), '/queue/reorder', {
      method: 'POST',
      body: { itemId: c, afterId: null },
      key,
    })).status,
    200,
  );
  assert.equal(
    (await call(deleteQueueItem, { ...ctx(board.slug), itemId: b }, '/queue/items/x', {
      method: 'DELETE',
      key,
    })).status,
    200,
  );
  const q = (await jsonOf(call(getQueue, ctx(board.slug), '/queue'))).body;
  assert.deepEqual(q.items.map((item) => item.payload.text), ['A', 'C']);
  assert.equal(q.currentItemId, a);

  // Strangers cannot touch the queue.
  assert.equal(
    (await call(deleteQueueItem, { ...ctx(board.slug, 'stranger'), itemId: a }, '/x', {
      method: 'DELETE',
    })).status,
    401,
  );
});

test('advance needs a display credential and is idempotent per play', async () => {
  const board = await makeBoard();
  const key = board.apiKey;
  const send = async (text) =>
    (await jsonOf(
      call(postMessage, ctx(board.slug), '/message', { method: 'POST', body: { text }, key }),
    )).body.id;
  const a = await send('A');
  await send('B');
  const q = (await jsonOf(call(getQueue, ctx(board.slug), '/queue'))).body;

  // A public board's audience cannot fast-forward it.
  const anon = await call(advanceQueue, ctx(board.slug), '/queue/advance', {
    method: 'POST',
    body: { itemId: a, epoch: q.epoch },
  });
  assert.equal(anon.status, 401);

  const displayToken = await mintDisplayToken({ id: board.boardId, apiKey: key });
  const first = await jsonOf(
    call(advanceQueue, ctx(board.slug), '/queue/advance', {
      method: 'POST',
      body: { itemId: a, epoch: q.epoch },
      key: displayToken,
    }),
  );
  assert.equal(first.status, 200);
  assert.equal(first.body.advanced, true);
  assert.equal(first.body.current.payload.text, 'B');

  // The mirror's duplicate report is a no-op that returns the truth.
  const dupe = await jsonOf(
    call(advanceQueue, ctx(board.slug), '/queue/advance', {
      method: 'POST',
      body: { itemId: a, epoch: q.epoch },
      key: displayToken,
    }),
  );
  assert.equal(dupe.body.advanced, false);
  assert.equal(dupe.body.current.payload.text, 'B');
});

/* ---- state & status ---- */

test('status is honest about a display that has never reported', async () => {
  const board = await makeBoard();
  const { body } = await jsonOf(call(status, ctx(board.slug), '/status'));
  assert.equal(body.boardReady, false);
  assert.equal(body.stale, true);
  assert.equal(body.showing, null);
});

test('state posts are display writes: credentialed, spoof-proof, stale-dropped', async () => {
  const board = await makeBoard();
  const snapshot = { showing: { id: 'm1' }, lines: ['HELLO'], regions: {} };

  // No credential: the audience cannot rewrite /status.
  assert.equal(
    (await call(postState, ctx(board.slug), '/state', { method: 'POST', body: { state: snapshot } }))
      .status,
    401,
  );

  const displayToken = await mintDisplayToken({ id: board.boardId, apiKey: board.apiKey });
  assert.equal(
    (await call(postState, ctx(board.slug), '/state', {
      method: 'POST',
      body: { state: snapshot },
      key: displayToken,
    })).status,
    200,
  );
  const { body } = await jsonOf(call(status, ctx(board.slug), '/status'));
  assert.equal(body.stale, false);
  assert.equal(body.frozen, false);
  assert.deepEqual(body.lines, ['HELLO']);
  const healthy = (await jsonOf(call(health, ctx(board.slug), '/health'))).body;
  assert.equal(healthy.boardReady, true);
  assert.equal(healthy.frozen, false);

  // A hidden tab keeps heartbeating but cannot animate: connected, and frozen.
  await call(postState, ctx(board.slug), '/state', {
    method: 'POST',
    body: { state: { ...snapshot, animating: true, display: { visibility: 'hidden', lastFrameAgeMs: 45_000 } } },
    key: displayToken,
  });
  const hidden = (await jsonOf(call(status, ctx(board.slug), '/status'))).body;
  assert.equal(hidden.boardReady, true);
  assert.equal(hidden.frozen, true);
  assert.equal(hidden.display.visibility, 'hidden');

  // A stale mirror replaying an old item is acknowledged but ignored.
  const stale = await jsonOf(
    call(postState, ctx(board.slug), '/state', {
      method: 'POST',
      body: { state: { ...snapshot, lines: ['OLD'], playingItemId: 'ghost' } },
      key: displayToken,
    }),
  );
  assert.equal(stale.body.ignored, 'stale item');
  assert.deepEqual((await jsonOf(call(status, ctx(board.slug), '/status'))).body.lines, ['HELLO']);

  const empty = await call(postState, ctx(board.slug), '/state', {
    method: 'POST',
    body: {},
    key: displayToken,
  });
  assert.equal(empty.status, 422);
});

/* ---- stream generators ---- */

function instantSleep() {
  return Promise.resolve();
}

test('commandEvents replays from the cursor, then follows new commands', async () => {
  const board = await makeBoard();
  const first = await broker.appendCommand(board.boardId, { method: 'enqueue', params: { text: 'A' } });
  await broker.appendCommand(board.boardId, { method: 'enqueue', params: { text: 'B' } });

  const seen = [];
  for await (const event of commandEvents(broker, board.boardId, first, {
    windowMs: 3000,
    sleep: instantSleep,
  })) {
    if (event.type === 'command') seen.push(event.cmd.params.text);
    if (seen.length === 2) break;
    if (seen.length === 1) {
      await broker.appendCommand(board.boardId, { method: 'enqueue', params: { text: 'C' } });
    }
  }
  assert.deepEqual(seen, ['B', 'C']);
});

test('stateEvents emits only when the snapshot moves', async () => {
  const board = await makeBoard();
  await broker.setState(board.boardId, { lines: ['ONE'] });
  const seen = [];
  let posted = false;
  for await (const event of stateEvents(broker, board.boardId, {
    windowMs: 10_000,
    sleep: async () => {
      if (!posted) {
        posted = true;
        await new Promise((resolve) => setTimeout(resolve, 2));
        await broker.setState(board.boardId, { lines: ['TWO'] });
      }
    },
  })) {
    if (event.type === 'state') seen.push(event.state.lines[0]);
  }
  assert.deepEqual(seen, ['ONE', 'TWO']);
});

/* ---- scheduled boards ---- */

test('a scheduled board rejects a bad timezone and accepts a good one', async () => {
  const bad = await jsonOf(
    call(createBoard, ctx(undefined, 'owner'), '/api/boards', {
      method: 'POST',
      body: { type: 'scheduled', slug: 'bad-tz', timezone: 'Mars/Olympus' },
    }),
  );
  assert.equal(bad.status, 422);
  assert.match(bad.body.error, /IANA timezone/);

  const board = await makeBoard({
    slug: 'clock-board',
    type: 'scheduled',
    timezone: 'Europe/London',
    fallback: 'STAND BY',
  });
  assert.equal(board.type, 'scheduled');
});

test('schedule specs are stored, validated, and refused on live boards', async () => {
  const live = await makeBoard({ slug: 'live-one' });
  const refused = await jsonOf(
    call(postMessage, ctx(live.slug), '/x', {
      method: 'POST',
      key: live.apiKey,
      body: { text: 'NOPE', schedule: { kind: 'daily', at: '09:00' } },
    }),
  );
  assert.equal(refused.status, 422);
  assert.match(refused.body.error, /no clock/);

  const board = await makeBoard({ slug: 'clock-two', type: 'scheduled', fallback: 'STAND BY' });
  const junk = await jsonOf(
    call(postMessage, ctx(board.slug), '/x', {
      method: 'POST',
      key: board.apiKey,
      body: { text: 'X', schedule: { kind: 'daily', at: '25:99' } },
    }),
  );
  assert.equal(junk.status, 422);

  const posted = await jsonOf(
    call(postMessage, ctx(board.slug), '/x', {
      method: 'POST',
      key: board.apiKey,
      body: { text: 'LUNCH', schedule: { kind: 'daily', at: '12:00', durationMs: 60_000 } },
    }),
  );
  assert.equal(posted.status, 202);
  assert.deepEqual(posted.body.schedule, { kind: 'daily', at: '12:00', durationMs: 60_000 });

  const q = await jsonOf(call(getQueue, ctx(board.slug), '/x'));
  assert.equal(q.body.playback, 'clock');
  assert.equal(q.body.items.length, 1);
  assert.ok(q.body.items[0].computedDurationMs >= 3000);
  assert.ok('activeItemId' in q.body, 'clock extras merged into the snapshot');
});

test('expiresInMs: accepted and materialized on a live board, refused on a scheduled one, editable via PATCH', async () => {
  const live = await makeBoard({ slug: 'expiry-live' });
  const before = Date.now();
  const posted = await jsonOf(
    call(postMessage, ctx(live.slug), '/x', {
      method: 'POST',
      key: live.apiKey,
      body: { text: 'ALERT', interrupt: true, priority: 'now', expiresInMs: 180_000 },
    }),
  );
  assert.equal(posted.status, 202);
  const q = await jsonOf(call(getQueue, ctx(live.slug), '/x'));
  const item = q.body.items.find((entry) => entry.id === posted.body.id);
  assert.ok(item.expiresAtMs >= before + 180_000);

  const cleared = await jsonOf(
    call(patchQueueItem, { ...ctx(live.slug), itemId: item.id }, '/x', {
      method: 'PATCH',
      body: { expiresInMs: null },
      key: live.apiKey,
    }),
  );
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.item.expiresAtMs, null);

  const bad = await jsonOf(
    call(postMessage, ctx(live.slug), '/x', {
      method: 'POST',
      key: live.apiKey,
      body: { text: 'X', expiresInMs: -5 },
    }),
  );
  assert.equal(bad.status, 422);

  const clock = await makeBoard({ slug: 'expiry-clock', type: 'scheduled', fallback: 'STAND BY' });
  const refused = await jsonOf(
    call(postMessage, ctx(clock.slug), '/x', {
      method: 'POST',
      key: clock.apiKey,
      body: { text: 'X', expiresInMs: 60_000 },
    }),
  );
  assert.equal(refused.status, 422);
  assert.match(refused.body.error, /expiresInMs does not apply/);
});

test('saved interrupters: save, list, edit-by-resaving, fire by name, delete - never a door from typed text straight to the glass', async () => {
  const board = await makeBoard({ slug: 'interrupter-board' });
  const key = board.apiKey;

  const empty = await jsonOf(call(listInterrupters, ctx(board.slug), '/x'));
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.interrupters, []);

  const saved = await jsonOf(
    call(saveInterrupter, ctx(board.slug), '/x', {
      method: 'POST',
      key,
      body: { name: 'FIRE', text: 'FIRE EVACUATE' },
    }),
  );
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(saved.body.interrupters, [{ name: 'FIRE', text: 'FIRE EVACUATE' }]);

  // Naming an existing one again replaces it outright - editing is
  // re-saving, not a separate PATCH.
  const edited = await jsonOf(
    call(saveInterrupter, ctx(board.slug), '/x', {
      method: 'POST',
      key,
      body: { name: 'FIRE', text: 'FIRE - EVACUATE NOW', durationMs: 60_000 },
    }),
  );
  assert.equal(edited.status, 200);
  assert.equal(edited.body.interrupters.length, 1, 'replaced, not appended');
  assert.deepEqual(edited.body.interrupters[0], {
    name: 'FIRE',
    text: 'FIRE - EVACUATE NOW',
    durationMs: 60_000,
  });

  // Firing by a name that was never saved finds nothing to fire.
  const missing = await jsonOf(call(fireInterrupter, { ...ctx(board.slug), name: 'GOAL' }, '/x', { method: 'POST', key }));
  assert.equal(missing.status, 404);

  // Firing posts exactly the saved fields, through the same door a live
  // message post would - priority: now, interrupt: true, its name as the
  // item's own label, and its Duration translated to a hard limit: shown
  // for exactly that long, and gone outright once it's up.
  const fired = await jsonOf(call(fireInterrupter, { ...ctx(board.slug), name: 'FIRE' }, '/x', { method: 'POST', key }));
  assert.equal(fired.status, 202, JSON.stringify(fired.body));
  const q = (await jsonOf(call(getQueue, ctx(board.slug), '/x'))).body;
  const item = q.items.find((entry) => entry.id === fired.body.id);
  assert.equal(item.payload.text, 'FIRE - EVACUATE NOW');
  assert.equal(item.payload.options.interrupt, true);
  assert.equal(item.payload.options.label, 'FIRE');
  assert.equal(item.payload.options.dwellMs, 60_000);
  assert.ok(item.expiresAtMs > Date.now(), 'durationMs materialized as expiresAtMs at fire time');
  assert.equal(q.currentItemId, fired.body.id);

  // No door from typed text straight to the glass: nothing here posts to
  // the live queue except by naming something already saved.
  const missingName = await jsonOf(
    call(saveInterrupter, ctx(board.slug), '/x', { method: 'POST', key, body: { text: 'X' } }),
  );
  assert.equal(missingName.status, 422);

  const deleted = await jsonOf(call(deleteInterrupter, { ...ctx(board.slug), name: 'FIRE' }, '/x', { method: 'DELETE', key }));
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.body.interrupters, []);
  const goneAgain = await jsonOf(call(deleteInterrupter, { ...ctx(board.slug), name: 'FIRE' }, '/x', { method: 'DELETE', key }));
  assert.equal(goneAgain.status, 404);

  // Writes need the key; a stranger can neither save nor fire.
  const noKey = await jsonOf(
    call(saveInterrupter, ctx(board.slug), '/x', { method: 'POST', body: { name: 'X', text: 'X' } }),
  );
  assert.equal(noKey.status, 401);
});

test('reordering saved interrupters: the rail order is the only ranking one has', async () => {
  const board = await makeBoard({ slug: 'interrupter-order' });
  const key = board.apiKey;
  for (const name of ['A', 'B', 'C']) {
    await jsonOf(call(saveInterrupter, ctx(board.slug), '/x', { method: 'POST', key, body: { name, text: name } }));
  }
  const before = await jsonOf(call(listInterrupters, ctx(board.slug), '/x'));
  assert.deepEqual(before.body.interrupters.map((i) => i.name), ['A', 'B', 'C']);

  const reordered = await jsonOf(
    call(reorderInterrupters, ctx(board.slug), '/x', { method: 'POST', key, body: { names: ['C', 'A', 'B'] } }),
  );
  assert.equal(reordered.status, 200, JSON.stringify(reordered.body));
  assert.deepEqual(reordered.body.interrupters.map((i) => i.name), ['C', 'A', 'B']);
  // Text and settings ride along untouched - only order moved.
  assert.equal(reordered.body.interrupters[0].text, 'C');

  const missing = await jsonOf(
    call(reorderInterrupters, ctx(board.slug), '/x', { method: 'POST', key, body: { names: ['A', 'B'] } }),
  );
  assert.equal(missing.status, 422, 'must name every saved interrupter exactly once');

  const unknown = await jsonOf(
    call(reorderInterrupters, ctx(board.slug), '/x', { method: 'POST', key, body: { names: ['A', 'B', 'ZZZ'] } }),
  );
  assert.equal(unknown.status, 422);

  const noKey = await jsonOf(
    call(reorderInterrupters, ctx(board.slug), '/x', { method: 'POST', body: { names: ['C', 'A', 'B'] } }),
  );
  assert.equal(noKey.status, 401);

  // Name matching is case-insensitive everywhere else (save/delete/fire); a
  // reorder that echoes a name back in a different case is the same name,
  // not an unknown one.
  const differentCase = await jsonOf(
    call(reorderInterrupters, ctx(board.slug), '/x', { method: 'POST', key, body: { names: ['c', 'a', 'b'] } }),
  );
  assert.equal(differentCase.status, 200, JSON.stringify(differentCase.body));
  // The stored casing is untouched - reorder moves entries, it does not rename them.
  assert.deepEqual(differentCase.body.interrupters.map((i) => i.name), ['C', 'A', 'B']);

  // A non-string entry must not throw past the shape check.
  const badShape = await jsonOf(
    call(reorderInterrupters, ctx(board.slug), '/x', { method: 'POST', key, body: { names: ['C', 'A', 42] } }),
  );
  assert.equal(badShape.status, 422);
});

test('saved-interrupter rank is enforced: a lower one cannot break a higher one that is showing', async () => {
  const board = await makeBoard({ slug: 'interrupter-rank' });
  const key = board.apiKey;
  await jsonOf(call(saveInterrupter, ctx(board.slug), '/x', { method: 'POST', key, body: { name: 'FIRE', text: 'FIRE' } }));
  await jsonOf(call(saveInterrupter, ctx(board.slug), '/x', { method: 'POST', key, body: { name: 'GOAL', text: 'GOAL' } }));
  // Saved in this order: FIRE ranks ahead of GOAL.

  const fired = await jsonOf(call(fireInterrupter, { ...ctx(board.slug), name: 'FIRE' }, '/x', { method: 'POST', key }));
  assert.equal(fired.status, 202);

  const blocked = await jsonOf(call(fireInterrupter, { ...ctx(board.slug), name: 'GOAL' }, '/x', { method: 'POST', key }));
  assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
  assert.match(blocked.body.error, /"FIRE" is showing and ranks ahead of "GOAL"/);
  // Refused, not just discouraged - FIRE is still the one showing.
  const q = (await jsonOf(call(getQueue, ctx(board.slug), '/x'))).body;
  assert.equal(q.items.find((item) => item.id === q.currentItemId).payload.text, 'FIRE');

  // Re-order GOAL ahead of FIRE - now it's GOAL's turn to be allowed through.
  await jsonOf(
    call(reorderInterrupters, ctx(board.slug), '/x', { method: 'POST', key, body: { names: ['GOAL', 'FIRE'] } }),
  );
  const allowed = await jsonOf(call(fireInterrupter, { ...ctx(board.slug), name: 'GOAL' }, '/x', { method: 'POST', key }));
  assert.equal(allowed.status, 202, JSON.stringify(allowed.body));

  // A raw interrupt: true post, bypassing the saved system, still
  // pre-empts unconditionally - the rank rule only binds named firing.
  const raw = await jsonOf(
    call(postMessage, ctx(board.slug), '/x', {
      method: 'POST',
      key,
      body: { text: 'RAW', priority: 'now', interrupt: true },
    }),
  );
  assert.equal(raw.status, 202);
});

test('a saved interrupter with no Duration is the switch: max dwell, no expiry', async () => {
  const board = await makeBoard({ slug: 'interrupter-switch' });
  const key = board.apiKey;
  await jsonOf(call(saveInterrupter, ctx(board.slug), '/x', { method: 'POST', key, body: { name: 'FIRE', text: 'FIRE' } }));
  const fired = await jsonOf(call(fireInterrupter, { ...ctx(board.slug), name: 'FIRE' }, '/x', { method: 'POST', key }));
  assert.equal(fired.status, 202, JSON.stringify(fired.body));
  const q = (await jsonOf(call(getQueue, ctx(board.slug), '/x'))).body;
  const item = q.items.find((entry) => entry.id === fired.body.id);
  assert.equal(item.payload.options.dwellMs, MAX_DWELL_MS, 'blocks the rotation as long as the engine allows');
  assert.equal(item.expiresAtMs, null, 'no expiry - stands until dismissed or broken by a higher rank');
});

test('a saved interrupter fires with align/valign, or as rows - the same either-or a live message has', async () => {
  // Separate boards - both presets are "until dismissed" (no durationMs),
  // and firing one on the same board the other is already blocking the
  // rotation on would hit the rank check this test isn't about.
  const alignedBoard = await makeBoard({ slug: 'interrupter-aligned' });
  const alignedKey = alignedBoard.apiKey;
  await jsonOf(
    call(saveInterrupter, ctx(alignedBoard.slug), '/x', {
      method: 'POST',
      key: alignedKey,
      body: { name: 'ALIGNED', text: 'GATE 5', align: 'left', valign: 'top' },
    }),
  );
  const firedAligned = await jsonOf(
    call(fireInterrupter, { ...ctx(alignedBoard.slug), name: 'ALIGNED' }, '/x', { method: 'POST', key: alignedKey }),
  );
  assert.equal(firedAligned.status, 202, JSON.stringify(firedAligned.body));
  const alignedQueue = (await jsonOf(call(getQueue, ctx(alignedBoard.slug), '/x'))).body;
  const alignedItem = alignedQueue.items.find((entry) => entry.id === firedAligned.body.id);
  assert.equal(alignedItem.payload.options.align, 'left');
  assert.equal(alignedItem.payload.options.valign, 'top');
  assert.equal(alignedItem.payload.text, 'GATE 5');

  const gridBoard = await makeBoard({ slug: 'interrupter-grid' });
  const gridKey = gridBoard.apiKey;
  await jsonOf(
    call(saveInterrupter, ctx(gridBoard.slug), '/x', {
      method: 'POST',
      key: gridKey,
      body: { name: 'GRID', rows: ['ROW ONE', 'ROW TWO'] },
    }),
  );
  const firedGrid = await jsonOf(
    call(fireInterrupter, { ...ctx(gridBoard.slug), name: 'GRID' }, '/x', { method: 'POST', key: gridKey }),
  );
  assert.equal(firedGrid.status, 202, JSON.stringify(firedGrid.body));
  const gridQueue = (await jsonOf(call(getQueue, ctx(gridBoard.slug), '/x'))).body;
  const gridItem = gridQueue.items.find((entry) => entry.id === firedGrid.body.id);
  assert.deepEqual(gridItem.payload.options.rows, ['ROW ONE', 'ROW TWO']);
  assert.equal(gridItem.payload.text, '', 'rows-mode items carry no text');
});

test('dismissing a saved interrupter clears every queued instance of it, not just the one showing', async () => {
  // The bug this guards: firing an already-live "until dismissed" preset
  // queues a second copy behind the first rather than replacing it (Fire
  // has no way to know it's redundant at the API layer - only the UI mutes
  // the button). Dismissing only the current item would just promote the
  // duplicate into its place, which reads as "the button did nothing".
  const board = await makeBoard({ slug: 'interrupter-dismiss' });
  const key = board.apiKey;
  await jsonOf(call(saveInterrupter, ctx(board.slug), '/x', { method: 'POST', key, body: { name: 'FIRE', text: 'FIRE' } }));

  const first = await jsonOf(call(fireInterrupter, { ...ctx(board.slug), name: 'FIRE' }, '/x', { method: 'POST', key }));
  assert.equal(first.status, 202, JSON.stringify(first.body));
  const second = await jsonOf(call(fireInterrupter, { ...ctx(board.slug), name: 'FIRE' }, '/x', { method: 'POST', key }));
  assert.equal(second.status, 202, JSON.stringify(second.body));

  const before = (await jsonOf(call(getQueue, ctx(board.slug), '/x'))).body;
  const firedIds = new Set([first.body.id, second.body.id]);
  assert.equal(
    before.items.filter((item) => firedIds.has(item.id)).length,
    2,
    'both fires queued their own instance - the duplicate this test exists to catch',
  );

  const dismissed = await jsonOf(call(dismissInterrupter, { ...ctx(board.slug), name: 'FIRE' }, '/x', { method: 'POST', key }));
  assert.equal(dismissed.status, 200, JSON.stringify(dismissed.body));
  assert.equal(dismissed.body.removed, 2, 'both instances removed in one call, not just the head');

  const after = (await jsonOf(call(getQueue, ctx(board.slug), '/x'))).body;
  assert.equal(
    after.items.filter((item) => firedIds.has(item.id)).length,
    0,
    'neither instance survives - dismissing the head must not just promote the other one',
  );
  assert.equal(after.currentState, 'idle', 'nothing left to promote into the head');
});

test('dismissing an interrupter by name is case-insensitive, and never touches a different name', async () => {
  const board = await makeBoard({ slug: 'interrupter-dismiss-case' });
  const key = board.apiKey;
  await jsonOf(call(saveInterrupter, ctx(board.slug), '/x', { method: 'POST', key, body: { name: 'FIRE', text: 'FIRE' } }));
  await jsonOf(call(saveInterrupter, ctx(board.slug), '/x', { method: 'POST', key, body: { name: 'GOAL', text: 'GOAL' } }));
  const fired = await jsonOf(call(fireInterrupter, { ...ctx(board.slug), name: 'GOAL' }, '/x', { method: 'POST', key }));
  assert.equal(fired.status, 202, JSON.stringify(fired.body));

  // "fire" - lowercase, unfired - must not touch GOAL's own live instance.
  const dismissedWrongName = await jsonOf(
    call(dismissInterrupter, { ...ctx(board.slug), name: 'fire' }, '/x', { method: 'POST', key }),
  );
  assert.equal(dismissedWrongName.status, 200, JSON.stringify(dismissedWrongName.body));
  assert.equal(dismissedWrongName.body.removed, 0, 'FIRE was never fired - nothing of that name to remove');
  const stillThere = (await jsonOf(call(getQueue, ctx(board.slug), '/x'))).body;
  assert.ok(
    stillThere.items.some((item) => item.id === fired.body.id),
    "GOAL's own live instance is untouched by dismissing an unrelated, unfired name",
  );

  // "goal" - lowercase - must still match the saved name "GOAL".
  const dismissed = await jsonOf(call(dismissInterrupter, { ...ctx(board.slug), name: 'goal' }, '/x', { method: 'POST', key }));
  assert.equal(dismissed.status, 200, JSON.stringify(dismissed.body));
  assert.equal(dismissed.body.removed, 1, 'case-insensitive match against the saved name GOAL');
});

test('concurrent saves to the same board do not clobber each other', async () => {
  // Both read the board before either writes - the exact shape that used
  // to lose one silently when saveInterrupter computed its "next array"
  // from a pre-lock read and setConfig's own re-read never got a chance
  // to factor in (boards.updateInterrupters closes this: the row lock
  // wraps the read AND the write of the same call, not just the write).
  const board = await makeBoard({ slug: 'interrupter-race' });
  const key = board.apiKey;
  const [savedB, savedC] = await Promise.all([
    jsonOf(call(saveInterrupter, ctx(board.slug), '/x', { method: 'POST', key, body: { name: 'B', text: 'B' } })),
    jsonOf(call(saveInterrupter, ctx(board.slug), '/x', { method: 'POST', key, body: { name: 'C', text: 'C' } })),
  ]);
  assert.equal(savedB.status, 200, JSON.stringify(savedB.body));
  assert.equal(savedC.status, 200, JSON.stringify(savedC.body));
  const after = await jsonOf(call(listInterrupters, ctx(board.slug), '/x'));
  assert.deepEqual(
    after.body.interrupters.map((item) => item.name).sort(),
    ['B', 'C'],
    'both concurrent saves survived - neither was silently overwritten',
  );
});

test('a plain post on a scheduled board becomes a once-now spec; fallback fills gaps', async () => {
  const board = await makeBoard({ slug: 'clock-three', type: 'scheduled', fallback: 'STAND BY' });
  const posted = await jsonOf(
    call(postMessage, ctx(board.slug), '/x', {
      method: 'POST',
      key: board.apiKey,
      body: { text: 'FLASH', priority: 'now' },
    }),
  );
  assert.equal(posted.status, 202);
  assert.equal(posted.body.schedule.kind, 'once');

  const q = await jsonOf(call(getQueue, ctx(board.slug), '/x'));
  // Just posted: the once item is inside its window right now.
  assert.equal(q.body.activeItemId, posted.body.id);
  assert.equal(q.body.onFallback, false);
});

test('expired once items are swept on read; the schedule never accretes', async () => {
  const board = await makeBoard({ slug: 'clock-sweep', type: 'scheduled' });
  const posted = await jsonOf(
    call(postMessage, ctx(board.slug), '/x', {
      method: 'POST',
      key: board.apiKey,
      // Played out long ago: expiry (at + duration + grace) is in the past.
      body: { text: 'OLD', schedule: { kind: 'once', atMs: 1_000_000, durationMs: 1000 } },
    }),
  );
  assert.equal(posted.status, 202);
  const keeper = await jsonOf(
    call(postMessage, ctx(board.slug), '/x', {
      method: 'POST',
      key: board.apiKey,
      body: { text: 'DAILY', schedule: { kind: 'daily', at: '09:00' } },
    }),
  );
  assert.equal(keeper.status, 202);

  const q = await jsonOf(call(getQueue, ctx(board.slug), '/x'));
  assert.deepEqual(q.body.items.map((item) => item.id), [keeper.body.id]);
});

test('patching a scheduled item revalidates and recuts its slot', async () => {
  const board = await makeBoard({ slug: 'clock-patch', type: 'scheduled' });
  const posted = await jsonOf(
    call(postMessage, ctx(board.slug), '/x', {
      method: 'POST',
      key: board.apiKey,
      body: { text: 'SHORT', schedule: { kind: 'daily', at: '09:00' } },
    }),
  );
  const itemId = posted.body.id;

  const badPatch = await jsonOf(
    call(patchQueueItem, { ...ctx(board.slug), itemId }, '/x', {
      method: 'PATCH',
      key: board.apiKey,
      body: { schedule: { kind: 'interval', everyMs: 1 } },
    }),
  );
  assert.equal(badPatch.status, 422);

  const patched = await jsonOf(
    call(patchQueueItem, { ...ctx(board.slug), itemId }, '/x', {
      method: 'PATCH',
      key: board.apiKey,
      body: { schedule: { kind: 'hourly', minute: 30 } },
    }),
  );
  assert.equal(patched.status, 200);
  assert.deepEqual(patched.body.item.schedule, { kind: 'hourly', minute: 30 });

  const exported = await jsonOf(call(exportQueue, ctx(board.slug, 'owner'), '/x'));
  assert.deepEqual(exported.body.items[0].schedule, { kind: 'hourly', minute: 30 });
});

/* ---- shared boards & type-aware docs ---- */

test('a shared board is scheduled machinery with the multi-screen promise', async () => {
  const board = await makeBoard({ slug: 'shared-lobby', type: 'shared', fallback: 'HELLO' });
  assert.equal(board.type, 'shared');
  const posted = await jsonOf(
    call(postMessage, ctx(board.slug), '/x', {
      method: 'POST',
      key: board.apiKey,
      body: { text: 'STANDUP', schedule: { kind: 'daily', at: '09:30', durationMs: 60_000 } },
    }),
  );
  assert.equal(posted.status, 202);
  const q = await jsonOf(call(getQueue, ctx(board.slug), '/x'));
  assert.equal(q.body.playback, 'clock');
  assert.ok('activeItemId' in q.body);
});

test('AGENTS.md speaks the board’s type', async () => {
  const live = await makeBoard({ slug: 'doc-live' });
  const liveDoc = await (await call(agentsDoc, ctx(live.slug), '/x')).text();
  assert.match(liveDoc, /type is `live`/);
  assert.match(liveDoc, /Jumping the queue/);
  assert.ok(!liveDoc.includes('Time-based'), 'the 3.0 Plus section is gone');
  assert.ok(!liveDoc.includes('schedule.kind'), 'live docs do not document schedules');

  const clock = await makeBoard({ slug: 'doc-clock', type: 'scheduled' });
  const clockDoc = await (await call(agentsDoc, ctx(clock.slug), '/x')).text();
  assert.match(clockDoc, /type is `scheduled`/);
  assert.match(clockDoc, /The clock owns playback/);
  assert.match(clockDoc, /schedule\.kind/);
  assert.ok(!clockDoc.includes('Jumping the queue'), 'no priority table on a clock board');
});

/* ---- when the realtime service is down ---- */

/** A broker whose every call fails the way an over-quota Redis does. */
function brokenBroker() {
  const fail = async () => {
    const error = new Error('the realtime service is unavailable - queues and settings still save, and displays catch up when it returns');
    error.status = 503;
    error.cause = new Error('Command failed: ERR max requests limit exceeded. Limit: 500000, Usage: 500000');
    throw error;
  };
  return {
    appendCommand: fail, touch: fail, commandsAfter: fail, latestCommandId: fail, setState: fail, getState: fail, deleteBoard: fail,
  };
}

test('a dead broker never fails a write: the message queues, the nudge is logged and skipped', async () => {
  const board = await makeBoard();
  const dead = { ...ctx(board.slug), broker: brokenBroker() };
  const posted = await jsonOf(call(postMessage, dead, '/message', { method: 'POST', body: { text: 'STILL HERE' }, key: board.apiKey }));
  assert.equal(posted.status, 202, JSON.stringify(posted.body));
  const queued = (await jsonOf(call(getQueue, ctx(board.slug), '/queue'))).body;
  assert.equal(queued.items.some((item) => item.payload.text === 'STILL HERE'), true);
  const configured = await jsonOf(call(patchConfig, dead, '/config', { method: 'PATCH', body: { cardSize: 'large' }, key: board.apiKey }));
  assert.equal(configured.status, 200);
  const created = await jsonOf(
    call(createBoard, { ...ctx(undefined, 'owner'), broker: brokenBroker() }, '/api/boards', { method: 'POST', body: { slug: 'born-offline', template: 'match-day' } }),
  );
  assert.equal(created.status, 201, 'a seeded template creates even when it cannot nudge');
});

test('health says the realtime service is unavailable, in words, not with the provider\'s error', async () => {
  const board = await makeBoard();
  const dead = { ...ctx(board.slug), broker: brokenBroker() };
  const result = await jsonOf(call(health, dead, '/health'));
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.realtime, 'unavailable');
  assert.equal(result.body.boardReady, false);
  assert.equal(JSON.stringify(result.body).includes('Usage: 500000'), false, 'the provider message stays in the log');
  // A read that cannot degrade is a 503 with the same sentence.
  const state = await jsonOf(call(status, dead, '/status'));
  assert.equal(state.status, 503);
  assert.match(state.body.error, /realtime service is unavailable/);
  assert.equal(state.body.error.includes('Usage'), false);
});

test('the streams hold the connection through a broker outage and back off', async () => {
  const board = await makeBoard();
  const slept = [];
  const sleep = async (ms) => { slept.push(ms); };
  const seen = [];
  for await (const event of commandEvents(brokenBroker(), board.boardId, '0', { windowMs: 50_000, outageDelayMs: 20_000, sleep })) {
    seen.push(event.type);
  }
  assert.deepEqual(seen, ['heartbeat', 'heartbeat', 'heartbeat'], 'heartbeats keep the client from reconnecting');
  assert.deepEqual(slept, [20_000, 20_000, 20_000], 'a dead broker is polled at the outage cadence, not the active one');
  const stateSeen = [];
  for await (const event of stateEvents(brokenBroker(), board.boardId, { windowMs: 40_000, outageDelayMs: 20_000, sleep: async () => {} })) {
    stateSeen.push(event.type);
  }
  assert.deepEqual(stateSeen, ['heartbeat', 'heartbeat']);
});

test('idle displays poll lazily: the command stream slows to seconds once nothing has happened for a minute', async () => {
  const board = await makeBoard();
  const slept = [];
  for await (const event of commandEvents(broker, board.boardId, '0', { windowMs: 120_000, sleep: async (ms) => { slept.push(ms); } })) {
    void event;
  }
  assert.ok(slept.slice(0, 10).every((ms) => ms === 750), 'brisk while fresh');
  assert.ok(slept.slice(-5).every((ms) => ms >= 8000), `lazy once idle, got ${slept.slice(-5)}`);
});

test('a rejected replace on a sign leaves the old message, not a blank board', async () => {
  /*
   * QueueManager clears a sign before posting its replacement, because a
   * queue of one is full the moment it says anything. If the replacement is
   * then refused - too long, or the network - the board had already been
   * cleared and nothing put it back: WELCOME would vanish and stay gone. The
   * UI restores it on a failed post; this pins the API half, that a clear
   * followed by an over-length post really does leave the queue empty, which
   * is the state the restore step exists to recover from.
   */
  const board = await makeBoard({ template: 'sign' });
  const before = (await jsonOf(call(getQueue, ctx(board.slug), '/queue'))).body;
  assert.equal(before.items[0].payload.text, 'WELCOME');

  const cleared = await jsonOf(
    call(clearBoard, ctx(board.slug), '/x', { method: 'POST', body: {}, key: board.apiKey }),
  );
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  const tooLong = await jsonOf(
    call(postMessage, ctx(board.slug), '/message', {
      method: 'POST',
      body: { text: 'X'.repeat(20001), loop: true },
      key: board.apiKey,
    }),
  );
  assert.equal(tooLong.status, 413);

  const after = (await jsonOf(call(getQueue, ctx(board.slug), '/queue'))).body;
  assert.equal(after.items.length, 0, 'the API leaves it empty - restoring is the caller\'s job');
})

test('a rows-mode item is stored with rows nested under options, not at the top', async () => {
  /*
   * rowsOption reads `body.rows` at the top level - that is what a caller
   * posts. textOptions then builds `{ text: '', options: { rows, ... } }` for
   * storage, whichever mode was used - so what comes back from GET /queue is
   * not the same shape you posted. A UI reading `item.payload.rows` directly
   * (the natural first guess) sees undefined for every rows-mode item and
   * silently shows nothing, which is exactly what happened here before this
   * was pinned: the queue list read the wrong path and showed every
   * rows-mode item as blank.
   */
  const board = await makeBoard();
  const posted = await jsonOf(
    call(postMessage, ctx(board.slug), '/message', {
      method: 'POST',
      body: { rows: ['HELLO', 'WORLD'] },
      key: board.apiKey,
    }),
  );
  assert.equal(posted.status, 202, JSON.stringify(posted.body));

  const queue = (await jsonOf(call(getQueue, ctx(board.slug), '/queue'))).body;
  const item = queue.items[0];
  assert.equal(item.payload.rows, undefined, 'rows is not a top-level field on the stored payload');
  assert.deepEqual(item.payload.options.rows, ['HELLO', 'WORLD']);
  assert.equal(item.payload.text, '', 'text is always present, empty for a rows-mode item');
})
