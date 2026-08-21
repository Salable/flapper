/**
 * Better Auth, configured over the same drizzle db the rest of the app uses.
 *
 * Lazy on purpose: getDb() is async (PGlite boots and migrates on first use),
 * so the auth instance is created behind a shared promise the same way the db
 * and broker singletons are. This file and next-ctx.ts are the only places
 * that know Better Auth exists; tested code receives a `getSession` function.
 *
 * Since the MCP OAuth work this is also the OAuth 2.1 authorization server:
 * the mcp() plugin (which *is* the oauth provider - never add a separate
 * oauthProvider()) issues JWT access tokens whose audience is the MCP
 * endpoint and whose subject is the user; jwt() supplies the signing keys and
 * /api/auth/jwks; cimd() accepts URL client_ids per the 2026-07-28 MCP spec,
 * with dynamic registration open for clients that predate it. All OAuth
 * endpoints live under /api/auth/oauth2/*.
 */

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { jwt } from 'better-auth/plugins';
import { verifyAccessTokenRequest, requestToResourceInput } from 'better-auth/oauth2';
import { mcp } from '@better-auth/mcp';
import { cimd } from '@better-auth/cimd';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import { getDb } from './db/client.mjs';
import * as schema from './db/schema.mjs';

/**
 * The public origin. The OAuth issuer, JWKS URL, and the RFC 8707 resource
 * identifier all derive from it, and the resource string must be
 * byte-identical everywhere it appears - so it is computed once, here.
 * Unset in production, OAuth is broken (tokens would name a localhost
 * issuer); sessions and board keys still work, hence loud-not-fatal.
 */
function publicBaseUrl() {
  const url = process.env.BETTER_AUTH_URL;
  if (!url && process.env.NODE_ENV === 'production') {
    console.error('flapper: BETTER_AUTH_URL is not set - MCP OAuth will not work');
  }
  return (url ?? 'http://localhost:3000').replace(/\/+$/, '');
}

/** The MCP endpoint as an RFC 8707 resource identifier. No trailing slash. */
export function mcpResource() {
  return `${publicBaseUrl()}/api/mcp`;
}

/**
 * The OAuth issuer: better-auth's context baseURL, which includes the
 * basePath. Must byte-match what discovery documents advertise and what
 * tokens carry in `iss`.
 */
export function oauthIssuer() {
  return `${publicBaseUrl()}/api/auth`;
}

function makeAuth(db: unknown) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    console.error('flapper: BETTER_AUTH_SECRET is not set - sessions will not survive restarts');
  }
  return betterAuth({
    database: drizzleAdapter(db as never, { provider: 'pg', schema }),
    emailAndPassword: { enabled: true },
    secret: secret ?? 'flapper-dev-secret-do-not-deploy',
    baseURL: publicBaseUrl(),
    // The generic /token path would shadow /oauth2/token.
    disabledPaths: ['/token'],
    plugins: [
      jwt(),
      mcp({
        loginPage: '/login',
        consentPage: '/consent',
        resource: mcpResource(),
        // Claude and ChatGPT self-register: Claude requires DCR when CIMD is
        // unavailable and has no UI for pasting a client id.
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
      }),
      cimd({ fetchClientMetadataResource, metadataProfile: 'mcp-2026-07-28' }),
    ],
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

/**
 * Verify an MCP OAuth access token (a JWT this server issued) and return its
 * claims, or throw. Local verification against our own JWKS - no db read.
 * The issuer is better-auth's context baseURL, which includes the basePath.
 */
export async function verifyMcpAccessToken(request: Request) {
  return verifyAccessTokenRequest(requestToResourceInput(request), {
    verifyOptions: {
      issuer: oauthIssuer(),
      audience: mcpResource(),
    },
    jwksUrl: `${oauthIssuer()}/jwks`,
  });
}
