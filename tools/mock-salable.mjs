#!/usr/bin/env node
/**
 * A stand-in for salable.app: the two endpoints Flapper calls, and nothing
 * else.
 *
 * Point the app at it and the licensed build runs locally, gate and all,
 * with no Salable account:
 *
 *   node tools/mock-salable.mjs &
 *   SALABLE_API_KEY=sk_test_mock SALABLE_FREE_PLAN_ID=plan_free \
 *     SALABLE_API_BASE=http://localhost:4000/api npm run dev
 *
 * Then sign up, create a board, and try a second one. To walk the paid side
 * without a plan, hand the mock more entitlements and wait out the sixty
 * second cache (or restart dev):
 *
 *   curl -X POST 'http://localhost:4000/grant?values=board_create,boards_unlimited,board_type_scheduled,board_private'
 *
 * It is a walking aid, not a fake to test against - `tests/salable.test.mjs`
 * asserts the request shapes with a stub fetch, which is faster and does not
 * need a port. What this gives you is the app itself, refusing things.
 *
 * Verified against https://salable.app/openapi.yaml on 2026-09-02. If a real
 * Salable call ever disagrees with this file, the real one is right and this
 * one is stale - fix it here and say so in docs/MONETIZATION.md.
 */

import { createServer } from 'node:http';

const PORT = Number(process.env.PORT) || 4000;

/** Who has been issued a licence, by grantee. */
const licensed = new Set();
/** The catalogue, so tools/salable-setup.mjs can be driven end to end. */
const catalogue = [];
const products = [];
const plans = [];
let nextId = 1;
/** What a licensed grantee holds. The `/grant` knob rewrites this. */
let entitlements = ['board_create'];

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw === '' ? {} : JSON.parse(raw);
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const keyed = (req.headers.authorization ?? '').startsWith('Bearer ');
  console.log(`mock-salable: ${req.method} ${url.pathname}${url.search}${keyed ? '' : '  (NO KEY)'}`);

  // The real API refuses an unkeyed call, so the mock has to as well or a
  // missing SALABLE_API_KEY looks like it works.
  if (!keyed && url.pathname.startsWith('/api/')) {
    return send(res, 401, { error: 'no bearer key' });
  }

  if (req.method === 'GET' && url.pathname === '/api/entitlements/check') {
    const granteeId = url.searchParams.get('granteeId');
    if (!granteeId) return send(res, 400, { error: 'granteeId is required' });
    // A grantee nobody has licensed is a 404, not an empty list - the
    // difference is documented and Flapper handles both.
    if (!licensed.has(granteeId)) return send(res, 404, { error: 'grantee not found' });
    return send(res, 200, {
      type: 'object',
      data: {
        entitlements: entitlements.map((value) => ({ type: 'entitlement', value, expiryDate: null })),
        signature: 'mock-signature-not-verifiable',
      },
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/subscriptions') {
    const body = await readBody(req);
    const grantee = body?.plans?.[0]?.grantee;
    if (!grantee || !body.owner) return send(res, 400, { error: 'plans[].grantee and owner are required' });
    licensed.add(grantee);
    console.log(`mock-salable: licensed ${grantee} on ${body.plans[0].planId}`);
    return send(res, 201, {
      data: { uuid: `sub_${licensed.size}`, isSalableOnly: true, ...body },
    });
  }

  /*
   * The catalogue endpoints, enough to drive tools/salable-setup.mjs. Held to
   * the spec's rules where the rules are the point: an entitlement name must
   * match ^[a-z_]+$, and a plan must name a product. Getting those wrong is
   * exactly the failure the script exists to avoid, so a mock that shrugged
   * at them would be worse than none.
   */
  if (url.pathname === '/api/entitlements' && req.method === 'GET') {
    return send(res, 200, { data: catalogue });
  }
  if (url.pathname === '/api/entitlements' && req.method === 'POST') {
    const { name } = await readBody(req);
    if (!/^[a-z_]+$/.test(name ?? '')) {
      return send(res, 400, { error: `name must match ^[a-z_]+$ (got "${name}")` });
    }
    const row = { uuid: `ent_${nextId++}`, name };
    catalogue.push(row);
    console.log(`mock-salable: entitlement ${name}`);
    return send(res, 201, { data: row });
  }
  if (url.pathname === '/api/products' && req.method === 'GET') {
    return send(res, 200, { data: products });
  }
  if (url.pathname === '/api/products' && req.method === 'POST') {
    const { name } = await readBody(req);
    if (!name) return send(res, 400, { error: 'name is required' });
    const row = { uuid: `prod_${nextId++}`, name };
    products.push(row);
    console.log(`mock-salable: product ${name}`);
    return send(res, 201, { data: row });
  }
  if (url.pathname === '/api/plans' && req.method === 'GET') {
    return send(res, 200, { data: plans });
  }
  if (url.pathname === '/api/plans/save' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.productId) return send(res, 400, { error: 'productId is required' });
    if (!body.name) return send(res, 400, { error: 'name is required' });
    // The mock accepts ids, which is what the script tries first. Flip this
    // to reject ids if you want to exercise the name fallback.
    const known = new Set(catalogue.map((e) => e.uuid));
    for (const ref of body.entitlements ?? []) {
      if (!known.has(ref)) return send(res, 400, { error: `unknown entitlement "${ref}"` });
    }
    const row = {
      uuid: `plan_${nextId++}`,
      name: body.name,
      productUuid: body.productId,
      isPerpetual: Boolean(body.isPerpetual),
      entitlements: body.entitlements ?? [],
      lineItems: body.lineItems ?? [],
    };
    plans.push(row);
    console.log(
      `mock-salable: plan ${row.name} (${row.uuid}) granting ${row.entitlements.length}, ${row.lineItems.length} line items`,
    );
    return send(res, 201, { data: row });
  }

  // Not Salable's API: the knob that makes the paid side walkable.
  if (req.method === 'POST' && url.pathname === '/grant') {
    entitlements = (url.searchParams.get('values') ?? '').split(',').filter(Boolean);
    console.log(`mock-salable: everyone licensed now holds ${entitlements.join(', ')}`);
    return send(res, 200, { entitlements });
  }

  send(res, 404, { error: `${req.method} ${url.pathname} is not in the mock` });
}).listen(PORT, () => {
  console.log(`mock-salable: listening on ${PORT}, granting ${entitlements.join(', ')}`);
});
