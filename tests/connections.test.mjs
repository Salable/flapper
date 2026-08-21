import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { makeTestDb, resetTestDb, makeTestUser } from '../lib/db/testing.mjs';
import { listConnections, disconnect } from '../lib/api/connections.mjs';
import { verifyMcpBearer } from '../lib/api/mcp.mjs';
import { recordRevocation } from '../lib/api/revocations.mjs';
import {
  oauthClient,
  oauthConsent,
  oauthAccessToken,
  oauthRefreshToken,
} from '../lib/db/schema.mjs';

/**
 * Connected apps over the OAuth tables, with rows seeded the way the
 * provider would leave them after a real authorization.
 */

let db;
before(async () => {
  db = await makeTestDb();
});
beforeEach(async () => {
  await resetTestDb(db);
  await makeTestUser(db, { id: 'owner' });
  await makeTestUser(db, { id: 'other' });
});

const JWT_SHAPED = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJvd25lciJ9.c2ln';
const asUser = (id) => async () => ({ user: { id } });
const request = (path, method = 'GET') => new Request(`https://flapper.test${path}`, { method });

async function seedGrant({ userId = 'owner', clientId = 'https://claude.ai/oauth/mcp', name = 'Claude' } = {}) {
  await db
    .insert(oauthClient)
    .values({ id: `c-${clientId}`, clientId, name, uri: 'https://claude.ai', redirectUris: ['https://claude.ai/cb'] })
    .onConflictDoNothing();
  await db.insert(oauthConsent).values({
    id: `consent-${userId}-${clientId}`,
    clientId,
    userId,
    scopes: ['openid', 'offline_access'],
    createdAt: new Date(),
  });
  await db.insert(oauthRefreshToken).values({
    id: `rt-${userId}-${clientId}`,
    token: `rt-token-${userId}-${clientId}`,
    clientId,
    userId,
    scopes: ['openid'],
    expiresAt: new Date(Date.now() + 86400000),
    createdAt: new Date(),
  });
  await db.insert(oauthAccessToken).values({
    id: `at-${userId}-${clientId}`,
    token: `at-token-${userId}-${clientId}`,
    clientId,
    userId,
    scopes: ['openid'],
    expiresAt: new Date(Date.now() + 3600000),
    createdAt: new Date(),
  });
}

test('listing needs a session and shows only the user’s grants, named', async () => {
  await seedGrant();
  await seedGrant({ userId: 'other', clientId: 'https://chatgpt.com/oauth', name: 'ChatGPT' });

  const anon = await listConnections(request('/api/account/connections'), { db, getSession: async () => null });
  assert.equal(anon.status, 401);

  const mine = await listConnections(request('/api/account/connections'), { db, getSession: asUser('owner') });
  assert.equal(mine.status, 200);
  const { connections } = await mine.json();
  assert.equal(connections.length, 1);
  assert.equal(connections[0].name, 'Claude');
  assert.equal(connections[0].uri, 'https://claude.ai');
  assert.deepEqual(connections[0].scopes, ['openid', 'offline_access']);
});

