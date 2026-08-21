/**
 * Connected apps: the OAuth clients a user has granted, and disconnecting
 * one. Plain (request, ctx) -> Response handlers like the rest of lib/api,
 * over the OAuth tables directly.
 *
 * Disconnecting has to do more than Better Auth's delete-consent, which
 * removes the grant but leaves issued tokens alive - a refresh token lasts
 * thirty days. So: drop every consent for (user, client) AND revoke that
 * pair's refresh and access tokens. An access token is a JWT verified
 * against JWKS, so one already issued keeps working until its exp (an
 * hour at most); the UI says so.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { json, reject } from './errors.mjs';
import {
  oauthClient,
  oauthConsent,
  oauthAccessToken,
  oauthRefreshToken,
} from '../db/schema.mjs';

async function handle(fn) {
  try {
    return await fn();
  } catch (error) {
    return json(error?.status || 500, { error: error?.message || 'internal error' });
  }
}

async function requireSession(getSession) {
  const session = await getSession?.();
  if (!session) reject('sign in to manage connected apps', 401);
  return session;
}

/** One row per client the user has consented to, with what it calls itself. */
export async function listConnections(request, { db, getSession }) {
  return handle(async () => {
    const session = await requireSession(getSession);
    const rows = await db
      .select({
        consentId: oauthConsent.id,
        clientId: oauthConsent.clientId,
        scopes: oauthConsent.scopes,
        grantedAt: oauthConsent.createdAt,
        name: oauthClient.name,
        uri: oauthClient.uri,
      })
      .from(oauthConsent)
      .leftJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
      .where(eq(oauthConsent.userId, session.user.id));
    // A client may hold several consents (re-authorized with new scopes);
    // show it once, newest grant first.
    const byClient = new Map();
    for (const row of rows) {
      const prior = byClient.get(row.clientId);
      if (!prior || (row.grantedAt ?? 0) > (prior.grantedAt ?? 0)) byClient.set(row.clientId, row);
    }
    return json(200, {
      connections: [...byClient.values()]
        .sort((a, b) => (b.grantedAt?.getTime?.() ?? 0) - (a.grantedAt?.getTime?.() ?? 0))
        .map((row) => ({
          clientId: row.clientId,
          name: row.name || row.clientId,
          uri: row.uri || null,
          scopes: row.scopes ?? [],
          grantedAt: row.grantedAt ? new Date(row.grantedAt).getTime() : null,
        })),
    });
  });
}

/** Remove the grant and revoke the pair's tokens. Idempotent. */
export async function disconnect(request, { db, getSession, clientId }) {
  return handle(async () => {
    const session = await requireSession(getSession);
    if (typeof clientId !== 'string' || clientId === '') reject('which app? clientId is missing', 422);
    const userId = session.user.id;
    const now = new Date();
    const pair = (table) => and(eq(table.userId, userId), eq(table.clientId, clientId));
    const consents = await db.delete(oauthConsent).where(pair(oauthConsent)).returning({ id: oauthConsent.id });
    const refresh = await db
      .update(oauthRefreshToken)
      .set({ revoked: now })
      .where(and(pair(oauthRefreshToken), isNull(oauthRefreshToken.revoked)))
      .returning({ id: oauthRefreshToken.id });
    const access = await db
      .update(oauthAccessToken)
      .set({ revoked: now })
      .where(and(pair(oauthAccessToken), isNull(oauthAccessToken.revoked)))
      .returning({ id: oauthAccessToken.id });
    return json(200, {
      ok: true,
      removedConsents: consents.length,
      revokedRefreshTokens: refresh.length,
      revokedAccessTokens: access.length,
    });
  });
}
