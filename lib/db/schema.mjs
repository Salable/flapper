/**
 * The Postgres schema: Better Auth's four tables plus ours.
 *
 * Plain .mjs on purpose - drizzle's table builders are runtime functions, and
 * keeping the schema importable by `node --test` is what lets the query layer
 * be tested against an in-memory PGlite with zero environment.
 *
 * The auth tables are hand-written to Better Auth's documented core schema
 * (verified against `npx @better-auth/cli generate`); when upgrading
 * better-auth, re-run the generator and diff.
 */

import {
  pgTable,
  text,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  doublePrecision,
  integer,
  index,
  bigint,
  primaryKey,
} from 'drizzle-orm/pg-core';

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  /** Dormant since 4.0 (tier-based offerings moved to attic/). Kept because
   * dropping a Better Auth table column buys nothing; Salable will bring its
   * own entitlement source when gating returns. */
  tier: text('tier').notNull().default('standard'),
  /** The consent record PECR asks for: did they tick the marketing box, and when; which Terms they accepted, and when. */
  marketingConsent: boolean('marketing_consent').notNull().default(false),
  marketingConsentAt: timestamp('marketing_consent_at'),
  termsVersion: text('terms_version'),
  termsAcceptedAt: timestamp('terms_accepted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  // Better Auth 1.7: session revocation and back-channel logout markers.
  loggedOutAt: timestamp('logged_out_at'),
  revokedAt: timestamp('revoked_at'),
});

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    // Better Auth 1.7 scopes external identities by (issuer, accountId);
    // credential accounts carry 'local:credential'.
    issuer: text('issuer').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('account_issuer_accountId_uidx').on(table.issuer, table.accountId)],
);

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/* ---- OAuth provider tables (Better Auth jwt + @better-auth/mcp 1.7.1) ----
 *
 * Hand-written like the four core tables above, verified by dumping the
 * installed plugins' schema metadata (plugin.schema) - re-dump and diff when
 * upgrading the @better-auth/* packages. Authorization codes have no table:
 * they live in `verification`. string[] fields are text arrays and json is
 * jsonb, matching what the Better Auth CLI emits for pg.
 */

/** The jwt() plugin's signing keys; /api/auth/jwks serves the public halves. */
export const jwks = pgTable('jwks', {
  id: text('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at'),
  alg: text('alg'),
  crv: text('crv'),
});

/** A registered OAuth client - via DCR, CIMD discovery, or admin creation. */
export const oauthClient = pgTable(
  'oauth_client',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull().unique(),
    clientSecret: text('client_secret'),
    clientDiscoveryId: text('client_discovery_id'),
    disabled: boolean('disabled').default(false),
    skipConsent: boolean('skip_consent'),
    enableEndSession: boolean('enable_end_session'),
    subjectType: text('subject_type'),
    scopes: text('scopes').array(),
    clientCredentialsScopes: text('client_credentials_scopes').array().default([]),
    userId: text('user_id').references(() => user.id),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
    name: text('name'),
    uri: text('uri'),
    icon: text('icon'),
    contacts: text('contacts').array(),
    tos: text('tos'),
    policy: text('policy'),
    softwareId: text('software_id'),
    softwareVersion: text('software_version'),
    softwareStatement: text('software_statement'),
    redirectUris: text('redirect_uris').array().notNull(),
    postLogoutRedirectUris: text('post_logout_redirect_uris').array(),
    backchannelLogoutUri: text('backchannel_logout_uri'),
    backchannelLogoutSessionRequired: boolean('backchannel_logout_session_required'),
    tokenEndpointAuthMethod: text('token_endpoint_auth_method'),
    applicationType: text('application_type'),
    jwks: text('jwks'),
    jwksUri: text('jwks_uri'),
    grantTypes: text('grant_types').array(),
    responseTypes: text('response_types').array(),
    requirePKCE: boolean('require_pkce'),
    dpopBoundAccessTokens: boolean('dpop_bound_access_tokens').default(false),
    referenceId: text('reference_id'),
    metadata: jsonb('metadata'),
  },
  (table) => [index('oauth_client_user_idx').on(table.userId)],
);

