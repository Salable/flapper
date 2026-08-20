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
  agentsDoc,
  commandEvents,
  stateEvents,
} from '../lib/api/handlers.mjs';

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
  return result.body;
}

/* ---- lifecycle ---- */

test('creating a board needs a session and returns key + urls', async () => {
  const denied = await jsonOf(
    call(createBoard, ctx(), '/api/boards', { method: 'POST', body: {} }),
  );
  assert.equal(denied.status, 401);

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

test('writes need the API key; owner session alone is not a write key (except config)', async () => {
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

  assert.equal(
    (await call(flushQueue, ctx(board.slug), '/x', { method: 'DELETE', body: {} })).status,
    401,
  );
  assert.equal(
    (await call(clearBoard, ctx(board.slug), '/x', { method: 'POST', body: {} })).status,
    401,
  );
  // config accepts the owner's session as an alternative to the key
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
    [postState, '/state', { method: 'POST', body: { state: { queue: [] } } }],
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

test('a message is validated, stamped as api, and appended to the stream', async () => {
  const board = await makeBoard();
  const { status: code, body } = await jsonOf(
    call(postMessage, ctx(board.slug), '/message', {
      method: 'POST',
      body: { text: 'HELLO', priority: 'next' },
      key: board.apiKey,
    }),
  );
  assert.equal(code, 202);
  assert.ok(body.id);

  const [entry] = await broker.commandsAfter(board.boardId, '0', 10);
  assert.equal(entry.cmd.method, 'enqueue');
  assert.equal(entry.cmd.params.text, 'HELLO');
  assert.equal(entry.cmd.params.options.priority, 'next');
  assert.equal(entry.cmd.params.options.source, 'api');
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

test('a region the board does not have is a 422 naming the ones it does', async () => {
  const board = await makeBoard();
  const result = await jsonOf(
    call(postMessage, ctx(board.slug), '/message', {
      method: 'POST',
      body: { text: 'X', region: 'footer' },
      key: board.apiKey,
    }),
  );
  assert.equal(result.status, 422);
  assert.match(result.body.error, /unknown region: footer.*main/);
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

test('capabilities and config round-trip through Postgres', async () => {
  const board = await makeBoard();
  const before = (await jsonOf(call(capabilities, ctx(board.slug), '/capabilities'))).body;
  assert.deepEqual(before.regions, ['main']);
  assert.equal(before.grid.cols, 20);

  const patched = await jsonOf(
    call(patchConfig, ctx(board.slug), '/config', {
      method: 'PATCH',
      body: { footerRows: 2, cols: 30, regions: { footer: { dwellMs: 8000 } } },
      key: board.apiKey,
    }),
  );
  assert.equal(patched.status, 200);

  const after = (await jsonOf(call(capabilities, ctx(board.slug), '/capabilities'))).body;
  assert.deepEqual(after.regions, ['main', 'footer']);
  assert.equal(after.grid.cols, 30);
  assert.equal(after.grid.mainRows, 6);

  const commands = await broker.commandsAfter(board.boardId, '0', 10);
  assert.equal(commands[0].cmd.method, 'configure');
});

test('a per-band setting for a band the new geometry lacks is refused', async () => {
  const board = await makeBoard();
  const result = await jsonOf(
    call(patchConfig, ctx(board.slug), '/config', {
      method: 'PATCH',
      body: { regions: { footer: { dwellMs: 8000 } } },
      key: board.apiKey,
    }),
  );
  assert.equal(result.status, 422);
  assert.match(result.body.error, /unknown region: footer/);
});

/* ---- flush & clear ---- */

test('flush and clear append commands, with and without a region', async () => {
  const board = await makeBoard();
  const key = board.apiKey;
  assert.equal(
    (await call(flushQueue, ctx(board.slug), '/queue', { method: 'DELETE', body: {}, key })).status,
    202,
  );
  assert.equal(
    (await call(clearBoard, ctx(board.slug), '/clear', { method: 'POST', body: { region: 'main' }, key }))
      .status,
    202,
  );
  const commands = await broker.commandsAfter(board.boardId, '0', 10);
  assert.deepEqual(commands.map((entry) => entry.cmd.method), ['flush', 'clear']);
});

/* ---- state & status ---- */

test('status is honest about a display that has never reported', async () => {
  const board = await makeBoard();
  const { body } = await jsonOf(call(status, ctx(board.slug), '/status'));
  assert.equal(body.boardReady, false);
  assert.equal(body.stale, true);
  assert.equal(body.showing, null);
});

test('a posted state snapshot round-trips through status and health', async () => {
  const board = await makeBoard();
  const snapshot = { showing: { id: 'm1' }, lines: ['HELLO'], queue: [], regions: {} };
  assert.equal(
    (await call(postState, ctx(board.slug), '/state', { method: 'POST', body: { state: snapshot } }))
      .status,
    200,
  );
  const { body } = await jsonOf(call(status, ctx(board.slug), '/status'));
  assert.equal(body.stale, false);
  assert.deepEqual(body.lines, ['HELLO']);
  assert.equal((await jsonOf(call(health, ctx(board.slug), '/health'))).body.boardReady, true);
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
