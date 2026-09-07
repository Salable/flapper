#!/usr/bin/env node
/**
 * Read the get-in-touch queue, and mark one answered.
 *
 * The RFC's commitment is a reply within a day or two, by a person, until it
 * is more than a trickle. This is that person's inbox until there is a reason
 * to build a screen for it - oldest first, because the oldest is the one
 * closest to breaking the promise.
 *
 *   DATABASE_URL=… node tools/licence-requests.mjs
 *   DATABASE_URL=… node tools/licence-requests.mjs --handled <id>
 *
 * `--handled` means *replied to*, not *read*: the queue is only honest if the
 * flag says a human answered.
 */

import { getDb } from '../lib/db/client.mjs';
import { listOpenRequests, markHandled } from '../lib/db/licence-requests.mjs';
import { REQUESTABLE } from '../lib/salable/licence.mjs';
import { user } from '../lib/db/schema.mjs';
import { inArray } from 'drizzle-orm';

if (!process.env.DATABASE_URL) {
  // getDb falls back to the local PGlite, and PGlite allows one process per
  // directory: run this while `npm run dev` is up and it hangs on the lock
  // rather than failing. Said before the hang, not after.
  console.log('licence-requests: no DATABASE_URL - reading ./.pglite, so stop `npm run dev` first');
}

const db = await getDb();
const handled = process.argv.indexOf('--handled');

if (handled !== -1) {
  const id = process.argv[handled + 1];
  if (!id) {
    console.error('usage: --handled <request id>');
    process.exit(1);
  }
  const row = await markHandled(db, id);
  if (!row) {
    console.error(`no request with id ${id}`);
    process.exit(1);
  }
  console.log(`marked answered: ${REQUESTABLE[row.need] ?? row.need} (${id})`);
  process.exit(0);
}

const open = await listOpenRequests(db);
if (open.length === 0) {
  console.log('nothing waiting.');
  process.exit(0);
}

// One query for the addresses rather than one per row: the queue is small,
// but a loop of selects is a habit that stops being small.
const emails = new Map(
  (await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(inArray(user.id, [...new Set(open.map((row) => row.userId))]))
  ).map((row) => [row.id, row.email]),
);

const DAY_MS = 24 * 60 * 60 * 1000;
console.log(`${open.length} waiting, oldest first:\n`);
for (const ask of open) {
  const age = Math.floor((Date.now() - ask.createdAt) / DAY_MS);
  const overdue = age >= 2 ? '  ← OVERDUE' : '';
  console.log(`${ask.id}${overdue}`);
  console.log(`  needs   ${REQUESTABLE[ask.need] ?? ask.need}  (${ask.need})`);
  console.log(`  from    ${ask.contact ?? emails.get(ask.userId) ?? ask.userId}`);
  console.log(`  waited  ${age === 0 ? 'today' : `${age} day${age === 1 ? '' : 's'}`}`);
  console.log(`  said    ${ask.message.replace(/\n+/g, ' ')}\n`);
}

// PGlite keeps the event loop alive, so say we are done rather than hanging
// on a database nobody is waiting for.
process.exit(0);
