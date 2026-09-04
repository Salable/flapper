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
 *   board_create             may create a board at all - the free licence
 *   boards_many              a working number of boards rather than one
 *   boards_unlimited         no cap
 *   board_type_<typeId>      a board type that is not free, e.g.
 *                            board_type_scheduled, board_type_shared
 *   board_private            may make a board private
 *   board_no_watermark       drops the "Made with Flapper" bar a free
 *                            board otherwise carries
 *
 * **Salable entitlement names match `^[a-z_]+$`** - lowercase letters and
 * underscores, no dots, no digits (`createEntitlement` in
 * https://salable.app/openapi.yaml). NAME is that rule, and
 * tests/salable.test.mjs holds every name in this file to it - which is the
 * only way to find out, short of a plan somebody cannot create in the
 * dashboard six weeks later.
 *
 * That rule costs us something worth naming. The first cut of this file used
 * `boards:1` / `boards:25` / `boards:unlimited`, so the *number* lived on the
 * plan and changing it was a dashboard edit. No digits means that is not
 * possible: an entitlement is a boolean, and there is nothing in the check
 * response to hang a quantity on (`{type, value, expiryDate}` - and `type`
 * can be `meter`, but still with no number). So the cap is a named tier
 * instead, and BOARD_TIERS below is Flapper deciding what each tier means.
 *
 * Salable still decides *which* tier an account is on, which is the part that
 * has to be a commercial decision rather than a deploy. But "how many is
 * many" is now a constant in here, and that is a step back from Salable holds
 * the answer. It is a gap in Salable worth filing, not a design we chose.
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

/** What Salable will accept as an entitlement name. */
export const NAME = /^[a-z_]+$/;

export const ENTITLEMENTS = Object.freeze({
  createBoard: 'board_create',
  privateBoard: 'board_private',
  noWatermark: 'board_no_watermark',
});

/**
 * The caps, most generous last. A licence holding none of these gets one
 * board - the free plan grants `board_create` alone.
 */
export const BOARD_TIERS = Object.freeze([
  ['boards_many', 25],
  ['boards_unlimited', Infinity],
]);

/**
 * The things somebody can ask us for, and the words we ask them back in.
 *
 * Deliberately a closed list. A refusal that says "get in touch" and then
 * takes free text about what you wanted is a support ticket; a refusal that
 * knows which of four things you hit is a lead with a plan attached, and the
 * bespoke plan is assembled from exactly these. `label` is what the person
 * sees; the key is what the 402 carries as `need`.
 */
export const REQUESTABLE = Object.freeze({
  boards: 'More boards',
  board_type_scheduled: 'Scheduled boards',
  board_type_shared: 'Shared screens',
  board_private: 'Private boards',
  queue_slots: 'More slides per board',
  other: 'Something else',
});

/** Where a refusal sends a person. `need` prefills the form. */
export function getInTouchUrl(need) {
  return `/account/licence?need=${encodeURIComponent(need)}`;
}

/**
 * The value a board type names when it is not free.
 *
 * A type id may contain digits and hyphens (`[a-z][a-z0-9-]*` in the type
 * contract) and an entitlement name may not, so this is a translation and not
 * a concatenation. A type whose id is all digits after the first letter has
 * no legal name and says so rather than producing one Salable will refuse.
 */
export function boardTypeEntitlement(typeId) {
  const slug = String(typeId).replace(/-/g, '_').replace(/[0-9]/g, '');
  const name = `board_type_${slug}`;
  // `board_type_` on its own is legal by the pattern and useless as a name,
  // so the emptiness is checked rather than the shape.
  if (slug === '' || !NAME.test(name)) {
    throw new Error(`board type "${typeId}" has no legal Salable entitlement name`);
  }
  return name;
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
  // Free boards carry Flapper's own watermark; a bespoke plan can drop it.
  watermark: true,
  // Dan's call, 2026-09-04: three slides on a free board, up from a live
  // board's own default of one. A board type's own queueCap range (1-50,
  // lib/board-types/live/definition.mjs) still applies on top of this -
  // this is the licence's ceiling, not a replacement for the type's own.
  maxQueueItems: 3,
});

function unlicensedAllowance() {
  return Object.freeze({
    licensed: true,
    maxBoards: Infinity,
    types: null, // null means every type this build has
    privateBoards: true,
    // A fork is a whole product with no Salable account (see the module
    // doc above) - forcing Flapper's own branding onto somebody else's
    // deploy would contradict that, so unlicensed carries none.
    watermark: false,
    // No extra ceiling beyond whatever the board type itself allows.
    maxQueueItems: Infinity,
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
    // Degrade toward showing it, not away from it - the same "never hand out
    // what nobody paid for" rule degraded/unknown states already follow.
    watermark: true,
    maxQueueItems: FREE_ALLOWANCE.maxQueueItems,
    source,
  });
}


/**
 * Entitlement values in, an allowance out. Pure, so the whole commercial
 * model is testable without a network or a database.
 */
export function allowanceFrom(values, source = 'salable') {
  const held = new Set(values ?? []);
  if (!held.has(ENTITLEMENTS.createBoard)) return unlicensedAccount(source);
  // Several plans can grant a cap; the most generous wins, the way Salable
  // returns the furthest-future expiry for a repeated entitlement. A licence
  // holding none of them still gets the free one board, rather than being a
  // licence that entitles nothing.
  let maxBoards = FREE_ALLOWANCE.maxBoards;
  for (const [name, cap] of BOARD_TIERS) {
    if (held.has(name) && cap > maxBoards) maxBoards = cap;
  }
  const types = [FREE_BOARD_TYPE];
  for (const value of held) {
    if (value.startsWith('board_type_')) {
      const typeId = value.slice('board_type_'.length);
      if (typeId && !types.includes(typeId)) types.push(typeId);
    }
  }
  return Object.freeze({
    licensed: true,
    maxBoards,
    types: Object.freeze(types),
    privateBoards: held.has(ENTITLEMENTS.privateBoard),
    watermark: !held.has(ENTITLEMENTS.noWatermark),
    // Tied to the board-count tier rather than its own entitlement for now:
    // anyone granted more boards than the free plan is a paid account, and
    // a paid account gets the board type's own queueCap range (1-50)
    // rather than the free ceiling. Worth its own board_queue_many
    // entitlement if a plan ever needs to set the two independently.
    maxQueueItems: maxBoards > FREE_ALLOWANCE.maxBoards ? Infinity : FREE_ALLOWANCE.maxQueueItems,
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
