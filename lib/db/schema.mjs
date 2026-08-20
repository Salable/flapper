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
} from 'drizzle-orm/pg-core';

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  /** Offering: 'standard' | 'plus'. Entitlements, not billing - see lib/db/entitlements.mjs. */
  tier: text('tier').notNull().default('standard'),
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
  /** The queue this board renders. Attach order decides who stays live when
   * entitlements shrink: the earliest attachment keeps playing. */
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
