/**
 * Everything the documentation points at has to exist.
 *
 * Not whether the prose is *good* - whether it is *true* about this tree. A
 * doc that names a file, a function, an env var or another doc is making a
 * checkable claim, and a stale one is worse than no claim at all: an agent
 * reads CLAUDE.md and does what it says.
 *
 * Written after a manual pass found six untrue things, one of which was
 * CLAUDE.md telling agents to inject tests with `_setDbForTests` and
 * `_setBrokerForTests`. Neither has ever existed. Nothing failed, because
 * nothing was checking.
 *
 * Complements doc-truth.test.mjs, which checks that the *examples* a doc
 * gives are ones the server accepts. This checks that the *references* a doc
 * makes resolve.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function walk(dir, skip = /^(\.git|node_modules|\.next|\.pglite)$/) {
  const out = [];
  for (const name of readdirSync(path.join(ROOT, dir))) {
    if (skip.test(name)) continue;
    // The top-level attic/ is parked code, deliberately not part of the
    // corpus. docs/attic/ is a live note *about* it and stays in.
    if (dir === '.' && name === 'attic') continue;
    const rel = path.join(dir, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) out.push(...walk(rel, skip));
    else out.push(rel);
  }
  return out;
}

const TREE = walk('.').map((p) => p.replace(/^\.\//, ''));
const BY_BASENAME = new Map();
for (const p of TREE) {
  const base = path.basename(p);
  if (!BY_BASENAME.has(base)) BY_BASENAME.set(base, []);
  BY_BASENAME.get(base).push(p);
}

/** The prose docs, which are the ones making claims about the code. */
const DOCS = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'SPEC.md',
  ...TREE.filter((p) => p.startsWith('docs/') && p.endsWith('.md')),
];

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const ticks = (text) => [...text.matchAll(/`([^`\n]{2,80})`/g)].map((m) => m[1].trim());

/**
 * Docs that describe what a file *used* to be are allowed to name files that
 * are gone - that is the whole job of an attic note or a research record.
 */
const HISTORICAL = /^(docs\/attic\/|docs\/RENDERER-RESEARCH\.md|docs\/rfcs\/)/;

/** One code corpus, read once: every file a doc could reasonably point into. */
const CODE_SUFFIXES = new Set(['.mjs', '.js', '.ts', '.tsx', '.css', '.json', '.py', '.sql']);
const SELF = 'tests/doc-references.test.mjs';
const CODE = TREE.filter(
  // This file names the very identifiers it is checking for - the comments
  // are about them. Reading itself would make every check self-satisfying.
  (p) => CODE_SUFFIXES.has(path.extname(p)) && !p.startsWith('docs/') && p !== SELF,
)
  .map((p) => read(p))
  .join('\n');

const mentions = (name) =>
  new RegExp(`(?<![A-Za-z0-9_$])${name.replace(/\$/g, '\\$')}(?![A-Za-z0-9_$])`).test(CODE);

/* ---- 1. files ---- */

const FILE_RE = /^[A-Za-z0-9_.\-/]+\.(mjs|js|ts|tsx|css|json|md|py|sql|yml|yaml|svg|gif)$/;

/**
 * Paths a doc names deliberately because they are *absent*, or because they
 * belong to somebody else. Each one earns its place with a reason.
 */
const NOT_OURS = new Set([
  'vercel.json', // ARCHITECTURE: "No `vercel.json`" - the point is that it does not exist
  'openapi.yaml', // MONETIZATION: Salable's spec, at salable.app
  'docs/SPRUCE-UP.md', // SPEC: "is cleared and deleted; its history is in git"
]);

/**
 * Another repo's tree. `handbook/` and `rfcs/` are Salable/company, which
 * MONETIZATION.md cites because that is where the RFC and the strategy live -
 * including, deliberately, two paths that are *wrong there* and want fixing.
 * Nothing in this repo can check them, so nothing here pretends to.
 */
const ANOTHER_REPO = /^(handbook\/|rfcs\/|app-builder\.md$)/;

test('every file the docs name exists in the tree', () => {
  const broken = [];
  for (const doc of DOCS) {
    if (HISTORICAL.test(doc)) continue;
    for (const tick of ticks(read(doc))) {
      if (!FILE_RE.test(tick) || NOT_OURS.has(tick) || ANOTHER_REPO.test(tick)) continue;
      // A URL path, not a file path - /api/b/YOUR-SLUG/AGENTS.md is a route.
      if (tick.startsWith('/')) continue;
      // Somebody else's tree, excluded from the corpus but really there.
      if (tick.startsWith('node_modules/')) {
        assert.ok(
          existsSync(path.join(ROOT, tick)),
          `${doc} names a node_modules path that is not installed: ${tick}`,
        );
        continue;
      }
      // A doc may use a bare basename or a partial path as shorthand.
      const hits = (BY_BASENAME.get(path.basename(tick)) ?? []).filter(
        (p) => p === tick || p.endsWith(`/${tick}`) || path.basename(p) === tick,
      );
      if (hits.length === 0) broken.push(`${doc}: \`${tick}\``);
    }
  }
  assert.deepEqual(broken, [], `docs name files that do not exist:\n  ${broken.join('\n  ')}`);
});

