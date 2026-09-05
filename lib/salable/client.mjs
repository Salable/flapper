/**
 * The only module that knows Salable's HTTP surface exists.
 *
 * Everything above this speaks in Flapper's words (see licence.mjs); this
 * translates. Two calls carry the whole commercial model:
 *
 *   - checkEntitlements  GET  /api/entitlements/check  - what may this account do
 *   - createFreeLicence  POST /api/subscriptions       - issue the free licence
 *
 * `fetchImpl` is injected, the way `getSession` is, so tests exercise the
 * real request shape against a stub rather than describing it.
 *
 * Verified against https://salable.app/openapi.yaml on 2026-09-02:
 *
 *   - `createSalableOnlySubscription` is `POST /api/subscriptions`, taking
 *     `{plans: [{planId, grantee}], owner}`. The guide at
 *     salable.app/docs/subscriptions-and-billing says the dashboard is the
 *     only way to make one; the spec disagrees and the spec is what the
 *     server runs. This is RFC "has to be true" 0, answered.
 *   - `isSalableOnly` appears on the *response*, never the request. A
 *     subscription is Salable-only because the plan it names carries no
 *     Stripe price, not because the caller asked for one. The RFC's Design 1
 *     wording ("calls POST /api/subscriptions with isSalableOnly") is wrong
 *     on that detail; the shape below is what the API accepts.
 *   - the entitlement check is a GET with `granteeId` in the query, not the
 *     `POST /api/entitlements/check` the RFC's Design 3 names.
 */

export const DEFAULT_API_BASE = 'https://salable.app/api';

/** How long a request may hang before we fall back rather than block a create. */
const DEFAULT_TIMEOUT_MS = 4000;

/**
 * Salable's coordinates, read once from the environment.
 *
 * No `SALABLE_API_KEY` is a supported state, not a misconfiguration: a fork
 * runs the whole product with no Salable account and no gate (see
 * `unlicensedAllowance` in licence.mjs). That is what keeps the open-source
 * copy a real product rather than a crippled demo.
 */
export function salableConfig(env = process.env) {
  const key = env.SALABLE_API_KEY?.trim() || '';
  const base = env.SALABLE_API_BASE?.trim() || DEFAULT_API_BASE;
  return Object.freeze({
    key: key || null,
    base: base.replace(/\/+$/, ''),
    freePlanId: env.SALABLE_FREE_PLAN_ID?.trim() || null,
  });
}

/** A Salable call that did not come back cleanly. Callers decide how to degrade. */
export class SalableError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'SalableError';
    this.salableStatus = status ?? null;
  }
}

export function salableClient({
  config = salableConfig(),
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  /** Whether this deployment has a Salable account behind it at all. */
  const configured = Boolean(config.key);

  async function call(method, path, { query, body } = {}) {
    if (!configured) throw new SalableError('SALABLE_API_KEY is not set', null);
    const url = new URL(`${config.base}${path}`);
    for (const [name, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, String(value));
    }
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: {
          authorization: `Bearer ${config.key}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new SalableError(`salable ${method} ${path} did not answer: ${error.message}`, null);
    }
    if (!response.ok) {
      throw new SalableError(`salable ${method} ${path} answered ${response.status}`, response.status);
    }
    return response.json();
  }

  return Object.freeze({
    configured,
    freePlanId: config.freePlanId,

    /**
     * What this grantee may do right now.
     *
     * A 404 means the grantee has never existed - nobody has issued them a
     * licence - which is different from an existing grantee with nothing
     * active (a 200 with an empty list). Both come back as an empty list
     * here because Flapper treats them the same: no entitlements.
     */
    async checkEntitlements({ granteeId, owner } = {}) {
      if (!granteeId) throw new SalableError('checkEntitlements needs a granteeId', null);
      let payload;
      try {
        payload = await call('GET', '/entitlements/check', { query: { granteeId, owner } });
      } catch (error) {
        if (error.salableStatus === 404) return { values: [], expiryDate: null };
        throw error;
      }
      const entitlements = payload?.data?.entitlements ?? [];
      return {
        values: entitlements.map((entry) => entry?.value).filter((value) => typeof value === 'string'),
        // The furthest-future period end across the account's subscriptions;
        // null on a perpetual one, which the free licence is.
        expiryDate: entitlements.find((entry) => entry?.expiryDate)?.expiryDate ?? null,
      };
    },

    /**
     * Issue the free licence: a perpetual Salable Only Subscription on the
     * free plan, with the account as both Owner and Grantee.
     *
     * Perpetual because a free licence that expires is a support ticket, and
     * because free-to-paid is then a change of plan and nothing else.
     */
    async createFreeLicence({ granteeId, owner = granteeId } = {}) {
      if (!granteeId) throw new SalableError('createFreeLicence needs a granteeId', null);
      if (!config.freePlanId) throw new SalableError('SALABLE_FREE_PLAN_ID is not set', null);
      const payload = await call('POST', '/subscriptions', {
        body: {
          plans: [{ planId: config.freePlanId, grantee: granteeId }],
          owner,
          isPerpetual: true,
        },
      });
      return payload?.data ?? payload ?? null;
    },
  });
}
