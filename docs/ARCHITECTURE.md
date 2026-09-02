# Architecture

*How Flapper is built and delivered: the frameworks, the shape of the code,
the paths a message and a theme take through it, the data, and the systems
in production. `AGENTS.md` is the working guide (how to change things);
this is the map. Written 22 Aug 2026 from the code as it stands.*

## The system in one picture

```
 ┌──────────────┐  HTTPS   ┌───────────────────────────────┐   REST    ┌──────────────┐
 │ Control room │────────▶ │  Next.js on Vercel            │ ◀──────── │ Agents (MCP) │
 │ (browser)    │          │  app/  → lib/api handlers     │           │ Claude, GPT  │
 └──────────────┘          │  Better Auth (sessions, OAuth)│           └──────────────┘
                           │  Drizzle ─┐      Broker ──┐   │
 ┌──────────────┐  SSE/    │           ▼                ▼   │
 │ Display      │◀──────── │   Postgres (Neon)    Redis (Upstash)
 │ (wall/kiosk) │  POST    │   boards, queues,    commands stream,
 └──────────────┘  state   │   users, OAuth       display state
                           └───────────────────────────────┘
```

Three kinds of client talk to one Next.js app. The **control room** (a
signed-in browser) and **agents** (over REST with a board key, or over MCP
with OAuth) write; the **display** (an anonymous browser tab, or the
Electron kiosk wrapping one) reads a stream of commands and writes back what
it is showing. Postgres is the truth; Redis is only the realtime channel
between the API and the displays, and everything in it is ephemeral.

## Frameworks and why each is here

| Layer | Choice | Why |
| --- | --- | --- |
| Web app | **Next.js 16** (App Router), **React 19** | one deployable for pages, API routes and SSE streams; Vercel runs it with no servers to keep |
| Language | TypeScript for React and Next files; **plain ESM `.mjs`** for `lib/` | `lib/` must run under `node --test` with no build step and in the browser unchanged; `.d.mts` sidecars give TS the types where it matters (`lib/board/theme-pack.d.mts`) |
| Auth | **Better Auth 1.7** + its `oauth-provider`, `mcp` and `jwt` plugins | email+password sessions and, with the plugins, Flapper is its own OAuth 2.1 server, so an MCP client signs in as the user with no third-party identity service |
| Database | **Drizzle ORM** over **Neon** Postgres (serverless WebSocket driver) in production, **PGlite** (Postgres in WASM, on disk at `./.pglite`) locally and in tests | one schema (`lib/db/schema.mjs`), one migration folder (`drizzle/`), the same SQL everywhere; tests run a real Postgres in-process in seconds |
| Realtime | **Upstash Redis** over REST (`lib/broker/redis.mjs`), **in-memory** broker locally (`lib/broker/memory.mjs`) | Vercel functions cannot hold sockets, so the channel is a Redis stream polled over HTTP; one interface (`lib/broker/`), two implementations, contract-tested together |
| Agents | **@modelcontextprotocol/server** | the MCP tools in `lib/api/mcp.mjs` each construct a `Request` and call the same REST handler, so the two surfaces cannot drift |
| Validation | **zod** (MCP tool schemas) and hand-written validators (`lib/api/validators.mjs`) | the REST validators name every 422; zod gives the MCP client a schema it can read |
| Rendering | **Canvas 2D**, no library | one canvas, one draw per tile per frame, a skin that paints a theme pack (`docs/RENDERER-RESEARCH.md` is the record of why not sprites) |
| Audio | **Web Audio** | a recorded clack per flap, voiced and panned by `lib/board/audio.mjs` |
| Docs | **marked** | `/docs` and `/legal` render the repo's own markdown at request time |
| Kiosk | **Electron 43** (`desktop/`) | a full-screen shell that loads the live board URL and keeps the screen awake; no bundled app code, nothing to release when the web app changes |
| Quality | `node --test`, `tsc --noEmit`, **knip**, GitHub Actions | ~320 tests with no browser; type errors and dead code fail CI |

