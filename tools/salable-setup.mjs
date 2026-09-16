#!/usr/bin/env node
/**
 * Set Flapper up in Salable: the entitlements, the Product, and the free
 * plan. What the dashboard would take twenty clicks to do, done once, the
 * same way every time, and re-runnable.
 *
 *   # put the key somewhere the repo will not commit
 *   echo 'SALABLE_API_KEY=<test-mode SECRET key>' >> .env.local
 *   node tools/salable-setup.mjs --dry-run     # say what it would do
 *   node tools/salable-setup.mjs               # do it
 *
 * Use a **test-mode secret** key. Not publishable - every call below is a
 * write, and publishable is documented as read-only-ish (entitlement checks).
 * And test mode, because Live Mode is RFC chunk 6 and a deliberate decision,
 * not something a setup script should slip you into.
 *
 * Idempotent: it lists before it creates, so anything already there is left
 * alone and re-running is safe. It prints the two env vars to set at the end,
 * which is the only manual step left.
 *
 * Shapes verified against https://salable.app/openapi.yaml on 2026-09-02:
 * `createEntitlement` POST /api/entitlements {name}; `createProduct` POST
 * /api/products {name}; `savePlan` POST /api/plans/save {productId, name,
 * entitlements, lineItems}. `createPlan` on POST /api/plans takes no product
 * and no entitlements, so it is not the one - `savePlan` is what the
 * dashboard's own form must be calling.
 */

import { readFileSync } from 'node:fs';
import { BOARD_TIERS, ENTITLEMENTS, NAME } from '../lib/salable/licence.mjs';
import { BOARD_TYPES } from '../lib/board-types/index.mjs';
import { DEFAULT_API_BASE } from '../lib/salable/client.mjs';

const dryRun = process.argv.includes('--dry-run');
const PRODUCT_NAME = process.env.SALABLE_PRODUCT_NAME || 'Flapper';
const FREE_PLAN_NAME = process.env.SALABLE_FREE_PLAN_NAME || 'Free';

