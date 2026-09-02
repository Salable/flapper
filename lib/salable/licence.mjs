/**
 * What an account may do, in Flapper's words.
 *
 * Salable holds the answer; Flapper holds only the question. This module is
 * the question, and the vocabulary the two sides agree on. Nothing above it
 * knows there is an HTTP call underneath, and nothing in it knows Salable's
 * endpoints - that is client.mjs.
 *
 * The vocabulary is entitlement *values*, configured on plans in the Salable
 * dashboard:
 *
 *   board.create             may create a board at all - the free licence
 *   boards:<n>               how many, e.g. `boards:1`; `boards:unlimited`
 *   board.type.<typeId>      a board type that is not free, e.g.
 *                            `board.type.scheduled`, `board.type.shared`
 *   board.private            may make a board private
 *
 * A cap rides inside the value because the check response carries only
 * `{type, value, expiryDate}` - there is no quantity to read. `boards:1` is
 * therefore one entitlement value, not an entitlement with a number attached.
 *
 * Three states, and the difference between them matters:
 *
 *   unlicensed  no SALABLE_API_KEY. Everything, unlimited. A fork of this
 *               repo is a whole product with no Salable account, which is the
 *               point of it being open.
 *   licensed    Salable answered, or answered recently enough to reuse.
 *   degraded    Salable is configured but unreachable and nothing is cached.
 *               Falls back to the free allowance: never blocks a create, and
 *               never hands out what nobody paid for. The repo rule is
 *               degrade, never break (AGENTS.md); the money rule is that an
 *               outage must not be a discount.
 */

import { salableClient, SalableError } from './client.mjs';

export const ENTITLEMENTS = Object.freeze({
  createBoard: 'board.create',
  privateBoard: 'board.private',
});

/** The value a board type names when it is not free. */
export function boardTypeEntitlement(typeId) {
  return `board.type.${typeId}`;
}

/**
 * The board type everyone gets. Named here rather than on the definition
 * because "which type is free" is a commercial decision, not a property of
 * the type - and a new type added by a fork should not silently be free.
 */
const FREE_BOARD_TYPE = 'live';

/**
 * One board, live queue, public. Neal's call, 2026-09-02: "you give everyone
 * one board, and if they come and ask us for it we cut them a cheap license"
 * - narrower than the RFC's "a few". This constant is only the shape of the
 * free plan and the outage fallback; the free plan in Salable is what
 * actually grants it, and changing the number there changes it in production
 * without a deploy.
 */
export const FREE_ALLOWANCE = Object.freeze({
  licensed: true,
  maxBoards: 1,
  types: Object.freeze([FREE_BOARD_TYPE]),
  privateBoards: false,
});

function unlicensedAllowance() {
  return Object.freeze({
    licensed: true,
    maxBoards: Infinity,
    types: null, // null means every type this build has
    privateBoards: true,
    source: 'unlicensed',
  });
}

function freeAllowance(source) {
  return Object.freeze({ ...FREE_ALLOWANCE, source });
}

/** No licence at all: signed up, but nothing granted. Creates are refused. */
function unlicensedAccount(source) {
  return Object.freeze({
    licensed: false,
    maxBoards: 0,
    types: Object.freeze([]),
    privateBoards: false,
    source,
  });
}

const BOARD_CAP = /^boards:(\d+|unlimited)$/;

/**
 * Entitlement values in, an allowance out. Pure, so the whole commercial
 * model is testable without a network or a database.
 */