## The shape of the code

```
app/            Next.js: pages under app/**, API routes as one-line route.ts wrappers
  api/b/[slug]/ every board endpoint (status, queue, message, config, theme, streams…)
  api/boards    create; api/mcp the MCP server; api/auth/[...all] Better Auth
  b/[slug]      the display; b/[slug]/manage the control room (b/[slug]/settings redirects here)
  dashboard, new, account, consent, login, signup, docs, legal
components/     React chrome around the imperative engine (see "Components")
hooks/          useStatePublisher: the display's write-back of what it shows
lib/
  board/        the engine and its logic - pure, tested, client-safe
  board-types/  one definition per board type + the contract harness
  api/          validation and handlers as (Request) -> Response
  db/           Drizzle schema, board and queue queries, the client factory
  broker/       the realtime channel: interface, Redis, memory, ids and hashing
  legal/        the legal-document registry
  auth.ts       Better Auth configuration; next-ctx.ts injects sessions into handlers
drizzle/        generated SQL migrations (drizzle-kit generate from the schema)
docs/           this, the design system, the API contract, the board-types guide, legal
desktop/        the Electron kiosk (three files, packaged by GitHub Actions on a tag)
tools/          audio build, icon build, the build-time migration runner
tests/          node --test suites, one per module
```

**The rule that organises it**: anything with a decision in it lives in a
pure module a test can reach (`lib/`), and the parts that touch a canvas,
the DOM, Redis or a session are thin appliers. `lib/board/` is imported by
the browser and by the server alike, so it may never import `lib/db/`,
React or Node built-ins; `tests/board-type-contract.test.mjs` greps for it.

## Three flows

### A message, from an agent to the glass

```
POST /api/b/{slug}/message  {text}
  lib/api/validators.mjs      fold to the charset, size limits → 422s by name
  lib/board/layout.mjs        lay the text into pages (server-side, headless)
  lib/db/queue.mjs            append to the board's queue (Postgres), 202 {id, position, ahead}
  nudge()                     XADD a {method:'sync'} command to board:{id}:commands (Redis) - best-effort
GET  /api/b/{slug}/commands/stream   (the display's SSE, a Vercel function up to 300 s)
  commandEvents()             XRANGE the stream: 750 ms while busy, 8 s once idle, 20 s in an outage
  → the display's Player      GET /queue, diff, hand the Controller the new item
  → lib/board/controller.mjs  route to the band, start the Track's dwell clock
  → lib/board/flipboard.js    retarget tiles; requestAnimationFrame until they settle
  → hooks/useStatePublisher   POST /state {lines, animating, display} every change, heartbeat 5 s
GET  /api/b/{slug}/status     reads that last report from Redis: what the glass shows
```

The display reconnects its stream every five minutes (the function window)
with `Last-Event-ID`, and refetches `/queue` whenever its tab comes to the
foreground. If Redis is down, writes still save, the stream holds its
connection with heartbeats, and the display catches up on its next refetch
(`AGENTS.md` "Change the cloud").

### A theme, from the editor to every display

```
/designs/{id} (DesignEditor)  components/ThemeSettings.tsx
  lib/board/theme-editor.mjs   draft operations; draftToPatch = the diff from the preset
PATCH /api/b/{slug}/config   {theme, themePack}
  lib/board/board-theme.mjs    merge onto the preset, validate, store only the difference
  themeRevOf()                 sha256 of {theme, themePack}[:16] - the revision
GET /queue                     carries themeRev, never the pack
  → the display sees the rev move, GET /theme (ETag = rev, 304 if unchanged)
  → components/flapper/assets.ts   loadBoardSkin(rev, pack): fonts and art cached, cards painted
  → Flipboard.setSkin()        swapped under the tiles mid-message, nothing snaps
```

