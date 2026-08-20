/**
 * Test database: in-memory PGlite with the real migrations applied.
 *
 * PGlite startup costs real time (WASM), so suites share one instance and
 * reset between tests with `resetTestDb` rather than rebuilding.
 */

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from './schema.mjs';

export async function makeTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, {
    migrationsFolder: new URL('../../drizzle', import.meta.url).pathname,
  });
  return db;
}

export async function resetTestDb(db) {
  await db.execute(
    sql.raw('TRUNCATE "queue_items", "boards", "session", "account", "verification", "user" CASCADE'),
  );
}

/** A user row for tests; auth flows are Better Auth's problem, not ours. */
export async function makeTestUser(db, { id = 'u1', email = `${id}@test.local` } = {}) {
  await db.insert(schema.user).values({ id, name: id, email });
  return { id, email };
}