/* ---- 2. links ---- */

const slugOf = (heading) =>
  heading
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

test('every relative link and #anchor in the docs resolves', () => {
  const broken = [];
  for (const doc of DOCS) {
    const dir = path.dirname(doc);
    for (const [, label, target] of read(doc).matchAll(/\[([^\]]{1,80})\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|#|mailto:)/.test(target)) continue;
      const [file, anchor] = target.split('#');
      if (file === '') continue;
      // An in-app route (/docs/board-types) is served by app/docs, not a file.
      if (file.startsWith('/')) continue;
      const rel = path.normalize(path.join(dir, file)).replace(/\/$/, '');
      // A link may point at a directory (docs/rfcs/) as well as a file.
      const exists = TREE.includes(rel) || TREE.some((p) => p.startsWith(`${rel}/`));
      if (!exists) {
        broken.push(`${doc}: [${label}] -> ${target} (no such file)`);
        continue;
      }
      if (!anchor || !rel.endsWith('.md')) continue;
      const slugs = [...read(rel).matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slugOf(m[1]));
      if (!slugs.includes(anchor.toLowerCase())) {
        broken.push(`${doc}: [${label}] -> ${target} (no such heading)`);
      }
    }
  }
  assert.deepEqual(broken, [], `broken links:\n  ${broken.join('\n  ')}`);
});

/* ---- 3. env vars, both directions ---- */

/** Read by the runtime, but nobody's business to document. */
const IMPLICIT_ENV = new Set(['NODE_ENV', 'PORT', 'LANG']);

test('the docs and the code agree about every environment variable', () => {
  const documented = new Map();
  for (const doc of DOCS) {
    for (const tick of ticks(read(doc))) {
      // `UPSTASH_REDIS_REST_URL/TOKEN` names two in one span.
      for (const name of tick.split(/[^A-Z0-9_]+/)) {
        if (/^[A-Z][A-Z0-9_]{3,}$/.test(name)) documented.set(name, doc);
      }
    }
  }
  const inCode = new Set(
    [...CODE.matchAll(/(?:process\.)?env\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]),
  );

  const undocumented = [...inCode].filter((n) => !IMPLICIT_ENV.has(n) && !documented.has(n));
  assert.deepEqual(
    undocumented,
    [],
    `the code reads env vars no doc mentions: ${undocumented.join(', ')}`,
  );
});

/* ---- 4. identifiers ---- */

/**
 * Shapes that are unmistakably code: a call, camelCase, PascalCase, or
 * SCREAMING_SNAKE. Prose that happens to take one of those shapes is listed
 * below rather than pattern-matched around, so adding to this list is a
 * decision somebody makes on purpose.
 */
const CODEISH =
  /^_?(?:[a-z][a-z0-9]*(?:[A-Z][A-Za-z0-9]*)+|[A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]*)+|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)(?:\(\))?$/;