/** The key, from the environment or from .env.local - never from a flag. */
function apiKey() {
  if (process.env.SALABLE_API_KEY) return process.env.SALABLE_API_KEY.trim();
  try {
    const line = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
      .split('\n')
      .find((l) => l.startsWith('SALABLE_API_KEY='));
    if (line) return line.slice('SALABLE_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
  } catch {
    /* no .env.local; fall through to the message below */
  }
  console.error(
    'salable-setup: no SALABLE_API_KEY.\n' +
      "  echo 'SALABLE_API_KEY=<test-mode SECRET key>' >> .env.local\n" +
      '  (.env*.local is gitignored, so the key stays out of the repo)',
  );
  process.exit(1);
}

const KEY = apiKey();
const BASE = (process.env.SALABLE_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');

/*
 * A publishable key cannot do any of this. Salable has three kinds -
 * publishable, secret and restricted (`type` on an api key in openapi.yaml) -
 * and the publishable one is documented as "limited access to public
 * endpoints like entitlement checks". Everything below is a write.
 *
 * Not enforced by prefix, because no prefix is documented anywhere and
 * guessing `sk_` would reject a perfectly good key. A wrong kind of key
 * fails on the first call with a 401 or a 403, which says it better than a
 * regex would.
 */
if (/publishable|^pk_/i.test(KEY)) {
  console.error('salable-setup: that looks like a publishable key. Every call below is a write - use the secret key.');
  process.exit(1);
}

async function call(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${KEY}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  if (!response.ok) {
    const detail = parsed?.error ?? parsed?.message ?? text.slice(0, 300);
    throw Object.assign(new Error(`${method} ${path} -> ${response.status}: ${detail}`), {
      status: response.status,
    });
  }
  return parsed;
}

/** Salable wraps collections as {data: [...]} on some endpoints and not others. */
const rows = (payload) => payload?.data ?? payload?.items ?? (Array.isArray(payload) ? payload : []);
const idOf = (row) => row?.uuid ?? row?.id ?? null;

/* ---- what Flapper needs to exist ---- */

const WANTED = [
  ENTITLEMENTS.createBoard,
  ENTITLEMENTS.privateBoard,
  ...BOARD_TIERS.map(([name]) => name),
  ...[...BOARD_TYPES.values()].map((type) => type.entitlement).filter(Boolean),
];

for (const name of WANTED) {
  if (!NAME.test(name)) {
    console.error(`salable-setup: "${name}" is not a legal entitlement name - fix licence.mjs first`);
    process.exit(1);
  }
}

console.log(`salable-setup: ${BASE}${dryRun ? '  (dry run - nothing will be created)' : ''}`);

/* ---- 1. entitlements ---- */

const existingEntitlements = rows(await call('GET', '/entitlements'));
const byName = new Map(existingEntitlements.map((row) => [row.name, row]));
const entitlementIds = new Map();

for (const name of WANTED) {
  const found = byName.get(name);
  if (found) {
    entitlementIds.set(name, idOf(found));
    console.log(`  entitlement ${name.padEnd(24)} already there`);
    continue;
  }
  if (dryRun) {
    console.log(`  entitlement ${name.padEnd(24)} would create`);
    continue;
  }
  const created = await call('POST', '/entitlements', { name });
  entitlementIds.set(name, idOf(created?.data ?? created));
  console.log(`  entitlement ${name.padEnd(24)} created`);
}

/* ---- 2. the product ---- */

const products = rows(await call('GET', '/products'));
let product = products.find((row) => row.name === PRODUCT_NAME);
if (product) {
  console.log(`  product     ${PRODUCT_NAME.padEnd(24)} already there`);
} else if (dryRun) {
  console.log(`  product     ${PRODUCT_NAME.padEnd(24)} would create`);
} else {
  product = (await call('POST', '/products', { name: PRODUCT_NAME, isActive: true }));
  product = product?.data ?? product;
  console.log(`  product     ${PRODUCT_NAME.padEnd(24)} created`);
}

/* ---- 3. the free plan ---- */

/*
 * A free plan still needs a line item.
 *
 * The first version of this sent `lineItems: []`, on the reasoning that a
 * plan is free because there is nothing attached to charge for. The plan
 * saved happily and then `POST /api/subscriptions` refused it: *"Some plans
 * were invalid: Plan is missing line items"*. A plan with nothing on it
 * cannot be subscribed to at all, Salable Only or otherwise.
 *
 * What makes it free is the line item having **no prices**, not the plan
 * having no line items. One flat-rate, one-off item, `prices: []`, quantity
 * pinned to 1. Salable still mints a Stripe product for it and no price, so
 * nothing can ever be charged.
 *
 * `tiersMode: null` and `minQuantity` are both required, though the spec
 * gives them defaults and marks them optional. The API says so plainly when
 * they are missing, which is more than the spec does.
 *
 * Perpetual, because a free licence that expires is a support ticket.
 */
const FREE_LINE_ITEM = Object.freeze({
  name: 'Boards',
  slug: 'boards',
  priceType: 'flat_rate',
  intervalType: 'one_off',
  billingScheme: 'fixed',
  tiersMode: null,
  minQuantity: 1,
  maxQuantity: 1,
  prices: [],
});

/**
 * `entitlements` is an `array of string` and the spec does not say whether it
 * means ids or names. Ids are what works - confirmed against the real API on
 * 2026-09-02 - and the name fallback stays for the day that changes.
 */
async function saveFreePlan(productId, entitlements) {
  return call('POST', '/plans/save', {
    productId,
    name: FREE_PLAN_NAME,
    entitlements,
    isActive: true,
    isPerpetual: true,
    lineItems: [FREE_LINE_ITEM],
  });
}

if (dryRun) {
  console.log(
    `  plan        ${FREE_PLAN_NAME.padEnd(24)} would create, granting ${ENTITLEMENTS.createBoard},` +
      ' with one line item and no prices',
  );
  console.log('\nsalable-setup: dry run only. Re-run without --dry-run to create it.');
  process.exit(0);
}

const plans = rows(await call('GET', '/plans'));
let plan = plans.find((row) => row.name === FREE_PLAN_NAME && (row.productUuid ?? row.productId) === idOf(product));

/*
 * Created if absent, left alone if not.
 *
 * Re-saving an existing plan to bring it in line was the obvious idea and it
 * does not work: savePlan refuses a line item whose slug is already in use
 * unless the item's own id comes with it, so a "repair" needs to read the
 * plan's line items back and thread their ids through. Not worth the
 * machinery. The probe below is the safety net instead - it tells you a plan
 * is broken, and a person fixes it, which is the right division of labour for
 * something that happens once.
 */
if (plan) {
  console.log(`  plan        ${FREE_PLAN_NAME.padEnd(24)} already there (left alone; the probe below checks it)`);
} else {
  const freeGrant = [ENTITLEMENTS.createBoard];
  const asIds = freeGrant.map((name) => entitlementIds.get(name)).filter(Boolean);
  try {
    plan = await saveFreePlan(idOf(product), asIds);
    console.log(`  plan        ${FREE_PLAN_NAME.padEnd(24)} created`);
  } catch (error) {
    if (error.status !== 400) throw error;
    plan = await saveFreePlan(idOf(product), freeGrant);
    console.log(`  plan        ${FREE_PLAN_NAME.padEnd(24)} created (entitlements as NAMES - ids were refused)`);
    console.log('  ^ worth the handover log: ids worked on 2026-09-02, so something changed.');
  }
  plan = plan?.data ?? plan;
}

/* ---- 4. prove a licence can actually be issued on it ---- */

/*
 * The whole point of the plan is that sign-up can subscribe somebody to it,
 * and "the plan saved" does not prove that - the missing-line-items refusal
 * came from here, not from saving. So the script issues one against a
 * throwaway grantee and reads the entitlement back. Better to fail in a
 * setup script than at somebody's first sign-up.
 */
const planId = idOf(plan);
if (planId) {
  const probe = `setup_probe_${Date.now()}`;
  try {
    const sub = await call('POST', '/subscriptions', {
      plans: [{ planId, grantee: probe }],
      owner: probe,
      isPerpetual: true,
    });
    const row = sub?.data ?? sub;
    const check = await call('GET', `/entitlements/check?granteeId=${probe}&owner=${probe}`);
    const granted = (check?.data?.entitlements ?? []).map((e) => e.value);
    console.log(
      `  probe       ${'licence issued'.padEnd(24)} isSalableOnly=${row?.isSalableOnly}, grants ${granted.join(', ') || 'NOTHING'}`,
    );
    if (!granted.includes(ENTITLEMENTS.createBoard)) {
      console.error(
        `\nsalable-setup: the plan issued a licence that does not grant ${ENTITLEMENTS.createBoard}.` +
          '\n  Nobody will be able to create a board. Check the plan in the dashboard.',
      );
      process.exit(1);
    }
  } catch (error) {
    console.error(`\nsalable-setup: the plan exists but cannot be subscribed to - ${error.message}`);
    console.error(
      '  Sign-up would fail the same way, so fix this before setting the env vars.\n' +
        '  "Plan is missing line items" is the one to expect: a free plan still needs one\n' +
        `  line item, with no prices on it. Add one to "${FREE_PLAN_NAME}" in the dashboard,\n` +
        '  or delete the plan and re-run this.',
    );
    process.exit(1);
  }
}

/* ---- what is left for a person ---- */
console.log(`
salable-setup: done.

Set these two on Vercel (and in .env.local to run it here):

  SALABLE_API_KEY=${KEY.slice(0, 10)}…            (the key you gave this script)
  SALABLE_FREE_PLAN_ID=${planId ?? '<could not read the plan id - find it in the dashboard>'}

Redeploy, then walk it: sign up, create a board, try a second. The second
should come back 402 pointing at /account/licence.

The paid entitlements exist but are on no plan - that is deliberate. A
bespoke sale is a clone of this plan with ${BOARD_TIERS.map(([n]) => n).join(' or ')}
added, plus whichever board types were asked for. See docs/MONETIZATION.md.`);