/** An RFC 8707 resource (audience); the mcp() plugin seeds ours at init. */
export const oauthResource = pgTable('oauth_resource', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull().unique(),
  name: text('name').notNull(),
  accessTokenTtl: integer('access_token_ttl'),
  refreshTokenTtl: integer('refresh_token_ttl'),
  signingAlgorithm: text('signing_algorithm'),
  signingKeyId: text('signing_key_id'),
  allowedScopes: text('allowed_scopes').array(),
  customClaims: jsonb('custom_claims'),
  dpopBoundAccessTokensRequired: boolean('dpop_bound_access_tokens_required').default(false),
  disabled: boolean('disabled').default(false),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
  policyVersion: integer('policy_version').default(1),
  metadata: jsonb('metadata'),
});

export const oauthClientResource = pgTable(
  'oauth_client_resource',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    resourceId: text('resource_id')
      .notNull()
      .references(() => oauthResource.identifier, { onDelete: 'cascade' }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at'),
  },
  (table) => [
    // Load-bearing: registration relies on this unique pair for idempotency.
    uniqueIndex('oauth_client_resource_uidx').on(table.clientId, table.resourceId),
    index('oauth_client_resource_client_idx').on(table.clientId),
    index('oauth_client_resource_resource_idx').on(table.resourceId),
  ],
);

export const oauthRefreshToken = pgTable(
  'oauth_refresh_token',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull().unique(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId),
    sessionId: text('session_id').references(() => session.id, { onDelete: 'set null' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    referenceId: text('reference_id'),
    authorizationCodeId: text('authorization_code_id'),
    resources: text('resources').array(),
    requestedUserInfoClaims: text('requested_user_info_claims').array(),
    expiresAt: timestamp('expires_at'),
    createdAt: timestamp('created_at'),
    revoked: timestamp('revoked'),
    rotatedAt: timestamp('rotated_at'),
    rotationReplayResponse: text('rotation_replay_response'),
    rotationReplayExpiresAt: timestamp('rotation_replay_expires_at'),
    authTime: timestamp('auth_time'),
    confirmation: jsonb('confirmation'),
    scopes: text('scopes').array().notNull(),
  },
  (table) => [
    index('oauth_refresh_token_client_idx').on(table.clientId),
    index('oauth_refresh_token_session_idx').on(table.sessionId),
    index('oauth_refresh_token_user_idx').on(table.userId),
    index('oauth_refresh_token_code_idx').on(table.authorizationCodeId),
  ],
);

export const oauthAccessToken = pgTable(
  'oauth_access_token',
  {
    id: text('id').primaryKey(),
    token: text('token').unique(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId),
    sessionId: text('session_id').references(() => session.id, { onDelete: 'set null' }),
    userId: text('user_id').references(() => user.id),
    referenceId: text('reference_id'),
    authorizationCodeId: text('authorization_code_id'),
    resources: text('resources').array(),
    requestedUserInfoClaims: text('requested_user_info_claims').array(),
    refreshId: text('refresh_id').references(() => oauthRefreshToken.id),
    expiresAt: timestamp('expires_at'),
    createdAt: timestamp('created_at'),
    revoked: timestamp('revoked'),
    confirmation: jsonb('confirmation'),
    scopes: text('scopes').array().notNull(),
  },
  (table) => [
    index('oauth_access_token_client_idx').on(table.clientId),
    index('oauth_access_token_session_idx').on(table.sessionId),
    index('oauth_access_token_user_idx').on(table.userId),
    index('oauth_access_token_code_idx').on(table.authorizationCodeId),
    index('oauth_access_token_refresh_idx').on(table.refreshId),
  ],
);

/**
 * Disconnect's teeth. MCP access tokens are JWTs verified against JWKS with
 * no row in oauth_access_token (the provider only stores opaque tokens), so
 * revoking the grant alone leaves an issued token live until its exp. This
 * table holds one watermark per (user, client): any token issued before
 * `notBefore` is refused by the MCP verifier. Upserted on disconnect, so it
 * never grows past one row per pair; reconnecting issues tokens dated after
 * the watermark and needs no cleanup.
 */
export const oauthClientRevocation = pgTable(
  'oauth_client_revocation',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    clientId: text('client_id').notNull(),
    notBefore: timestamp('not_before').notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.clientId] })],
);