// The leading underscore is not decoration: `_setDbForTests` was the worst of
// the six untrue things this file was written for, and the first version of
// this pattern let it through.

const PROSE = new Set([
  'HttpOnly', // a cookie attribute (legal docs)
  'SameSite', // ditto
  'DataBridge', // UK-US transfer mechanism, in the privacy notice
  'GaussianBlur', // an SVG filter primitive
  'feGaussianBlur',
  'XRANGE', // a Redis command, named in the cost argument
  'NaN', // JS, but a value rather than an identifier of ours
  'OpenAPI',
  'JetBrains',
  'PostgreSQL',
  'TypeScript',
  'JavaScript',
]);

/**
 * Somebody else's API, named because we call it. Not in our corpus by
 * design - the check is about our own code not rotting, and vendoring
 * node_modules into it would make the test slow and the failures useless.
 */
const THIRD_PARTY = new Set([
  'deleteUser', // Better Auth's, named in SPEC's account-deletion plan
  'createSalableOnlySubscription', // Salable's OpenAPI operation
  'checkEntitlements', // ditto (we also have a method of this name)
  'retrievePlan', // Salable's GET /api/plans/{id}
  'savePlan', // Salable's POST /api/plans/save
  'createEntitlement', // Salable's POST /api/entitlements
  'createPlan', // Salable's POST /api/plans - the red herring, named to say so
  'createProduct', // Salable's POST /api/products
  'listApiKeys', // Salable's GET /api/api-keys
  'createApiKey', // Salable's POST /api/api-keys
  'retrieveApiKey', // Salable's GET /api/api-keys/{id}
]);

test('every code identifier the docs name exists somewhere in the code', () => {
  const broken = [];
  for (const doc of DOCS) {
    if (HISTORICAL.test(doc)) continue;
    for (const tick of ticks(read(doc))) {
      const name = tick.replace(/\(\)$/, '');
      if (!CODEISH.test(tick) || PROSE.has(name) || THIRD_PARTY.has(name)) continue;
      if (name.length < 4) continue;
      if (!mentions(name)) broken.push(`${doc}: \`${tick}\``);
    }
  }
  assert.deepEqual(
    broken,
    [],
    `docs name identifiers that are nowhere in the code:\n  ${broken.join('\n  ')}`,
  );
});

/* ---- 5. the API surface ---- */

/** Every route file under app/api, as (method, url-shaped path). */
function routesUnder(dir) {
  const found = [];
  for (const rel of TREE) {
    if (!rel.startsWith(dir) || path.basename(rel) !== 'route.ts') continue;
    const url = `/${path.dirname(rel).replace(/^app\//, '')}`
      .replace(/\[\[?\.\.\.([A-Za-z]+)\]\]?/g, '{$1}')
      .replace(/\[([A-Za-z]+)\]/g, '{$1}');
    for (const [, method] of read(rel).matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\b/g)) {
      found.push({ method, url });
    }
  }
  return found;
}

/**
 * A board route the API document deliberately leaves out, each with the
 * reason it is not an API client's business. Adding a route means either
 * documenting it or naming it here.
 */
const NOT_FOR_CLIENTS = new Map([
  ['/api/b/{slug}/commands/stream', 'the display, not an API client - and the doc says so by name'],
  ['/api/b/{slug}/state', 'the display writes its own state back, with a display credential'],
  ['/api/b/{slug}/queue/advance', 'ditto'],
  ['/api/b/{slug}/queue/attach', 'a 410 tombstone from 4.0'],
  ['/api/b/{slug}/queue/detach', 'a 410 tombstone from 4.0'],
  ['/api/b/{slug}/queue/mode', 'a 410 tombstone from 4.0'],
]);

