import test from 'node:test';
import assert from 'node:assert/strict';
import { salableClient, salableConfig, SalableError, DEFAULT_API_BASE } from '../lib/salable/client.mjs';
import {
  ENTITLEMENTS,
  FREE_ALLOWANCE,
  allowanceFrom,
  boardTypeEntitlement,
  issueFreeLicence,
  licenceReader,
} from '../lib/salable/licence.mjs';

/**
 * The commercial model, driven without a network: the client gets a stub
 * fetch and is asserted on the request it *builds*, so the shape checked
 * here is the shape Salable receives. Verified against
 * https://salable.app/openapi.yaml on 2026-09-02.
 */

const ENV = { SALABLE_API_KEY: 'sk_test_123', SALABLE_FREE_PLAN_ID: 'plan_free' };

/** A fetch that records what it was asked and answers what it was told to. */
function stubFetch(answers) {
  const calls = [];
  const queue = [...answers];
  const impl = async (url, init) => {
    calls.push({ url: new URL(url), init });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body ?? {}), {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { impl, calls };
}

const client = (answers, env = ENV) => {
  const { impl, calls } = stubFetch(answers);
  return { api: salableClient({ config: salableConfig(env), fetchImpl: impl }), calls };
};

/* ---- the vocabulary ---- */

test('an account with no board.create holds no licence, whatever else it has', () => {
  const allowance = allowanceFrom(['boards:unlimited', 'board.private']);
  assert.equal(allowance.licensed, false);
  assert.equal(allowance.maxBoards, 0);
});

test('the free licence reads as one live board, public', () => {
  const allowance = allowanceFrom([ENTITLEMENTS.createBoard, 'boards:1']);
  assert.equal(allowance.licensed, true);
  assert.equal(allowance.maxBoards, 1);
  assert.deepEqual([...allowance.types], ['live']);
  assert.equal(allowance.privateBoards, false);
  assert.equal(allowance.maxBoards, FREE_ALLOWANCE.maxBoards);
});

test('a bespoke licence reads as its entitlements, and unlimited means unlimited', () => {
  const allowance = allowanceFrom([
    ENTITLEMENTS.createBoard,
    'boards:unlimited',
    boardTypeEntitlement('scheduled'),
    boardTypeEntitlement('shared'),
    ENTITLEMENTS.privateBoard,
  ]);
  assert.equal(allowance.maxBoards, Infinity);
  assert.deepEqual([...allowance.types], ['live', 'scheduled', 'shared']);
  assert.equal(allowance.privateBoards, true);
});

test('two plans granting a cap resolve to the more generous one', () => {
  const allowance = allowanceFrom([ENTITLEMENTS.createBoard, 'boards:3', 'boards:25']);
  assert.equal(allowance.maxBoards, 25);
});

test('a licence that grants board.create and forgets a cap still gets one board', () => {
  // A plan misconfigured in the dashboard should under-serve, not entitle
  // nothing at all - the account paid for something.
  assert.equal(allowanceFrom([ENTITLEMENTS.createBoard]).maxBoards, 1);
});

test('a value that is not a cap or a type is ignored rather than guessed at', () => {
  const allowance = allowanceFrom([ENTITLEMENTS.createBoard, 'boards:many', 'api_access']);
  assert.equal(allowance.maxBoards, 1);
  assert.deepEqual([...allowance.types], ['live']);
});

/* ---- the wire ---- */

test('the entitlement check is a GET with granteeId in the query and a bearer key', async () => {
  const { api, calls } = client([
    { body: { data: { entitlements: [{ type: 'entitlement', value: 'board.create', expiryDate: null }] } } },
  ]);
  const { values, expiryDate } = await api.checkEntitlements({ granteeId: 'user_1', owner: 'user_1' });
  assert.deepEqual(values, ['board.create']);
  assert.equal(expiryDate, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].url.origin + calls[0].url.pathname, `${DEFAULT_API_BASE}/entitlements/check`);
  assert.equal(calls[0].url.searchParams.get('granteeId'), 'user_1');
  assert.equal(calls[0].url.searchParams.get('owner'), 'user_1');
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk_test_123');
});

test('a 404 from the check is a grantee nobody has licensed, not a failure', async () => {
  const { api } = client([{ status: 404, body: { error: 'not found' } }]);
  assert.deepEqual(await api.checkEntitlements({ granteeId: 'ghost' }), { values: [], expiryDate: null });
});

