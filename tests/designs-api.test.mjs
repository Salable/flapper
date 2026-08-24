import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, resetTestDb, makeTestUser } from '../lib/db/testing.mjs';
import {
  listDesignsHandler,
  createDesignHandler,
  getDesignHandler,
  updateDesignHandler,
  deleteDesignHandler,
} from '../lib/api/handlers.mjs';
import { THEMES } from '../lib/board/themes.mjs';

const BASE = 'http://localhost:3000';

let db;
before(async () => {
  db = await makeTestDb();
});
beforeEach(async () => {
  await resetTestDb(db);
  await makeTestUser(db, { id: 'mine' });
  await makeTestUser(db, { id: 'theirs' });
});

const as = (id) => ({ db, getSession: async () => (id ? { user: { id } } : null) });

function call(handler, context, path, { method = 'GET', body, designId } = {}) {
  const request = new Request(`${BASE}${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { 'content-type': 'application/json' },
  });
  return handler(request, designId ? { ...context, designId } : context);
}

async function jsonOf(promise) {
  const response = await promise;
  return { status: response.status, body: await response.json() };
}

test('the list is your designs and the ones that ship', async () => {
  const empty = await jsonOf(call(listDesignsHandler, as('mine'), '/api/designs'));
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.designs, []);
  // The shipped ones come back too, so a caller can offer them without knowing
  // what this build happens to include.
  assert.deepEqual(empty.body.presets.map((p) => p.id), Object.keys(THEMES));
  assert.equal(typeof empty.body.limit, 'number');
});

test('signing in is required for every one of them', async () => {
  for (const [handler, options] of [
    [listDesignsHandler, {}],
    [createDesignHandler, { method: 'POST', body: { name: 'x', from: 'classic' } }],
    [getDesignHandler, { designId: 'anything' }],
    [updateDesignHandler, { method: 'PATCH', body: { name: 'x' }, designId: 'anything' }],
    [deleteDesignHandler, { method: 'DELETE', designId: 'anything' }],
  ]) {
    const result = await jsonOf(call(handler, as(null), '/api/designs', options));
    assert.equal(result.status, 401, JSON.stringify(result.body));
  }
});

test('a design can be forked from a shipped one by name alone', async () => {
  // The common case: start from Sorbet. Nobody should have to fetch a pack and
  // paste it back to do that.
  const made = await jsonOf(
    call(createDesignHandler, as('mine'), '/api/designs', {
      method: 'POST',
      body: { name: 'Carrow Road', from: 'sorbet' },
    }),
  );
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.design.name, 'Carrow Road');
  assert.equal(made.body.design.basedOn, 'sorbet');
  // A whole pack, not a reference - deleting or editing Sorbet cannot reach it.
  assert.deepEqual(made.body.design.pack.tint, THEMES.sorbet.tint);
  assert.deepEqual(made.body.design.pack.card, THEMES.sorbet.card);
  // And it does not carry the preset's identity around with it.
  assert.equal(made.body.design.pack.id, undefined);
});

test('an unknown design to fork from is named, not defaulted', async () => {
  const result = await jsonOf(
    call(createDesignHandler, as('mine'), '/api/designs', {
      method: 'POST',
      body: { name: 'Nope', from: 'tartan' },
    }),
  );
  assert.equal(result.status, 422);
  assert.match(result.body.error, /unknown design "tartan"/);
});

test('an agent can post a whole pack, and is told everything wrong with it', async () => {
  const good = await jsonOf(
    call(createDesignHandler, as('mine'), '/api/designs', {
      method: 'POST',
      body: {
        name: 'Agent made',
        pack: {
          card: { fill: '#101820', edge: '#000000' },
          glyph: { fill: '#fee715' },
          tint: { runner: { colour: '#fee715', length: 4, periodMs: 7000 }, mode: 'screen' },
        },
      },
    }),
  );
  assert.equal(good.status, 201, JSON.stringify(good.body));
  assert.equal(good.body.design.pack.card.fill, '#101820');
  assert.equal(good.body.design.pack.tint.runner.colour, '#fee715');

  // Every problem at once, not the first - so something writing a pack can fix
  // it in one go rather than one round trip per mistake.
  const bad = await jsonOf(
    call(createDesignHandler, as('mine'), '/api/designs', {
      method: 'POST',
      body: { name: 'Bad', pack: { card: { fill: 'lilac' }, tint: { gradient: { from: '#fff' } } } },
    }),
  );
  assert.equal(bad.status, 422);
  assert.match(bad.body.error, /card\.fill must be a colour/);
  assert.match(bad.body.error, /tint\.gradient\.to/);
});

test('a name is required, trimmed, and bounded', async () => {
  for (const name of [undefined, '', '   ']) {
    const result = await jsonOf(
      call(createDesignHandler, as('mine'), '/api/designs', {
        method: 'POST',
        body: { name, from: 'classic' },
      }),
    );
    assert.equal(result.status, 422, `${JSON.stringify(name)} should be refused`);
  }
  const long = await jsonOf(
    call(createDesignHandler, as('mine'), '/api/designs', {
      method: 'POST',
      body: { name: 'x'.repeat(61), from: 'classic' },
    }),
  );
  assert.equal(long.status, 422);

  const trimmed = await jsonOf(
    call(createDesignHandler, as('mine'), '/api/designs', {
      method: 'POST',
      body: { name: '  Spaced  ', from: 'classic' },
    }),
  );
  assert.equal(trimmed.body.design.name, 'Spaced');
});

test('a name must be text, not something coerced into it', async () => {
  // String(null) is "null" and String({}) is "[object Object]": a caller with
  // the wrong shape would have got a design named after its own mistake.
  for (const name of [null, {}, ['a', 'b'], 42, true]) {
    const result = await jsonOf(
      call(createDesignHandler, as('mine'), '/api/designs', {
        method: 'POST',
        body: { name, from: 'classic' },
      }),
    );
    assert.equal(result.status, 422, `${JSON.stringify(name)} was accepted`);
    assert.match(result.body.error, /name/);
  }
});

test('the error that tells an agent where to look points somewhere real', async () => {
  const result = await jsonOf(
    call(createDesignHandler, as('mine'), '/api/designs', {
      method: 'POST',
      body: { name: 'No pack', pack: 'not an object' },
    }),
  );
  assert.equal(result.status, 422);
  // There is no /api/designs/presets - it resolves to the [id] route and 404s.
  assert.doesNotMatch(result.body.error, /designs\/presets/);
  // And it names the mechanism that works: GET /api/designs lists the presets
  // by name only, so an agent told to copy a pack from there finds none.
  assert.match(result.body.error, /from: "classic"/);
});

test('one account cannot read, change or delete another account\'s design', async () => {
  const mine = await jsonOf(
    call(createDesignHandler, as('mine'), '/api/designs', {
      method: 'POST',
      body: { name: 'Mine', from: 'classic' },
    }),
  );
  const id = mine.body.design.id;

  // 404 rather than 403: a stranger should not learn that the id is real.
  for (const [handler, options] of [
    [getDesignHandler, { designId: id }],
    [updateDesignHandler, { method: 'PATCH', body: { name: 'Yours' }, designId: id }],
    [deleteDesignHandler, { method: 'DELETE', designId: id }],
  ]) {
    const result = await jsonOf(call(handler, as('theirs'), `/api/designs/${id}`, options));
    assert.equal(result.status, 404, JSON.stringify(result.body));
  }

  const still = await jsonOf(call(getDesignHandler, as('mine'), `/api/designs/${id}`, { designId: id }));
  assert.equal(still.body.design.name, 'Mine');
});

test('a change with nothing in it is refused rather than a no-op success', async () => {
  const made = await jsonOf(
    call(createDesignHandler, as('mine'), '/api/designs', {
      method: 'POST',
      body: { name: 'Draft', from: 'classic' },
    }),
  );
  const id = made.body.design.id;
  const empty = await jsonOf(
    call(updateDesignHandler, as('mine'), `/api/designs/${id}`, { method: 'PATCH', body: {}, designId: id }),
  );
  assert.equal(empty.status, 422);
  assert.match(empty.body.error, /name, a pack, or both/);
});

test('deleting is idempotent from the caller\'s side: gone stays gone', async () => {
  const made = await jsonOf(
    call(createDesignHandler, as('mine'), '/api/designs', {
      method: 'POST',
      body: { name: 'Gone', from: 'classic' },
    }),
  );
  const id = made.body.design.id;
  const first = await jsonOf(call(deleteDesignHandler, as('mine'), `/api/designs/${id}`, { method: 'DELETE', designId: id }));
  assert.equal(first.status, 200);
  assert.equal(first.body.deleted, id);

  const second = await jsonOf(call(deleteDesignHandler, as('mine'), `/api/designs/${id}`, { method: 'DELETE', designId: id }));
  assert.equal(second.status, 404, 'and says so rather than pretending');
});