test('BOARD-API.md documents every board route a client can call', () => {
  const doc = read('docs/BOARD-API.md');
  const table = doc.slice(doc.indexOf('## 7. Endpoints'));
  const undocumented = [];
  for (const { method, url } of routesUnder('app/api/b/')) {
    // The path normalised the way the document writes it.
    const documentedPath = url.replace('{itemId}', '{id}').replace('{name}', '{name}');
    if (NOT_FOR_CLIENTS.has(url)) continue;
    // A row names the path in ticks and the method in ticks somewhere on it.
    const row = table
      .split('\n')
      .find((line) => line.includes(`\`${documentedPath}\``) && line.includes(`\`${method}\``));
    if (!row) undocumented.push(`${method} ${documentedPath}`);
  }
  assert.deepEqual(
    undocumented,
    [],
    `routes a client can call that BOARD-API.md section 7 does not list:\n  ${undocumented.join('\n  ')}`,
  );
});

test('BOARD-API.md lists every status code the board routes actually return', () => {
  const doc = read('docs/BOARD-API.md');
  const table = doc.slice(doc.indexOf('### Status codes'));
  const listed = new Set([...table.matchAll(/^\| `(\d{3})`/gm)].map((m) => m[1]));
  // What the handlers and the board route files can hand back.
  const returned = new Set();
  for (const rel of [...TREE.filter((p) => p.startsWith('app/api/b/') && p.endsWith('route.ts')), 'lib/api/handlers.mjs']) {
    for (const [, code] of read(rel).matchAll(/(?:status:\s*|,\s*)\b(4\d\d|410|5\d\d)\b\s*[,)\n]/g)) {
      returned.add(code);
    }
  }
  const missing = [...returned].filter((c) => !listed.has(c)).sort();
  assert.deepEqual(
    missing,
    [],
    `status codes the code returns but the table does not explain: ${missing.join(', ')}`,
  );
});

/* ---- 6. the numbers the cost argument rests on ---- */

test('AGENTS.md quotes the polling constants the code actually uses', () => {
  const agents = read('AGENTS.md');
  const handlers = read('lib/api/handlers.mjs');
  const publisher = read('hooks/useStatePublisher.ts');

  const constant = (text, name) => {
    const found = new RegExp(`${name}\\s*=\\s*([0-9_]+)`).exec(text);
    assert.ok(found, `${name} is gone from the code, so AGENTS.md cannot still be quoting it`);
    return Number(found[1].replace(/_/g, ''));
  };

  // The claim: "750 ms while something is happening, 8 s once idle", a 5 s
  // heartbeat, a 15 s stream keepalive and a 20 s wait during an outage.
  assert.equal(constant(handlers, 'activeDelayMs'), 750);
  assert.equal(constant(handlers, 'idleDelayMs'), 8000);
  assert.equal(constant(publisher, 'HEARTBEAT_MS'), 5000);
  assert.equal(constant(handlers, 'heartbeatMs'), 15_000);
  assert.equal(constant(handlers, 'outageDelayMs'), 20_000);

  for (const quoted of ['750 ms', '8 s', '5 s', '15 s', '20 s']) {
    assert.ok(agents.includes(quoted), `AGENTS.md no longer quotes ${quoted}`);
  }
  // The bill follows from those, so the arithmetic is worth pinning too.
  const perDay = (86_400_000 / 8000) + (86_400_000 / 5000);
  assert.ok(perDay > 25_000 && perDay < 35_000, 'the ~30k commands a day claim no longer follows');
});

test('ARCHITECTURE.md names every function that raises its maxDuration', () => {
  const named = read('docs/ARCHITECTURE.md');
  const long = TREE.filter((p) => p.endsWith('route.ts') && /maxDuration\s*=/.test(read(p))).map(
    (p) => path.dirname(p).replace(/^app\/api\//, '').replace(/^b\/\[slug\]\//, ''),
  );
  const missing = long.filter((name) => !named.includes(`\`${name}\``));
  assert.deepEqual(
    missing,
    [],
    `functions setting maxDuration that ARCHITECTURE.md does not name: ${missing.join(', ')}`,
  );
  const count = { 1: 'one', 2: 'two', 3: 'three', 4: 'four' }[long.length];
  assert.ok(
    named.includes(`the ${count} long functions`),
    `ARCHITECTURE.md counts the long functions wrongly - there are ${long.length} (${count})`,
  );
});
