/**
 * Better Auth, configured over the same drizzle db the rest of the app uses.
 *
 * Lazy on purpose: getDb() is async (PGlite boots and migrates on first use),
 * so the auth instance is created behind a shared promise the same way the db
 * and broker singletons are. This file and next-ctx.ts are the only places
 * that know Better Auth exists; tested code receives a `getSession` function.
 */

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getDb } from './db/client.mjs';
import * as schema from './db/schema.mjs';

function makeAuth(db: unknown) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    console.error('flapper: BETTER_AUTH_SECRET is not set - sessions will not survive restarts');
  }
  return betterAuth({
    database: drizzleAdapter(db as never, { provider: 'pg', schema }),
    emailAndPassword: { enabled: true },
    secret: secret ?? 'flapper-dev-secret-do-not-deploy',
    baseURL: process.env.BETTER_AUTH_URL,
  });
}

declare global {
  // eslint-disable-next-line no-var
  var __flapperAuth: Promise<ReturnType<typeof makeAuth>> | undefined;
}

export function getAuth() {
  if (!globalThis.__flapperAuth) {
    globalThis.__flapperAuth = getDb().then(makeAuth);
  }
  return globalThis.__flapperAuth;
}

/** The session shape handlers care about, or null. */
export async function sessionFromHeaders(headers: Headers) {
  const auth = await getAuth();
  return auth.api.getSession({ headers });
}
