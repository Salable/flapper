/**
 * Offerings as entitlements, not billing. A user's tier says what they can
 * exercise right now; changing tier is a row update and must never destroy
 * data - Plus structures go dormant on downgrade, they do not disappear.
 */

export const TIERS = Object.freeze({
  standard: Object.freeze({
    maxBoards: 3,
    sharedQueues: false,
    scheduling: false,
  }),
  plus: Object.freeze({
    maxBoards: Infinity,
    sharedQueues: true,
    scheduling: true,
  }),
});

export function tierOf(user) {
  return TIERS[user?.tier] ? user.tier : 'standard';
}

/** @returns {boolean} whether the tier may exercise a boolean capability */
export function can(tier, capability) {
  return Boolean(TIERS[tierOf({ tier })]?.[capability]);
}

export function boardLimitFor(tier) {
  return TIERS[tierOf({ tier })].maxBoards;
}

/** The tier the database holds for a user; sessions may carry stale fields. */
export async function getUserTier(db, userId) {
  const { user } = await import('./schema.mjs');
  const { eq } = await import('drizzle-orm');
  const [row] = await db.select({ tier: user.tier }).from(user).where(eq(user.id, userId)).limit(1);
  return tierOf(row ?? {});
}