test('a 500 from the check is a failure, and says so with the status', async () => {
  const { api } = client([{ status: 500, body: {} }]);
  await assert.rejects(() => api.checkEntitlements({ granteeId: 'user_1' }), (error) => {
    assert.ok(error instanceof SalableError);
    assert.equal(error.salableStatus, 500);
    return true;
  });
});

test('the free licence is a perpetual subscription on the free plan, account as owner and grantee', async () => {
  const { api, calls } = client([{ status: 201, body: { data: { uuid: 'sub_1', isSalableOnly: true } } }]);
  const created = await api.createFreeLicence({ granteeId: 'user_1' });
  assert.equal(created.uuid, 'sub_1');
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].url.pathname, '/api/subscriptions');
  // The spec's shape, not the guide's: plans[].planId + grantee, owner
  // alongside, and no isSalableOnly on the way in.
  assert.deepEqual(sent, {
    plans: [{ planId: 'plan_free', grantee: 'user_1' }],
    owner: 'user_1',
    isPerpetual: true,
  });
  assert.equal('isSalableOnly' in sent, false);
});

test('no free plan id configured is a refusal to guess which plan is free', async () => {
  const { api } = client([{ status: 201, body: {} }], { SALABLE_API_KEY: 'sk_test_123' });
  await assert.rejects(() => api.createFreeLicence({ granteeId: 'user_1' }), /SALABLE_FREE_PLAN_ID/);
});

/* ---- asking, and what happens when Salable does not answer ---- */

test('a build with no key gates nothing: a fork is a whole product', async () => {
  const reader = licenceReader({ client: salableClient({ config: salableConfig({}) }) });
  assert.equal(reader.configured, false);
  const allowance = await reader.allowanceFor('user_1');
  assert.equal(allowance.maxBoards, Infinity);
  assert.equal(allowance.types, null);
  assert.equal(allowance.privateBoards, true);
  assert.equal(allowance.source, 'unlicensed');
});

test('two asks inside the ttl are one call; forget() makes the next one fresh', async () => {
  const { api, calls } = client([
    { body: { data: { entitlements: [{ value: 'board.create' }, { value: 'boards:1' }] } } },
  ]);
  const reader = licenceReader({ client: api, ttlMs: 60_000 });
  await reader.allowanceFor('user_1');
  await reader.allowanceFor('user_1');
  assert.equal(calls.length, 1);
  reader.forget('user_1');
  await reader.allowanceFor('user_1');
  assert.equal(calls.length, 2);
});

test('a stale answer beats the free plan when Salable stops answering', async () => {
  const { impl, calls } = stubFetch([
    { body: { data: { entitlements: [{ value: 'board.create' }, { value: 'boards:unlimited' }] } } },
    new Error('socket hang up'),
  ]);
  let clock = 0;
  const reader = licenceReader({
    client: salableClient({ config: salableConfig(ENV), fetchImpl: impl }),
    ttlMs: 1000,
    now: () => clock,
  });
  const fresh = await reader.allowanceFor('user_1');
  assert.equal(fresh.maxBoards, Infinity);
  clock = 5000; // past the ttl, so it asks again and the ask fails
  const stale = await reader.allowanceFor('user_1');
  assert.equal(stale.maxBoards, Infinity, 'what they bought, not what free grants');
  assert.equal(stale.source, 'stale');
  assert.equal(calls.length, 2);
});

test('an outage with nothing cached degrades to free: never blocked, never a discount', async () => {
  const { impl } = stubFetch([new Error('ECONNREFUSED')]);
  const reader = licenceReader({
    client: salableClient({ config: salableConfig(ENV), fetchImpl: impl }),
  });
  const allowance = await reader.allowanceFor('user_1');
  assert.equal(allowance.licensed, true);
  assert.equal(allowance.maxBoards, FREE_ALLOWANCE.maxBoards);
  assert.equal(allowance.privateBoards, false);
  assert.equal(allowance.source, 'fallback');
});

test('issuing the free licence never throws at a signup', async () => {
  const { impl } = stubFetch([new Error('salable is down')]);
  const down = salableClient({ config: salableConfig(ENV), fetchImpl: impl });
  assert.equal(await issueFreeLicence('user_1', { client: down }), false);

  const { impl: ok } = stubFetch([{ status: 201, body: { data: { uuid: 'sub_1' } } }]);
  const up = salableClient({ config: salableConfig(ENV), fetchImpl: ok });
  assert.equal(await issueFreeLicence('user_1', { client: up }), true);
});

test('an unconfigured build issues no licence and says nothing happened', async () => {
  assert.equal(await issueFreeLicence('user_1', { client: salableClient({ config: salableConfig({}) }) }), false);
});