First paint is server-resolved: `app/b/[slug]/page.tsx` passes the resolved
pack so the display never boots into the wrong colour.

### A connector, from "add this URL" to driving a board

```
Claude/ChatGPT: add {origin}/api/mcp as a connector
  .well-known/oauth-authorization-server   discovery (Better Auth oauth-provider)
  /login?… → /consent                      the user signs in and allows the client
  access token (JWT) → every MCP call      lib/api/mcp.mjs: authContext(), resolveToolAuth()
  each tool                                constructs a Request, calls the REST handler
Disconnect (Account → Connected apps)
  lib/api/revocations.mjs                  a per-client watermark; the next request is refused
```

A single board can also connect with its API key as the bearer token, in
which case every tool drives that one board and `slug` is omitted.

## Data

**Postgres** (`lib/db/schema.mjs`, migrations in `drizzle/`):

| Table | Holds |
| --- | --- |
| `licence_requests` | the get-in-touch queue: a refusal that turned into a conversation ([MONETIZATION.md](MONETIZATION.md)) |
| `user`, `session`, `account`, `verification` | Better Auth identity; `user` also carries the consent record (`termsVersion`, `termsAcceptedAt`, `marketingConsent`, `marketingConsentAt`). `tier` is unread by anything and due to be dropped — entitlements live in Salable ([MONETIZATION.md](MONETIZATION.md)) |
| `jwks`, `oauth_client`, `oauth_resource`, `oauth_client_resource`, `oauth_refresh_token`, `oauth_access_token`, `oauth_consent`, `oauth_client_assertion` | Flapper as an OAuth 2.1 server for MCP clients (the `oauth-provider`/`mcp` plugins' schema, hand-copied - see `CLAUDE.md` on upgrades) |
| `oauth_client_revocation` | the disconnect watermark |
| `boards` | slug, name, type, status, private, the hashed API key, and `config` (jsonb: grid, motion, `theme`, `themePack`, `layout`, type params) |
| `queues`, `queue_items` | one queue per board; items with payload, loop flag, schedule, computed durations; the playback head and epoch |

**Redis** (`lib/broker/redis.mjs`), per board, 30-day TTL refreshed on use:

| Key | Type | Holds |
| --- | --- | --- |
| `board:{id}:commands` | stream (MAXLEN ~1000) | `sync` / `clear` nudges from the API to displays |
| `board:{id}:state` | string | the display's last report: `{snapshot, updatedAt}` |

**The browser**: the display keeps mute/volume in `localStorage`
(`flapper.audio.v1`); the session is one signed cookie. Nothing else is
stored client-side, which is why there is no cookie banner.

**Configuration is data, not code**: a board's look is a theme pack
(`lib/board/theme-pack.mjs`), its kind is a board-type definition
(`lib/board-types/`), and the character set is one list (`lib/board/ring.mjs`).

## Components

Top-level React, with the screen each serves. Every one is a thin applier
over `lib/`; the decisions are tested there.

| Component | Screen | Job |
| --- | --- | --- |
| `AppBar`, `UserMenu`, `SiteFooter` | every product page | the shell: wordmark, context actions, account menu; the company line and legal links |
| `AuthForm` | `/login`, `/signup`, and a connector's redirect | Better Auth email+password; the two consent boxes at signup; says which app is asking |
| `ConsentForm` | `/consent` | Allow / Deny for an OAuth client |
| `DashboardClient` | `/dashboard` | the board cards (name, type, three doors) and the Connections row |
| `NewBoardClient` | `/new` | the template rails and the create panel |
| `BoardPageClient` → `BoardApp` | `/b/{slug}` | boots the engine, the Player and the sound; applies layout and theme; F/Esc/M keys |
| `SettingsClient` | `/b/{slug}/manage` | the control room: three tabs (Settings / Board / Interruptions — the last live-only), owns the theme draft |
| `BoardSidebar` | manage › Settings | identity, design & shape (theme preset, screen ratio, card size, fidget), privacy, access, pause/export, delete |
| `QueueManager` | manage › Board (live), › Interruptions (live) | the rotation as a rail (one tab per slide, `section="board"`) and, in its own mounted instance, firing/managing interrupters (`section="interruptions"`) |
| `board-types/scheduled/ScheduleEditor`, `board-types/shared/SharedQueueEditor` | manage › Board (scheduled/shared types) | the type's own queue editor, in place of `QueueManager`; these types get no Interruptions tab |
| `TypeSettings` | manage › Settings | the type's advanced params (e.g. a live board's queue size) |
| `ConnectedApps`, `AccountClient` | `/account`, dashboard | the OAuth clients signed in as you, Disconnect; Privacy & data |
| `flapper/Flapper`, `flapper/ThemePreview`, `flapper/assets.ts`, `flapper/rasterize.ts` | wordmark, hero, editor | the engine in a box; a pack on a live board; the shared skin loader; uploads to pack art |
| `ui/*` | everywhere | the design system: Button, Field + controls, ColorInput, Tabs, Modal, ConfirmDialog, Card/Chip/Segmented/EmptyState, CopyButton/KeyReveal, MiniBoard (`docs/DESIGN-SYSTEM.md`) |