export function allowanceFrom(values, source = 'salable') {
  const held = new Set(values ?? []);
  if (!held.has(ENTITLEMENTS.createBoard)) return unlicensedAccount(source);
  let maxBoards = 0;
  for (const value of held) {
    const cap = BOARD_CAP.exec(value);
    if (!cap) continue;
    // Several plans can grant a cap; the most generous wins, the way
    // Salable returns the furthest-future expiry for a repeated entitlement.
    const n = cap[1] === 'unlimited' ? Infinity : Number(cap[1]);
    if (n > maxBoards) maxBoards = n;
  }
  // A plan that grants board.create and forgets a cap still gets one board,
  // rather than a licence that entitles nothing.
  if (maxBoards === 0) maxBoards = FREE_ALLOWANCE.maxBoards;
  const types = [FREE_BOARD_TYPE];
  for (const value of held) {
    if (value.startsWith('board.type.')) {
      const typeId = value.slice('board.type.'.length);
      if (typeId && !types.includes(typeId)) types.push(typeId);
    }
  }
  return Object.freeze({
    licensed: true,
    maxBoards,
    types: Object.freeze(types),
    privateBoards: held.has(ENTITLEMENTS.privateBoard),
    source,
  });
}

/* ---- asking, with a short memory ---- */

const DEFAULT_TTL_MS = 60_000;

/**
 * A per-process cache, which on Vercel means per warm function instance and
 * a minute at most. Enough to stop a dashboard render fanning out into a
 * dozen identical checks; short enough that a plan change lands promptly.
 * Salable's own guidance is to cache and to verify the response signature
 * for longer horizons - that is chunk 3's work, alongside the webhooks, and
 * this is deliberately the simple version until then.
 */
export function licenceReader({
  client = salableClient(),
  ttlMs = Number(process.env.SALABLE_ENTITLEMENT_TTL_MS) || DEFAULT_TTL_MS,
  now = () => Date.now(),
} = {}) {
  const cache = new Map();

  async function allowanceFor(userId) {
    if (!client.configured) return unlicensedAllowance();
    if (!userId) return unlicensedAccount('no-account');
    const remembered = cache.get(userId);
    if (remembered && now() - remembered.at < ttlMs) {
      return remembered.allowance;
    }
    try {
      const { values } = await client.checkEntitlements({ granteeId: userId, owner: userId });
      const allowance = allowanceFrom(values);
      cache.set(userId, { allowance, at: now() });
      return allowance;
    } catch (error) {
      if (!(error instanceof SalableError)) throw error;
      // Stale beats absent: an answer from four minutes ago is a truer
      // picture of what this account bought than the free plan is.
      if (remembered) {
        console.error(`flapper: salable unreachable, reusing a stale allowance - ${error.message}`);
        return Object.freeze({ ...remembered.allowance, source: 'stale' });
      }
      console.error(`flapper: salable unreachable, falling back to free - ${error.message}`);
      return freeAllowance('fallback');
    }
  }

  return Object.freeze({
    configured: client.configured,
    allowanceFor,
    /** After a plan changes, the next read must not answer from a minute ago. */
    forget(userId) {
      cache.delete(userId);
    },
  });
}

/**
 * The process-wide reader, so the entitlement cache is genuinely shared: a
 * server component rendering the catalogue and the handler the resulting
 * click reaches ask the same question, and only one of them pays for it.
 */
let shared = null;
export function sharedLicence() {
  shared ??= licenceReader();
  return shared;
}

/** What this account may do. The one call a server component needs. */
export function accountAllowance(userId) {
  return sharedLicence().allowanceFor(userId);
}

/**
 * Which of this build's board types this account may not create. Server
 * components render a card as locked from this; the gate itself is in
 * createBoard, because a greyed-out card is decoration.
 */
export function lockedTypeIds(allowance, types) {
  if (!allowance?.types) return new Set();
  return new Set([...types].filter((type) => type.entitlement && !allowance.types.includes(type.id)).map((t) => t.id));
}

/**
 * Issue the free licence for a new account, best-effort.
 *
 * Sign-up must not fail because Salable is down - an account with no licence
 * still signs in, still sees its dashboard, and gets its licence from the
 * backfill (tools/backfill-licences.mjs). Returns whether it landed, which
 * is what the caller logs.
 */
export async function issueFreeLicence(userId, { client = salableClient() } = {}) {
  if (!client.configured || !client.freePlanId) return false;
  try {
    await client.createFreeLicence({ granteeId: userId, owner: userId });
    return true;
  } catch (error) {
    console.error(`flapper: free licence for ${userId} skipped - ${error.message}`);
    return false;
  }
}
