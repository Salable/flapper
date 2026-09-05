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
import { isPublicRoutableHost } from '@better-auth/core/utils/host';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { getDb } from './db/client.mjs';
import * as schema from './db/schema.mjs';
import { issueFreeLicence } from './salable/licence.mjs';

/**
 * CIMD metadata fetch with resolve-once DNS validation and connection
 * pinning - a corrected copy of @better-auth/cimd/node's
 * fetchClientMetadataResource, which crashes on Node >= 20: its lookup hook
 * always answers in the (err, address, family) shape, but Happy Eyeballs
 * (net's autoSelectFamily default) calls the hook with {all: true} and
 * expects an array, so every fetch died with "Invalid IP address:
 * undefined" and no client (Claude included) could register via CIMD.
 * Semantics preserved: every DNS answer must be public-routable, the pinned
 * address carries the original hostname as Host/SNI, redirects are returned
 * to the caller, never followed. Drop this when upstream fixes the hook.
 */
async function fetchClientMetadataResource(input: Request | string | URL, init?: RequestInit) {
  const webRequest = new Request(input, init);
  const url = new URL(webRequest.url);
  if (url.protocol !== 'https:') throw new TypeError('CIMD transport requires an HTTPS URL');
  if (webRequest.method !== 'GET' && webRequest.method !== 'HEAD') {
    throw new TypeError('CIMD transport supports only GET and HEAD');
  }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new TypeError('metadata hostname returned no DNS addresses');
  for (const result of addresses) {
    if (!isPublicRoutableHost(result.address)) {
      throw new TypeError('metadata hostname must resolve only to public-routable addresses');
    }
  }
  const pinned = addresses[0];
  const headers = Object.fromEntries(webRequest.headers.entries());
  headers.host = url.host;
  const signal = init?.signal ?? webRequest.signal;
  return new Promise<Response>((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        agent: false,
        headers,
        method: webRequest.method,
        servername: isIP(url.hostname.replace(/^\[|\]$/g, '')) === 0 ? url.hostname : undefined,
        signal: signal ?? undefined,
        lookup: (_hostname, options, callback) => {
          if (options?.all) {
            (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(
              null,
              [{ address: pinned.address, family: pinned.family }],
            );
          } else {
            callback(null, pinned.address, pinned.family);
          }
        },
      },
      (response) => {
        const status = response.statusCode ?? 500;
        const bodyless = webRequest.method === 'HEAD' || [204, 205, 304].includes(status);
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) for (const item of value) responseHeaders.append(name, item);
          else if (value !== undefined) responseHeaders.append(name, value);
        }
        resolve(
          new Response(bodyless ? null : (Readable.toWeb(response) as ReadableStream), {
            headers: responseHeaders,
            status,
            statusText: response.statusMessage,
          }),
        );
      },
    );
    req.once('error', reject);
    req.end();
  });
}

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
    user: {
      additionalFields: {
        // The consent record: written at signup, the marketing flag editable
        // from Account. Timestamps are set server-side from the flags in the
        // databaseHooks below so a client cannot backdate a consent.
        marketingConsent: { type: 'boolean', required: false, defaultValue: false, input: true },
        marketingConsentAt: { type: 'date', required: false, input: false },
        termsVersion: { type: 'string', required: false, input: true },
        termsAcceptedAt: { type: 'date', required: false, input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user: any) => ({
            data: {
              ...user,
              termsAcceptedAt: user.termsVersion ? new Date() : null,
              marketingConsentAt: user.marketingConsent ? new Date() : null,
            },
          }),
          /*
           * Free is a licence. Signing up issues a perpetual Salable Only
           * Subscription on the free plan - no Stripe, no card, no "get your
           * licence" step - so every account is a Grantee from its first
           * second, and going paid is a change of plan and nothing else.
           *
           * Best-effort by design: signup must not fail because Salable is
           * down. An account with no licence still signs in and still sees
           * its dashboard; it cannot create a board until
           * tools/backfill-licences.mjs catches it up. A build with no
           * SALABLE_API_KEY skips this entirely and gates nothing.
           */
          after: async (user: any) => {
            const granted = await issueFreeLicence(user.id);
            if (granted) console.log(`flapper: free licence issued to ${user.id}`);
          },
        },
        update: {
          before: async (data: any) => {
            if (typeof data.marketingConsent !== 'boolean') return { data };
            return { data: { ...data, marketingConsentAt: data.marketingConsent ? new Date() : null } };
          },
        },
      },
    },
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
        // Lets the login page name the app asking to connect, before there
        // is a session (the lookup still demands the signed oauth_query).
        allowPublicClientPrelogin: true,
        // Claude's CIMD document declares the RFC 7523 jwt-bearer grant, and
        // registration rejects any declared grant outside this set. Listing
        // it makes registration accept the document; the token endpoint has
        // no handler for it, so an actual jwt-bearer exchange still gets a
        // clean OAuth error (Claude only uses code + refresh here).
        grantTypes: [
          'authorization_code',
          'refresh_token',
          'urn:ietf:params:oauth:grant-type:jwt-bearer',
        ],
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
