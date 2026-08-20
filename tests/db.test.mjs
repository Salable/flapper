import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, resetTestDb, makeTestUser } from '../lib/db/testing.mjs';
import {
  createBoard,
  getBySlug,
  getById,
  listByOwner,
  updateBoard,
  setConfig,
  rotateKey,
  deleteBoard,
} from '../lib/db/boards.mjs';
import { validateSlug, generateSlug, RESERVED_SLUGS } from '../lib/db/slugs.mjs';

let db;
before(async () => {
  db = await makeTestDb();
});
beforeEach(async () => {
  await resetTestDb(db);
  await makeTestUser(db, { id: 'u1' });
  await makeTestUser(db, { id: 'u2' });
});

/* ---- slugs ---- */

test('slug validation refuses what a URL cannot carry', () => {
  const bad = ['ab', 'a'.repeat(41), 'Has-Caps', 'ends-', '-starts', 'sp ace', 'dot.com', 'two--hyphens', 42];
  for (const slug of bad) {
    assert.throws(() => validateSlug(slug), (e) => e.status === 422, String(slug));
  }
  for (const slug of ['abc', 'lobby-board', 'a1b2c3', 'x-1-y']) {
    assert.equal(validateSlug(slug), slug);
  }
});

test('reserved words are refused as slugs', () => {
  for (const slug of ['api', 'dashboard', 'login', 'settings']) {
    assert.ok(RESERVED_SLUGS.has(slug));
    assert.throws(() => validateSlug(slug), (e) => e.status === 422);
  }
});

test('generated slugs are valid by their own rules', () => {
  for (let i = 0; i < 50; i += 1) {
    assert.doesNotThrow(() => validateSlug(generateSlug()));
  }
});

/* ---- boards ---- */

test('create returns a full row with a generated slug and key', async () => {
  const board = await createBoard(db, { ownerId: 'u1', name: 'Lobby' });
  assert.match(board.id, /^[0-9a-z]{16}$/);
  assert.match(board.apiKey, /^[0-9a-f]{64}$/);
  assert.doesNotThrow(() => validateSlug(board.slug));
  assert.equal(board.private, false);
  assert.deepEqual(board.config, {});
  assert.deepEqual(await getBySlug(db, board.slug), board);
  assert.deepEqual(await getById(db, board.id), board);
});

test('a chosen slug is honoured, and a collision is a 422', async () => {
  const board = await createBoard(db, { ownerId: 'u1', slug: 'lobby-board' });
  assert.equal(board.slug, 'lobby-board');
  await assert.rejects(
    createBoard(db, { ownerId: 'u2', slug: 'lobby-board' }),
    (e) => e.status === 422 && /taken/.test(e.message),
  );
});

test('listByOwner sees only that owner, in creation order', async () => {
  await createBoard(db, { ownerId: 'u1', slug: 'one-board' });
  await createBoard(db, { ownerId: 'u1', slug: 'two-board' });
  await createBoard(db, { ownerId: 'u2', slug: 'other-board' });
  const mine = await listByOwner(db, 'u1');
  assert.deepEqual(mine.map((b) => b.slug), ['one-board', 'two-board']);
});

test('update renames, re-slugs, and toggles privacy - with validation', async () => {
  const board = await createBoard(db, { ownerId: 'u1', slug: 'old-name' });
  const updated = await updateBoard(db, board.id, { name: 'Departures', slug: 'new-name', private: true });
  assert.equal(updated.name, 'Departures');
  assert.equal(updated.slug, 'new-name');
  assert.equal(updated.private, true);
  assert.equal(await getBySlug(db, 'old-name'), null);

  await assert.rejects(updateBoard(db, board.id, { slug: 'API' }), (e) => e.status === 422);
  await assert.rejects(updateBoard(db, board.id, { private: 'yes' }), (e) => e.status === 422);
  const other = await createBoard(db, { ownerId: 'u1', slug: 'their-slug' });
  await assert.rejects(
    updateBoard(db, board.id, { slug: 'their-slug' }),
    (e) => e.status === 422 && /taken/.test(e.message),
    String(other.id),
  );
});

test('setConfig merges one level, regions per band', async () => {
  const board = await createBoard(db, { ownerId: 'u1' });
  await setConfig(db, board.id, { footerRows: 2, regions: { footer: { dwellMs: 8000 } } });
  const config = await setConfig(db, board.id, { cols: 30, regions: { main: { dwellMs: 500 } } });
  assert.equal(config.footerRows, 2);
  assert.equal(config.cols, 30);
  assert.equal(config.regions.footer.dwellMs, 8000);
  assert.equal(config.regions.main.dwellMs, 500);
  assert.deepEqual((await getById(db, board.id)).config, config);
});

test('rotateKey mints a fresh key', async () => {
  const board = await createBoard(db, { ownerId: 'u1' });
  const rotated = await rotateKey(db, board.id);
  assert.notEqual(rotated.apiKey, board.apiKey);
  assert.match(rotated.apiKey, /^[0-9a-f]{64}$/);
});

test('delete removes the row; deleting an owner cascades', async () => {
  const board = await createBoard(db, { ownerId: 'u1' });
  assert.equal(await deleteBoard(db, board.id), true);
  assert.equal(await deleteBoard(db, board.id), false);

  const orphan = await createBoard(db, { ownerId: 'u2' });
  const { user } = await import('../lib/db/schema.mjs');
  const { eq } = await import('drizzle-orm');
  await db.delete(user).where(eq(user.id, 'u2'));
  assert.equal(await getById(db, orphan.id), null);
});
