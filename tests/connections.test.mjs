import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { makeTestDb, resetTestDb, makeTestUser } from '../lib/db/testing.mjs';
import { listConnections, disconnect } from '../lib/api/connections.mjs';
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
  assert.deepEqual(again, { ok: true, removedConsents: 0, revokedRefreshTokens: 0, revokedAccessTokens: 0 });
});