## Delivery

| Concern | How |
| --- | --- |
| **Hosting** | Vercel, stock GitHub import; `main` deploys to production, every PR gets a preview. No `vercel.json`; the two long functions (`commands/stream`, `events`) set `maxDuration = 300` |
| **Build** | `npm run build` = `tools/migrate-if-db.mjs` (runs `drizzle-kit migrate` when `DATABASE_URL` is set) then `next build`. Schema changes are `npm run db:generate` → a SQL file in `drizzle/` → applied at the next build, and in every test run |
| **Environment** | `DATABASE_URL` (Neon; absent = PGlite), `UPSTASH_REDIS_REST_URL` + `_TOKEN` (absent = memory broker), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (must be the public origin or MCP OAuth silently breaks) |
| **CI** (`.github/workflows/ci.yml`) | on every push and PR: `npm test`, `npm run typecheck`, `npx knip`, `npm run build` with no Redis (the memory broker must suffice) |
| **Desktop release** (`.github/workflows/release.yml`) | on a `v*` tag: tests, then `desktop/pack.mjs` packages a universal macOS app with `build/icon.icns`, signed and published as a GitHub release. It loads the live site, so web changes need no release |
| **Singletons** | `getDb`, `getBroker`, `getAuth` live on `globalThis` behind promises so dev-server recompiles share one instance - which is also why `lib/auth.ts` edits need a restart |
| **Observability** | `console.error` lines with a `flapper:` prefix for anything that degrades (a skipped nudge, a realtime outage, a refused stored config); `/health` reports `realtime`; `/status` reports what the glass shows and how stale it is |
| **Costs that scale with displays** | every display is a polling loop against Redis; one wall all day is ~30k commands (`AGENTS.md` "Change the cloud"). Postgres traffic is per write and per display refetch |
| **Failure containment** | a broken or unknown board type pauses that board, never the app; a dead broker degrades (writes save, 503s in words); a stored theme that no longer validates falls back to its preset with a log line |

## Where to read next

- `AGENTS.md` - working on the code: the engine, adding a theme, a type, changing the cloud
- `docs/BOARD-API.md` - driving a board over REST (the per-board live copy is `/api/b/{slug}/AGENTS.md`)
- `docs/BOARD-TYPES.md` - authoring a board type
- `docs/DESIGN-SYSTEM.md` - the UI vocabulary and the rules forms follow
- `docs/SCREENS.md` - every screen and its job
- `docs/RENDERER-RESEARCH.md` - why the tiles are drawn, not played
- `SPEC.md` - the asks, what shipped, and launch readiness
