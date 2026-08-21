# CLAUDE.md

The guide for working on this code is **[AGENTS.md](AGENTS.md)** — components,
how they fit, how the rendering, the database, and the cloud broker work, and
how to make it your own. Read that first; this file only adds what is specific
to running the repo.

## Commands

```bash
npm run dev                        # Next.js dev server (PGlite + memory broker, no env)
npm test                           # ~230 tests, a few seconds, no browser
node --test tests/layout.test.mjs  # a single file
npm run build                      # migrates (when DATABASE_URL) then next build
npm run db:generate                # after editing lib/db/schema.mjs
python3 tools/build_assets.py      # only when the tile art changes (see AGENTS.md "Add a theme")
python3 tools/build_audio.py --src x.mp3   # only when the flap recording changes
cd desktop && npm start            # the Electron kiosk shell
```

## Two documents named for agents

They serve different readers, and it is worth not confusing them:

- **`AGENTS.md`** (this file's sibling) — for working *on* the code.
- **`docs/BOARD-API.md`** — for *driving* a board over REST. Every board serves
  a live version at `GET /api/b/{slug}/AGENTS.md`, generated from
  `lib/api/agents-doc.mjs` with the board's own URLs. Change the contract and
  you are changing what every agent pointed at a board is told — keep the
  template, the repo doc, and the handlers in agreement.

## Checking your work

The app is a wall display, so "it looks right" is a real acceptance criterion
and the tests cannot give it to you. `npm test` is necessary and not sufficient.

To verify something end to end: `npm run dev`, sign up at localhost:3000,
create a board from the dashboard, open it in a browser tab, take the key from
`/b/{slug}/settings`, and drive it over HTTP:

```bash
curl -X POST http://localhost:3000/api/b/$SLUG/message \
  -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' -d '{"text":"HELLO"}'
curl -s http://localhost:3000/api/b/$SLUG/status
```

`GET .../status` returns `lines` — the literal rows on the glass, posted back
by the display tab — which is the cheapest way to assert what the board is
actually showing without a screenshot. `stale: true` means no display tab is
connected.

## Things that have caught people out

- `flipboard.js` has **no automated coverage** (it needs a canvas), and the
  React components are in the same position. Anything with a decision in it
  belongs in `lib/board/`, `lib/api/`, or `lib/db/` instead.
- **Singletons live on `globalThis` behind promises** (`getDb`, `getBroker`,
  `getAuth`) so dev-server recompiles share one instance — two PGlites on one
  `./.pglite` directory corrupt it. Never delete `./.pglite` while the dev
  server is running; stop it first. Tests inject with `_setDbForTests` /
  `_setBrokerForTests` and a stubbed `getSession`.
- **PGlite must stay unbundled** — `serverExternalPackages` in next.config.mjs;
  bundling breaks its WASM/fs paths with a cryptic URL-vs-string error.
- The hand-written Better Auth tables in `lib/db/schema.mjs` must track the
  version in package.json — 1.7 added `account.issuer` (compound unique with
  `accountId`) and session revocation columns. On upgrade, re-run
  `npx @better-auth/cli generate` and diff. The OAuth tables (`jwks`,
  `oauth_client`, …) belong to the pinned `@better-auth/oauth-provider`/`mcp`
  packages — on upgrading those, dump `plugin.schema` from the installed
  plugins and diff (the CLI generator chokes on our memory-adapter init).
- The MCP OAuth resource/issuer strings derive from `BETTER_AUTH_URL`
  (`lib/auth.ts`: `mcpResource()`, `oauthIssuer()`) and must stay
  byte-identical across config, discovery documents, and the verifier. Set
  `BETTER_AUTH_URL` on Vercel or OAuth (not key auth) silently breaks.
- Route files must keep their top-level imports Next-free — `tests/api.test.mjs`
  imports the handlers under plain `node --test`. Only `lib/api/next-ctx.ts`
  touches `lib/auth.ts`.
- A message's row budget is its **band**, not the board. Read `grid.mainRows`.
- Display `settings` is a one-level spread over `localStorage`
  (`lib/board/settings.mjs`); keep new settings flat or bump `SETTINGS_KEY`.
- A `202` from the API means validated-and-queued, not displayed. The stream
  routes end themselves before Vercel's function window; EventSource
  reconnection with `Last-Event-ID` is the design, not a bug.
- Slug renames move the API base; open displays 404 on reconnect and tell the
  user to reopen — documented behaviour.
- **Board-type definitions must stay client-safe**: the display player
  imports `lib/board-types/` in the browser, so a definition may import only
  pure `lib/` modules — never `lib/db/`, never react. The contract harness
  greps for this.
- **Tile-art bitmaps are shared property** (`components/flapper/assets.ts`):
  one decode per tab, used by the wordmark and the display alike. Never call
  `.close()` on them.
- **Callback-prop identity is never behavioral** in `components/ui/` —
  callers pass inline closures; an effect keyed on one re-runs every parent
  render (the Modal once re-focused itself on every keystroke). Rules:
  docs/DESIGN-SYSTEM.md, "Forms hold focus".
