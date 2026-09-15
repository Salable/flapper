import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { makeTestDb, resetTestDb, makeTestUser } from '../lib/db/testing.mjs';
import { createBoard } from '../lib/db/boards.mjs';
import { boards } from '../lib/db/schema.mjs';
import { FREE_ALLOWANCE } from '../lib/salable/licence.mjs';
import { unpinBoards, CUTOFF } from '../tools/unpin-sign-queuecap.mjs';

let db;
before(async () => {
  db = await makeTestDb();
});
beforeEach(async () => {
  await resetTestDb(db);
  await makeTestUser(db, { id: 'free' });
  await makeTestUser(db, { id: 'paid' });
});

const FREE = { ...FREE_ALLOWANCE };
const PAID = { ...FREE_ALLOWANCE, maxBoards: 50, maxQueueItems: Infinity };
const allowanceOf = async (ownerId) => (ownerId === 'paid' ? PAID : FREE);

/** createBoard stamps createdAt itself; these boards need to pre-date it. */
async function aged(board, createdAt) {
  await db.update(boards).set({ createdAt }).where(eq(boards.id, board.id));
  return board;
}
const BEFORE = new Date(CUTOFF.getTime() - 86_400_000);
const AFTER = new Date(CUTOFF.getTime() + 86_400_000);

async function capOf(slug) {
  const [row] = await db.select().from(boards).where(eq(boards.slug, slug));
  return row.config.queueCap;
}

test('a free account gets the three slides its plan covers, not the type default', async () => {
  await aged(await createBoard(db, { ownerId: 'free', slug: 'hello-adam', config: { queueCap: 1 } }), BEFORE);

  const { lifted } = await unpinBoards(db, { allowanceOf, apply: true });

  assert.deepEqual(
    lifted.map((row) => [row.slug, row.to]),
    [['hello-adam', 3]],
  );
  assert.equal(await capOf('hello-adam'), FREE_ALLOWANCE.maxQueueItems);
});

test("a paid account gets the board type's own default", async () => {
  await aged(await createBoard(db, { ownerId: 'paid', slug: 'atrium', config: { queueCap: 1 } }), BEFORE);

  await unpinBoards(db, { allowanceOf, apply: true });

  assert.equal(await capOf('atrium'), 5);
});

test('a board pinned to one after the cutoff is left alone', async () => {
  await aged(await createBoard(db, { ownerId: 'free', slug: 'on-purpose', config: { queueCap: 1 } }), AFTER);

  const { lifted, skipped } = await unpinBoards(db, { allowanceOf, apply: true });

  assert.equal(lifted.length, 0);
  assert.match(skipped[0].why, /after the cutoff/);
  assert.equal(await capOf('on-purpose'), 1);
});

test('a cap someone already raised is not touched', async () => {
  await aged(await createBoard(db, { ownerId: 'free', slug: 'already-fine', config: { queueCap: 3 } }), BEFORE);

  const { lifted, skipped } = await unpinBoards(db, { allowanceOf, apply: true });

  assert.deepEqual([lifted.length, skipped.length], [0, 0]);
  assert.equal(await capOf('already-fine'), 3);
});

test('a dry run reports the same boards and writes nothing', async () => {
  await aged(await createBoard(db, { ownerId: 'free', slug: 'hello-adam', config: { queueCap: 1 } }), BEFORE);

  const { lifted } = await unpinBoards(db, { allowanceOf });

  assert.deepEqual(lifted.map((row) => row.slug), ['hello-adam']);
  assert.equal(await capOf('hello-adam'), 1);
});

test('running it twice changes nothing the second time', async () => {
  await aged(await createBoard(db, { ownerId: 'free', slug: 'hello-adam', config: { queueCap: 1 } }), BEFORE);

  await unpinBoards(db, { allowanceOf, apply: true });
  const second = await unpinBoards(db, { allowanceOf, apply: true });

  assert.deepEqual([second.lifted.length, second.skipped.length], [0, 0]);
  assert.equal(await capOf('hello-adam'), 3);
});
