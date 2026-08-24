import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, resetTestDb, makeTestUser } from '../lib/db/testing.mjs';
import {
  listDesigns,
  getDesign,
  createDesign,
  updateDesign,
  deleteDesign,
  MAX_DESIGNS,
} from '../lib/db/designs.mjs';
import { validatePack } from '../lib/board/theme-pack.mjs';
import { THEMES } from '../lib/board/themes.mjs';

let db;
before(async () => {
  db = await makeTestDb();
});
beforeEach(async () => {
  await resetTestDb(db);
  await makeTestUser(db, { id: 'u1' });
  await makeTestUser(db, { id: 'u2' });
});

/** A design somebody might make: Sorbet with the corners moved. */
function aPack(overrides = {}) {
  const { pack } = validatePack({
    ...THEMES.sorbet,
    id: undefined,
    tint: {
      corners: { tl: '#ff0000', tr: '#00ff00', bl: '#0000ff', br: '#ffff00' },
      mode: 'multiply',
      strength: 0.8,
    },
    ...overrides,
  });
  return pack;
}

test('a design is stored whole and comes back the same', async () => {
  const pack = aPack();
  const made = await createDesign(db, { ownerId: 'u1', name: 'Carrow Road', pack, basedOn: 'sorbet' });
  assert.match(made.id, /^[a-z0-9]{8,}$/);
  assert.equal(made.name, 'Carrow Road');
  assert.equal(made.basedOn, 'sorbet');
  // Whole, not a diff: the thing that comes back renders on its own.
  assert.deepEqual(made.pack.tint.corners.tl, '#ff0000');
  assert.deepEqual(made.pack.card, pack.card);

  const read = await getDesign(db, 'u1', made.id);
  assert.deepEqual(read, made);
});

test('one account cannot see or touch another account\'s designs', async () => {
  const mine = await createDesign(db, { ownerId: 'u1', name: 'Mine', pack: aPack() });

  // Ownership is part of the lookup, not a check afterwards - there is no path
  // that reads the row first and decides about it later.
  assert.equal(await getDesign(db, 'u2', mine.id), null);
  assert.equal(await updateDesign(db, 'u2', mine.id, { name: 'Yours' }), null);
  assert.equal(await deleteDesign(db, 'u2', mine.id), false);

  // And it is untouched.
  assert.equal((await getDesign(db, 'u1', mine.id)).name, 'Mine');
  assert.deepEqual(await listDesigns(db, 'u2'), []);
});

test('the list is one account\'s own, newest edit first', async () => {
  const a = await createDesign(db, { ownerId: 'u1', name: 'First', pack: aPack() });
  const b = await createDesign(db, { ownerId: 'u1', name: 'Second', pack: aPack() });
  await createDesign(db, { ownerId: 'u2', name: 'Theirs', pack: aPack() });

  // Editing the older one moves it to the front, because the list is what you
  // were last working on rather than what you made first.
  await updateDesign(db, 'u1', a.id, { name: 'First, edited' });
  const list = await listDesigns(db, 'u1');
  assert.deepEqual(list.map((d) => d.name), ['First, edited', 'Second']);
  assert.ok(list.every((d) => d.id !== undefined));
  assert.equal(list.find((d) => d.id === b.id).name, 'Second');
});

test('a design can be renamed, repacked, or both', async () => {
  const made = await createDesign(db, { ownerId: 'u1', name: 'Draft', pack: aPack() });

  const renamed = await updateDesign(db, 'u1', made.id, { name: 'Final' });
  assert.equal(renamed.name, 'Final');
  assert.deepEqual(renamed.pack, made.pack, 'a rename leaves the pack alone');

  const repacked = await updateDesign(db, 'u1', made.id, { pack: aPack({ card: { fill: '#123456' } }) });
  assert.equal(repacked.name, 'Final', 'and a repack leaves the name alone');
  assert.equal(repacked.pack.card.fill, '#123456');

  assert.equal(await updateDesign(db, 'u1', 'nope', { name: 'x' }), null, 'a missing one is null, not a throw');
});

test('deleting is real, and is only ever your own', async () => {
  const made = await createDesign(db, { ownerId: 'u1', name: 'Gone', pack: aPack() });
  assert.equal(await deleteDesign(db, 'u1', made.id), true);
  assert.equal(await getDesign(db, 'u1', made.id), null);
  assert.equal(await deleteDesign(db, 'u1', made.id), false, 'deleting twice is false, not a throw');
});

test('an account cannot keep an unbounded number of designs', async () => {
  const pack = aPack();
  for (let i = 0; i < MAX_DESIGNS; i += 1) {
    await createDesign(db, { ownerId: 'u1', name: `D${i}`, pack });
  }
  await assert.rejects(
    () => createDesign(db, { ownerId: 'u1', name: 'One too many', pack }),
    (error) => error.status === 409,
  );
  // The limit is per account, so somebody else is unaffected.
  const theirs = await createDesign(db, { ownerId: 'u2', name: 'Fine', pack });
  assert.equal(theirs.name, 'Fine');
});
