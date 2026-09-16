#!/usr/bin/env node
/**
 * Run drizzle migrations at build time, but only when a real database is
 * configured. Build-time beats cold-start: no races across serverless
 * instances, and a failed migration fails the deploy where someone sees it.
 * Local builds and CI have no DATABASE_URL and skip straight through
 * (PGlite migrates itself programmatically in lib/db/client.mjs).
 */

import { execFileSync } from 'node:child_process';

if (!process.env.DATABASE_URL) {
  console.log('migrate: no DATABASE_URL, skipping (PGlite migrates on boot)');
  process.exit(0);
}

console.log('migrate: applying drizzle migrations');
execFileSync('npx', ['drizzle-kit', 'migrate'], { stdio: 'inherit' });

/*
 * One-off data fixes, after the schema and in the same "someone is watching"
 * window. A schema migration is a file drizzle tracks; a data fix is a script
 * that knows when it has nothing to do, so the record of having run is the
 * data itself - every one of these is idempotent and a no-op on a database
 * that has already had it.
 *
 * Never fatal. A deploy must not fail because a tidy-up could not reach
 * Salable or found something odd in one row: the schema is what the new code
 * needs to boot, and this is not that. It says so loudly and the deploy goes
 * on.
 */
const { unpinBoards } = await import('./unpin-sign-queuecap.mjs');
const { getDb } = await import('../lib/db/client.mjs');
const { accountAllowance } = await import('../lib/salable/licence.mjs');
const { salableClient } = await import('../lib/salable/client.mjs');

try {
  if (!salableClient().configured) {
    // Without a key every account reads as free, and a paid owner's board
    // would land on three instead of five. Skipped rather than guessed.
    console.log('migrate: unpin-sign-queuecap skipped - no SALABLE_API_KEY to read licences with');
  } else {
    const { lifted } = await unpinBoards(await getDb(), { allowanceOf: accountAllowance, apply: true });
    console.log(
      lifted.length === 0
        ? 'migrate: unpin-sign-queuecap - nothing to lift'
        : `migrate: unpin-sign-queuecap lifted ${lifted.length} board(s): ${lifted
            .map((row) => `${row.slug} ${row.from}->${row.to}`)
            .join(', ')}`,
    );
  }
} catch (error) {
  console.warn(`migrate: unpin-sign-queuecap did not run - ${error.message}`);
}