test('disconnect removes the consent and revokes both token kinds, for that user only', async () => {
  const clientId = 'https://claude.ai/oauth/mcp';
  await seedGrant();
  await seedGrant({ userId: 'other' });

  const response = await disconnect(request(`/api/account/connections/x`, 'DELETE'), {
    db,
    getSession: asUser('owner'),
    clientId,
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(typeof body.accessEndsAt, 'number');
  assert.ok(body.accessEndsAt <= Date.now() + 1000);
  delete body.accessEndsAt;
  assert.deepEqual(body, { ok: true, removedConsents: 1, revokedRefreshTokens: 1, revokedAccessTokens: 1 });

  // The owner's grant is gone and their tokens are revoked...
  const listed = await (await listConnections(request('/api/account/connections'), { db, getSession: asUser('owner') })).json();
  assert.equal(listed.connections.length, 0);
  const [rt] = await db.select().from(oauthRefreshToken).where(eq(oauthRefreshToken.userId, 'owner'));
  assert.ok(rt.revoked instanceof Date);
  const [at] = await db.select().from(oauthAccessToken).where(eq(oauthAccessToken.userId, 'owner'));
  assert.ok(at.revoked instanceof Date);

  // ...and the other user's identical grant is untouched.
  const [otherRt] = await db.select().from(oauthRefreshToken).where(eq(oauthRefreshToken.userId, 'other'));
  assert.equal(otherRt.revoked, null);
  const theirs = await (await listConnections(request('/api/account/connections'), { db, getSession: asUser('other') })).json();
  assert.equal(theirs.connections.length, 1);

  // Idempotent: a second disconnect is a clean no-op.
  const again = await (await disconnect(request('/x', 'DELETE'), { db, getSession: asUser('owner'), clientId })).json();
  delete again.accessEndsAt;
  assert.deepEqual(again, { ok: true, removedConsents: 0, revokedRefreshTokens: 0, revokedAccessTokens: 0 });
});

test('disconnect cuts off JWT access tokens the provider never stored', async () => {
  // MCP access tokens are JWTs with no oauth_access_token row, so the only
  // thing standing between a revoked client and the wall is the watermark.
  const clientId = 'https://claude.ai/oauth/mcp';
  await seedGrant();
  const request_ = new Request('https://flapper.test/api/mcp', { method: 'POST' });
  const issuedAt = (ms) => Math.floor(ms / 1000);
  const claims = (iat, overrides = {}) => ({ sub: 'owner', client_id: clientId, iat, exp: iat + 3600, ...overrides });
  const verify = (c) => verifyMcpBearer(db, request_, JWT_SHAPED, { verifyUserToken: async () => c });

  const before = issuedAt(Date.now() - 60_000);
  assert.equal((await verify(claims(before)))?.extra.mode, 'user', 'valid before any disconnect');

  const { accessEndsAt } = await (
    await disconnect(request('/x', 'DELETE'), { db, getSession: asUser('owner'), clientId })
  ).json();

  assert.equal(await verify(claims(before)), undefined, 'issued before the disconnect: refused');
  assert.equal(await verify(claims(issuedAt(accessEndsAt - 1))), undefined, 'same second as the click: refused');
  assert.equal((await verify(claims(issuedAt(accessEndsAt))))?.extra.mode, 'user', 'the next whole second: accepted');
  assert.equal(await verify(claims(before, { iat: undefined })), undefined, 'no iat: cannot be placed, refused');
  // Reconnecting issues a token dated after the watermark - and works.
  const after = issuedAt(accessEndsAt + 5000);
  assert.equal((await verify(claims(after)))?.extra.mode, 'user', 'issued after: accepted');
  // Another client of the same user, and the same client for another user, are untouched.
  assert.equal((await verify(claims(before, { client_id: 'https://chatgpt.com/oauth' })))?.extra.mode, 'user');
  assert.equal((await verify(claims(before, { sub: 'other' })))?.extra.mode, 'user');
  // A later disconnect moves the watermark forward (upsert), catching the newer token too.
  await recordRevocation(db, { userId: 'owner', clientId, at: new Date(accessEndsAt + 10_000) });
  assert.equal(await verify(claims(after)), undefined);
});

test('a client with no consent but a live refresh token is still listed - and disconnectable', async () => {
  const clientId = 'https://claude.ai/oauth/mcp';
  await seedGrant();
  // The pre-watermark disconnect: consent gone, tokens left alive.
  await db.delete(oauthConsent).where(eq(oauthConsent.clientId, clientId));

  const listed = await (await listConnections(request('/api/account/connections'), { db, getSession: asUser('owner') })).json();
  assert.equal(listed.connections.length, 1, 'still has a way in, so still shown');
  assert.equal(listed.connections[0].name, 'Claude');

  await disconnect(request('/x', 'DELETE'), { db, getSession: asUser('owner'), clientId });
  const after = await (await listConnections(request('/api/account/connections'), { db, getSession: asUser('owner') })).json();
  assert.equal(after.connections.length, 0);
});

