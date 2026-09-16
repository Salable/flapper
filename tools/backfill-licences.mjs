#!/usr/bin/env node
/**
 * Issue the free licence to every account that predates it.
 *
 * Run once before the gate goes live, and again whenever a signup's
 * best-effort licence call was the one that failed. Nobody loses anything:
 * existing accounts keep the boards they have, and an account already over
 * the free allowance is frozen where it is - it can still drive, rename and
 * delete its boards, it just cannot make another until someone buys more.
 * That is the RFC's "keep what they have, frozen where it exceeds free".
 *
 *   SALABLE_API_KEY=... SALABLE_FREE_PLAN_ID=... \
 *   DATABASE_URL=... node tools/backfill-licences.mjs [--dry-run]
 *
 * Idempotent in the way that matters: an account that already holds
 * board.create is skipped, so re-running never issues a second subscription.
 */

import { salableClient } from '../lib/salable/client.mjs';
import { ENTITLEMENTS } from '../lib/salable/licence.mjs';
import { getDb } from '../lib/db/client.mjs';
import { user } from '../lib/db/schema.mjs';

const dryRun = process.argv.includes('--dry-run');
const client = salableClient();

if (!client.configured) {
  console.error('backfill: SALABLE_API_KEY is not set - nothing to issue against');
  process.exit(1);
}
if (!client.freePlanId) {
  console.error('backfill: SALABLE_FREE_PLAN_ID is not set - which plan is the free one?');
  process.exit(1);
}

const db = await getDb();
const accounts = await db.select({ id: user.id, email: user.email }).from(user);
console.log(`backfill: ${accounts.length} account(s)${dryRun ? ' (dry run)' : ''}`);

let issued = 0;
let held = 0;
let failed = 0;

for (const account of accounts) {
  let existing;
  try {
    existing = await client.checkEntitlements({ granteeId: account.id, owner: account.id });
  } catch (error) {
    // A read that fails is not a reason to issue a duplicate subscription.
    console.error(`backfill: ${account.email} skipped - could not read entitlements: ${error.message}`);
    failed += 1;
    continue;
  }
  if (existing.values.includes(ENTITLEMENTS.createBoard)) {
    held += 1;
    continue;
  }
  if (dryRun) {
    console.log(`backfill: would issue to ${account.email}`);
    issued += 1;
    continue;
  }
  try {
    await client.createFreeLicence({ granteeId: account.id, owner: account.id });
    console.log(`backfill: issued to ${account.email}`);
    issued += 1;
  } catch (error) {
    console.error(`backfill: ${account.email} FAILED - ${error.message}`);
    failed += 1;
  }
}

console.log(`backfill: ${issued} issued, ${held} already licensed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
