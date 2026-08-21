import test, { before, beforeEach } from 'node:test';
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

function ctx(slug, sessionUserId) {
  return {
    broker,
    db,
    slug,
    getSession: sessionUserId ? asUser(sessionUserId) : anonymous,
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
      body: { slug, ...rest },
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
  assert.equal(mq.config.cols, 24);
  assert.equal(mq.items.length, 2);
  assert.equal(mq.items[0].payload.text, 'ON THE BALL CITY');

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
    (await call(patchConfig, ctx(board.slug, 'owner'), '/x', { method: 'PATCH', body: { cols: 30 } }))
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
      body: { cols: 30, dwellMs: 1500 },
      key: board.apiKey,
    }),
  );
  assert.equal(patched.status, 200);

  const after = (await jsonOf(call(capabilities, ctx(board.slug), '/capabilities'))).body;
  assert.equal(after.grid.cols, 30);

  const commands = await broker.commandsAfter(board.boardId, '0', 10);
  assert.equal(commands[0].cmd.method, 'sync');
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

test('a type that names a tier is refused with a 402 below it - on the shared create path', async () => {
  // The registry is a Map; a locked entry for the test's duration exercises
  // the mechanism without any shipped type being premium.
  const locked = { ...BOARD_TYPES.get('live'), id: 'premium-live', name: 'Premium live', tier: 'pro' };
  BOARD_TYPES.set(locked.id, locked);
  try {
    const denied = await jsonOf(
      call(createBoard, ctx(undefined, 'owner'), '/api/boards', {
        method: 'POST',
        body: { slug: 'locked-board', type: 'premium-live' },
      }),
    );
    assert.equal(denied.status, 402);
    assert.match(denied.body.error, /pro tier/);
    assert.match(denied.body.error, /standard/);
    // Raise the account and the same request succeeds.
    await db.update(schema.user).set({ tier: 'pro' }).where(eq(schema.user.id, 'owner'));
    const allowed = await jsonOf(
      call(createBoard, ctx(undefined, 'owner'), '/api/boards', {
        method: 'POST',
        body: { slug: 'locked-board', type: 'premium-live' },
      }),
    );
    assert.equal(allowed.status, 201);
  } finally {
    BOARD_TYPES.delete(locked.id);
  }
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
