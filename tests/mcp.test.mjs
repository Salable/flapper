import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBroker } from '../lib/broker/memory.mjs';
import { makeTestDb, resetTestDb, makeTestUser } from '../lib/db/testing.mjs';
import { createBoard } from '../lib/api/handlers.mjs';
import { MCP_TOOLS, callTool, verifyBoardKey, mcpSlugOf, registerBoardTools } from '../lib/api/mcp.mjs';

/**
 * The MCP tool layer, driven without mcp-handler or a transport: tools are
 * plain functions over the REST handlers, and the key verifier is a plain
 * function over the db - both testable exactly like the handlers themselves.
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
  broker = new MemoryBroker();
});

const anonymous = async () => null;

function ctx() {
  return { broker, db, getSession: anonymous };
}

async function makeBoard({ slug = 'mcp-board', ...rest } = {}) {
  const response = await createBoard(
    new Request(`${BASE}/api/boards`, {
      method: 'POST',
      body: JSON.stringify({ slug, ...rest }),
      headers: { 'content-type': 'application/json' },
    }),
    { ...ctx(), getSession: async () => ({ user: { id: 'owner' } }) },
  );
  assert.equal(response.status, 201);
  return response.json();
}

const toolByName = (name) => {
  const tool = MCP_TOOLS.find((entry) => entry.name === name);
  assert.ok(tool, `no tool named ${name}`);
  return tool;
};

function authFor(board) {
  return { token: board.apiKey, slug: board.slug, origin: BASE };
}

/** Run a tool and parse its single text content block. */
async function run(name, args, board, auth = authFor(board)) {
  const result = await callTool(toolByName(name), args, ctx(), auth);
  const text = result.content[0].text;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { isError: Boolean(result.isError), body: parsed };
}

/* ---- the verifier ---- */

test('verifyBoardKey accepts the board key on its own mcp path only', async () => {
  const board = await makeBoard();
  const request = new Request(`${BASE}/api/b/${board.slug}/mcp`, { method: 'POST' });

  const auth = await verifyBoardKey(db, request, board.apiKey);
  assert.ok(auth);
  assert.equal(auth.clientId, `board:${board.slug}`);
  assert.equal(auth.extra.slug, board.slug);
  assert.equal(auth.extra.origin, BASE);

  assert.equal(await verifyBoardKey(db, request, 'not-the-key'), undefined);
  assert.equal(await verifyBoardKey(db, request, ''), undefined);
  assert.equal(await verifyBoardKey(db, request, undefined), undefined);

  const wrongBoard = new Request(`${BASE}/api/b/no-such-board/mcp`, { method: 'POST' });
  assert.equal(await verifyBoardKey(db, wrongBoard, board.apiKey), undefined);
});

test('verifyBoardKey honours x-forwarded-proto for the advertised origin', async () => {
  const board = await makeBoard();
  const request = new Request(`http://internal.host/api/b/${board.slug}/mcp`, {
    method: 'POST',
    headers: { 'x-forwarded-proto': 'https' },
  });
  const auth = await verifyBoardKey(db, request, board.apiKey);
  assert.equal(auth.extra.origin, 'https://internal.host');
});

test('mcpSlugOf reads only its own path shape', () => {
  assert.equal(mcpSlugOf(new Request(`${BASE}/api/b/lobby/mcp`)), 'lobby');
  assert.equal(mcpSlugOf(new Request(`${BASE}/api/b/lobby/message`)), null);
  assert.equal(mcpSlugOf(new Request(`${BASE}/api/mcp`)), null);
});

/* ---- reads ---- */

test('read tools surface the board over the REST handlers', async () => {
  const board = await makeBoard({ name: 'Lobby' });

  const info = await run('get_board_info', {}, board);
  assert.equal(info.isError, false);
  assert.equal(info.body.slug, board.slug);
  assert.equal(info.body.name, 'Lobby');

  const healthy = await run('get_health', {}, board);
  assert.equal(healthy.body.ok, true);
  assert.equal(healthy.body.boardReady, false);

  const caps = await run('get_capabilities', {}, board);
  assert.ok(caps.body.grid.cols > 0);
  assert.ok(Array.isArray(caps.body.priority));

  const docs = await run('get_docs', {}, board);
  assert.equal(docs.isError, false);
  assert.match(docs.body, /Agent Guide/);
  assert.match(docs.body, new RegExp(board.slug));
});

test('get_status reports queue truth and no-display note', async () => {
  const board = await makeBoard();
  const result = await run('get_status', {}, board);
  assert.equal(result.isError, false);
  assert.equal(result.body.lines, null);
  assert.equal(result.body.stale, true);
  assert.equal(result.body.queue.length, 0);
});

/* ---- writes ---- */

test('post_message queues and list_queue sees it', async () => {
  const board = await makeBoard();

  const posted = await run('post_message', { text: 'HELLO WALL' }, board);
  assert.equal(posted.isError, false, JSON.stringify(posted.body));
  assert.equal(posted.body.ok, true);
  assert.ok(posted.body.id);

  const queue = await run('list_queue', {}, board);
  assert.equal(queue.body.items.length, 1);
  assert.equal(queue.body.items[0].payload.text, 'HELLO WALL');
});

test('preview never queues and reports diagnostics', async () => {
  const board = await makeBoard();
  const result = await run('preview', { text: 'R&D 50%' }, board);
  assert.equal(result.isError, false);
  assert.ok(result.body.pages || result.body.rows || result.body.diagnostics);

  const queue = await run('list_queue', {}, board);
  assert.equal(queue.body.items.length, 0);
});

