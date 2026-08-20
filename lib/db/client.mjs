/**
 * The one place a database is chosen, mirroring lib/broker/index.mjs.
 *
 * DATABASE_URL set -> Neon over HTTP. Otherwise PGlite persisted at ./.pglite
 * so `next dev` needs zero environment. Held on globalThis: dev-server
 * recompiles must not mint a second PGlite on the same data directory (two
 * instances corrupt it), and every route bundle shares one client.
 */

import * as schema from './schema.mjs';

async function makeDb() {
  if (process.env.DATABASE_URL) {
    const { drizzle } = await import('drizzle-orm/neon-http');
    return drizzle(process.env.DATABASE_URL, { schema });
  }
  console.warn('flapper: no DATABASE_URL - using a local PGlite database at ./.pglite');
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const client = new PGlite('./.pglite');
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: './drizzle' });
  return db;
}

export async function getDb() {
  if (!globalThis.__flapperDb) {
    // Stash the promise, not the db, so concurrent first requests share one
    // initialization instead of racing two PGlite instances into ./.pglite.
    globalThis.__flapperDb = makeDb();
  }
  return globalThis.__flapperDb;
}

export function _setDbForTests(db) {
  globalThis.__flapperDb = db === null ? undefined : Promise.resolve(db);
}