/** A user's standing grant to a client; deleting the row is "disconnect". */
export const oauthConsent = pgTable(
  'oauth_consent',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId),
    userId: text('user_id').references(() => user.id),
    referenceId: text('reference_id'),
    resources: text('resources').array(),
    requestedUserInfoClaims: text('requested_user_info_claims').array(),
    scopes: text('scopes').array().notNull(),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (table) => [
    index('oauth_consent_client_idx').on(table.clientId),
    index('oauth_consent_user_idx').on(table.userId),
  ],
);

/** private_key_jwt assertion replay guard (jti); rows expire, nothing prunes. */
export const oauthClientAssertion = pgTable('oauth_client_assertion', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
});

export const queues = pgTable('queues', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull().default(''),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const boards = pgTable('boards', {
  /** 16-char base32; stays the Redis key for the command stream and state. */
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull().default(''),
  ownerId: text('owner_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  private: boolean('private').notNull().default(false),
  /** Which board-type definition drives this board (lib/board-types/). */
  type: text('type').notNull().default('live'),
  /**
   * 'active' | 'deactivated'. A deactivated board pauses its display and
   * offers exporting its items - the downgrade story once Salable gates
   * types; also a manual pause today. Never implies deletion.
   */
  status: text('status').notNull().default('active'),
  /**
   * Stored in the clear, deliberately: the settings screen must be able to
   * show it, it authorizes exactly one split-flap sign, and it sits in the
   * same trust domain as the session tokens above. Rotation is one click.
   */
  apiKey: text('api_key').notNull(),
  config: jsonb('config').notNull().default({}),
  /**
   * Playback head. `currentItemId` is the queue item that should be on the
   * glass; `currentState` distinguishes playing, holding (queue drained, last
   * page standing - the row is kept), and idle (cleared or never used).
   * `currentEpoch` increments on every reassignment so a display's advance is
   * idempotent per *play*, not per item id - loops reuse ids.
   */
  currentItemId: text('current_item_id'),
  currentState: text('current_state').notNull().default('idle'),
  currentEpoch: integer('current_epoch').notNull().default(0),
  /** The queue this board renders - strictly 1:1 since 4.0 (multi-attach
   * lives in attic/; shared screens replaced it with one slug on many
   * displays). */
  queueId: text('queue_id')
    .notNull()
    .references(() => queues.id),
  queueAttachedAt: timestamp('queue_attached_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const queueItems = pgTable(
  'queue_items',
  {
    id: text('id').primaryKey(),
    queueId: text('queue_id')
      .notNull()
      .references(() => queues.id, { onDelete: 'cascade' }),
    /** Play order is (position, id); floats with gaps, reindexed when a gap closes. */
    position: doublePrecision('position').notNull(),
    /** The validated message: {text | rows, options} as textOptions returns it. */
    payload: jsonb('payload').notNull(),
    /** Loop items return to the tail when played instead of being removed. */
    loop: boolean('loop').notNull().default(false),
    /** Consecutive enqueue failures reported by displays; poison guard. */
    errorCount: integer('error_count').notNull().default(0),
    /** Clock types: this item's slot length, computed by the host. */
    computedDurationMs: integer('computed_duration_ms'),
    /** Clock types: the item's schedule spec (see docs/BOARD-TYPES.md). */
    schedule: jsonb('schedule'),
    /** Materialized end-of-life for once-scheduled items; sweep key. */
    expiresAtMs: bigint('expires_at_ms', { mode: 'number' }),
    source: text('source').notNull().default('api'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [index('queue_items_queue_position_idx').on(table.queueId, table.position)],
);