test('queue item tools edit, reorder, and remove', async () => {
  const board = await makeBoard();
  const first = await run('post_message', { text: 'ONE' }, board);
  const second = await run('post_message', { text: 'TWO' }, board);

  const edited = await run('update_queue_item', { itemId: second.body.id, loop: true }, board);
  assert.equal(edited.isError, false, JSON.stringify(edited.body));
  assert.equal(edited.body.item.loop, true);

  const moved = await run(
    'reorder_queue',
    { itemId: second.body.id, afterId: null },
    board,
  );
  assert.equal(moved.isError, false);

  const removed = await run('delete_queue_item', { itemId: first.body.id }, board);
  assert.equal(removed.isError, false);

  const queue = await run('list_queue', {}, board);
  assert.equal(queue.body.items.length, 1);
  assert.equal(queue.body.items[0].id, second.body.id);
});

test('flush_queue and clear_board are the destructive pair', async () => {
  const board = await makeBoard();
  await run('post_message', { text: 'ONE' }, board);
  await run('post_message', { text: 'TWO' }, board);

  const flushed = await run('flush_queue', {}, board);
  assert.equal(flushed.isError, false);
  // The head item is playing, not pending; flush drops the rest.
  assert.equal(flushed.body.removed, 1);

  const cleared = await run('clear_board', {}, board);
  assert.equal(cleared.isError, false);

  const queue = await run('list_queue', {}, board);
  assert.equal(queue.body.items.length, 0);
});

test('update_config patches and export_queue round-trips payloads', async () => {
  const board = await makeBoard();
  const patched = await run('update_config', { align: 'left' }, board);
  assert.equal(patched.isError, false, JSON.stringify(patched.body));
  assert.equal(patched.body.config.align, 'left');

  await run('post_message', { text: 'KEEP THIS' }, board);
  const exported = await run('export_queue', {}, board);
  assert.equal(exported.isError, false);
  assert.equal(exported.body.items[0].payload.text, 'KEEP THIS');
});

/* ---- error mapping ---- */

test('handler rejections become isError results carrying the HTTP status', async () => {
  const board = await makeBoard();

  const badField = await run('post_message', { rows: ['HI'], align: 'left' }, board);
  assert.equal(badField.isError, true);
  assert.equal(badField.body.status, 422);
  assert.match(badField.body.error, /align/);

  const badSchedule = await run(
    'post_message',
    { text: 'X', schedule: { kind: 'daily', at: '12:00' } },
    board,
  );
  assert.equal(badSchedule.isError, true);
  assert.equal(badSchedule.body.status, 422);

  const wrongKey = await run('post_message', { text: 'X' }, board, {
    token: 'wrong',
    slug: board.slug,
    origin: BASE,
  });
  assert.equal(wrongKey.isError, true);
  assert.equal(wrongKey.body.status, 401);
});

test('a schedule lands on a clock board', async () => {
  const board = await makeBoard({ slug: 'clock-board', type: 'scheduled', timezone: 'UTC' });
  const posted = await run(
    'post_message',
    { text: 'LUNCH', schedule: { kind: 'daily', at: '12:00', durationMs: 60000 } },
    board,
  );
  assert.equal(posted.isError, false, JSON.stringify(posted.body));
  assert.equal(posted.body.schedule.kind, 'daily');
});

/* ---- registration ---- */

test('registerBoardTools registers every tool with schemas and annotations', () => {
  const registered = new Map();
  const fakeServer = {
    registerTool(name, config, cb) {
      registered.set(name, { config, cb });
    },
  };
  registerBoardTools(fakeServer, async () => ctx());

  assert.equal(registered.size, MCP_TOOLS.length);
  for (const tool of MCP_TOOLS) {
    const entry = registered.get(tool.name);
    assert.ok(entry, `${tool.name} not registered`);
    assert.ok(entry.config.description, `${tool.name} has no description`);
    assert.ok(entry.config.inputSchema, `${tool.name} has no input schema`);
  }
  // The write tools that discard content say so; reads say so too.
  assert.equal(registered.get('clear_board').config.annotations.destructiveHint, true);
  assert.equal(registered.get('flush_queue').config.annotations.destructiveHint, true);
  assert.equal(registered.get('get_status').config.annotations.readOnlyHint, true);
});

test('a registered tool callback refuses a transport without authInfo', async () => {
  const registered = new Map();
  registerBoardTools(
    { registerTool: (name, config, cb) => registered.set(name, cb) },
    async () => ctx(),
  );
  const result = await registered.get('get_status')({}, { http: {} });
  assert.equal(result.isError, true);
});

test('a registered tool callback runs end to end from authInfo', async () => {
  const board = await makeBoard();
  const registered = new Map();
  registerBoardTools(
    { registerTool: (name, config, cb) => registered.set(name, cb) },
    async () => ctx(),
  );
  const result = await registered.get('post_message')(
    { text: 'VIA MCP' },
    {
      http: {
        authInfo: {
          token: board.apiKey,
          clientId: `board:${board.slug}`,
          scopes: ['board'],
          extra: { slug: board.slug, origin: BASE },
        },
      },
    },
  );
  assert.equal(Boolean(result.isError), false, result.content[0].text);
  const queue = await run('list_queue', {}, board);
  assert.equal(queue.body.items[0].payload.text, 'VIA MCP');
});
