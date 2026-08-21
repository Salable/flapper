/**
 * Per-(user, client) revocation watermarks - what makes Disconnect take
 * effect now rather than at the access token's exp.
 *
 * The provider issues MCP access tokens as JWTs and keeps no record of them,
 * so the verifier (lib/api/mcp.mjs) cannot look a token up; what it can do
 * is compare the token's `iat` to the newest watermark for its (sub,
 * client_id). `recordRevocation` moves the watermark to now; anything issued
 * at or before that instant is refused from the next request on.
 *
 * Second resolution on purpose: `iat` is whole seconds, and a token minted
 * in the same second as the revocation is treated as revoked - the safe
 * side for a button someone pressed because they suspect misuse.
 */

import { and, eq } from 'drizzle-orm';
import { oauthClientRevocation } from '../db/schema.mjs';

/** Refuse everything this client holds for this user that was issued up to now. */
export async function recordRevocation(db, { userId, clientId, at = new Date() } = {}) {
  const notBefore = new Date(Math.ceil(at.getTime() / 1000) * 1000);
  await db
    .insert(oauthClientRevocation)
    .values({ userId, clientId, notBefore })
    .onConflictDoUpdate({
      target: [oauthClientRevocation.userId, oauthClientRevocation.clientId],
      set: { notBefore },
    });
  return notBefore;
}

/**
 * Was a token with these claims revoked? `iat` is the JWT's issued-at in
 * seconds. A token without `iat` cannot be placed relative to the watermark
 * and is treated as revoked whenever one exists.
 */
export async function isRevoked(db, { userId, clientId, iat } = {}) {
  if (!userId || !clientId) return false;
  const [row] = await db
    .select({ notBefore: oauthClientRevocation.notBefore })
    .from(oauthClientRevocation)
    .where(and(eq(oauthClientRevocation.userId, userId), eq(oauthClientRevocation.clientId, clientId)))
    .limit(1);
  if (!row) return false;
  if (typeof iat !== 'number') return true;
  return iat * 1000 < row.notBefore.getTime();
}
