# Building your own split-flap board

This repo is a **worked example**, not a product. It renders a wall of
mechanical split-flap tiles in the browser, drives them from a cloud REST API,
and is deliberately small enough to read in an afternoon and rebuild your own
way.

This file is for whoever — or whatever — is working on the code. If you want to
*drive* a running board instead, that contract is
[docs/BOARD-API.md](docs/BOARD-API.md), served live from every board at
`GET /api/b/{slug}/AGENTS.md`. For adding a board type — the main extension
point — see [docs/BOARD-TYPES.md](docs/BOARD-TYPES.md).

**The one idea worth taking away:** a split-flap tile can only ever move
*forward*, one step at a time, through a fixed ring of characters. Getting from
`Z` to `A` means travelling through the digits and punctuation — 17 steps. Every
other design decision in the engine falls out of that constraint.

---

## Run it

```bash
npm install && npm run dev
```

That's it — the tiles are drawn, not downloaded, and with no environment the
app runs on a local PGlite database and an in-memory realtime broker. Create
an account at http://localhost:3000, provision a board from the dashboard, and
drive it with the key from its settings page:

```bash
curl -X POST http://localhost:3000/api/b/YOUR-SLUG/message \
  -H 'authorization: Bearer YOUR_KEY' \
  -H 'content-type: application/json' -d '{"text":"HELLO"}'
```

`npm test` runs ~320 tests in a few seconds with no browser in the loop.

---

## How it fits together

`docs/ARCHITECTURE.md` is the map - frameworks, the request flows, the data,
the delivery systems, every component and its screen. This section is the
short version.

The boundary that matters is **what can be tested** — anything with a decision
in it lives in a pure module a test can reach, and the parts that touch a
canvas, the DOM, or Redis are left as thin appliers.

```
lib/board/    the engine and its logic: pure ESM, no React     ← unit-tested (flipboard.js excepted: it needs a canvas)
lib/board-types/  one definition per board type + the registry  ← contract-tested
lib/db/       drizzle schema + board/queue queries (Neon or PGlite) ← PGlite-tested
lib/api/      validation + route handlers as (Request) -> Response  ← unit-tested
lib/legal/    the legal documents registry (what is published, what is still a placeholder)
lib/broker/   the realtime channel (Upstash or memory)         ← contract-tested
lib/auth.ts   Better Auth over the same db; next-ctx.ts injects sessions
app/          Next.js: pages, and route.ts one-liners over lib/api
components/   React chrome around the imperative engine
hooks/        the display tab's cloud connection
desktop/      the Electron kiosk shell (three files, no build)
tools/        audio build, icon build, build-time migration
```

| Module | Does |
| --- | --- |
| `lib/board/layout.mjs` | text → pages: fold to the charset, wrap, align, paginate |
| `lib/board/timing.mjs` | the motion model, shared so animation and API estimates can't drift |
| `lib/board/regions.mjs` | row bands: partition the grid, map lines to tile targets |
| `lib/board/flipboard.js` | the engine: tiles, progress, the animation loop; paints through a skin |
| `lib/board/ring.mjs` | the ring: the states a tile can rest on, in order |
| `lib/board/themes.mjs` | the theme presets, validated at load |
| `lib/board/audio.mjs` | the clacks: `planVoices` (pure) and the Web Audio shell around it |
| `lib/board/idle.mjs` | the wordmark's ambient choreography (flickers and sweeps) |
| `lib/board/skins/` | `ProceduralSkin`: paints a theme pack's cards and draws the flap |
| `lib/board/theme-pack.mjs` | the pack schema, its validator and defaults |
| `lib/board/board-theme.mjs` | a board's own theme: preset + sparse overrides, limits, the revision displays key on |
| `lib/board/theme-editor.mjs` | the theme editor's decisions: drafts, per-glyph overrides, draft → patch |
| `lib/legal/documents.mjs` | the legal documents the site publishes and whether each is still a placeholder |
| `lib/board/track.mjs` | one queue, dwell clock and watchdog **per band** |
| `lib/board/controller.mjs` | routes messages to bands; owns geometry and status |
| `lib/board/player.mjs` | the display's playback machines: live (play/report) and clock (evaluate/cut/sleep) |
| `lib/board/schedule.mjs` | the pure schedule evaluator: triggers, ties, DST, next-change |
| `lib/board-types/index.mjs` | the type registry; `docs/BOARD-TYPES.md` is the authoring guide |
| `lib/board-types/contract.mjs` | the harness every definition must pass (shape, client-safety) |
| `lib/board-types/templates.mjs` | the `/new` rails: a type plus a preset config and seed messages |
| `lib/db/queue.mjs` | the server-side queue: order, caps, the playback head, epochs |
| `components/BoardApp.tsx` | boots the engine and the player, applies layout, wires F/Esc |
| `lib/api/validators.mjs` | request validation, every 422 named |
| `lib/api/handlers.mjs` | the API surface; route.ts files are one-line wrappers |
| `lib/api/mcp.mjs` | the MCP tools: each drives a REST handler with a constructed Request |
| `lib/api/agents-doc.mjs` | the per-board `AGENTS.md` template; kept in step with `docs/BOARD-API.md` by hand |
| `lib/api/headless-board.mjs` | the Controller with no canvas, for `/preview`, `/capabilities`, estimates |
| `lib/api/liveness.mjs` | stale / frozen / boardReady from a display's last report |
| `lib/api/display-token.mjs`, `mask.mjs`, `revocations.mjs`, `connections.mjs` | display credentials; hiding the key in on-screen text; disconnecting an OAuth client for real; listing what can still get in |
| `lib/broker/tokens.mjs` | ids, keys and hashing (Web Crypto; shared by `lib/api` and `lib/board`) |
| `lib/db/schema.mjs` | the hand-written Drizzle schema, Better Auth tables included |
| `components/BoardSidebar.tsx` | a board's identity beside any per-board screen |
| `components/ThemeSettings.tsx` | the theme editor; its decisions are in `lib/board/theme-editor.mjs` |
| `lib/api/headless-board.mjs` | the real Controller over stored config, server-side |
| `lib/broker/index.mjs` | picks RedisBroker or MemoryBroker; the only chooser |
| `lib/db/client.mjs` | picks Neon or PGlite; the only chooser |
| `lib/db/boards.mjs` | board CRUD; every function takes `db` first |
| `lib/db/slugs.mjs` | slug validation + the readable generator |

A message's journey, end to end:

```
POST /api/b/{slug}/message
  → handlers.mjs        slug → board row, key check, validation, source:'api'
  → type.ingest         the board's type says what the message becomes
  → db/queue.mjs        the item lands in the server-side queue (202)
  → broker              a sync nudge on the board's command stream
  → player.mjs          each display resyncs; live plays the head, clock
                        evaluates the schedule against the server clock
  → controller.mjs      lays it out, queues it, starts the dwell clock
  → flipboard.js        retargets the tiles; rAF until they settle
  → useStatePublisher   posts the new state; /status now shows it
```

Access in one sentence each: writes need the board's API key; reads are open
on public boards and need the key (or the owner's session) on private ones;
management — rename, slug, privacy, rotation, deletion — is owner-session
only, from the dashboard and `/b/{slug}/settings`.

The same surface is exposed over MCP at `POST /api/mcp` — one endpoint for
the deployment (Streamable HTTP, stateless), two bearer modes told apart by
shape: a board's API key (the key names the board) or an OAuth access token
this deployment issued (the token names the user; board tools then take a
`slug` argument, and list_boards/create_board/get_board_key come alive).
`lib/api/mcp.mjs` holds the tool definitions and the composite verifier,
Next-free and Better-Auth-free — the JWT half is injected from `lib/auth.ts`.
Each tool constructs a `Request` and calls the REST handler (in user mode
with `getSession` stubbed to the token's user, so the owner gates do the
authorizing) — the tests' own trick — so the two interfaces cannot drift.
Only the route file imports `mcp-handler`.

Better Auth is also the OAuth 2.1 authorization server (`jwt()` + `mcp()` +
`cimd()` plugins in `lib/auth.ts`): endpoints under `/api/auth/oauth2/*`,
discovery documents from `app/.well-known/`, the consent screen at
`/consent`, and clients self-register (DCR + CIMD). `BETTER_AUTH_URL` must be
the canonical public origin in production — issuer, JWKS, and the RFC 8707
resource identifier all derive from it and must byte-match.

Two things follow from the fire-and-forget shape: a `202` never proves a
display is connected (`/status`'s `stale` field is the truth), and `preview` /
`capabilities` answer without any display — they run the real `Controller`
against a headless board server-side, from the same stored config the display
applies.

---

## How the rendering works

At runtime a tile is **an integer and a fraction**: which state it is resting
on (or leaving), and how far through the flap to the next state it is:

```
{ state: 14, progress: 0 }      resting on N
{ state: 14, progress: 0.4 }    40% of the way from N to O
```

The engine (`flipboard.js`) owns that and nothing about how it looks. Painting
is a **skin** (`lib/board/skins/`): `skin.drawTile(ctx, state, progress, x, y,
size)`, one call per tile per frame. The one that ships is `ProceduralSkin`:
there is no art. A **theme pack** (`lib/board/theme-pack.mjs`: palette, type,
hinge, motion, per-glyph overrides, optional images) is painted into one
offscreen card per state at the current tile size, and the flap is drawn
live — the falling half foreshortened by cos θ, darkened as it turns, throwing
a shadow on the card below. 42 cards at 256 px is ~11 MB.

The board used to play designer-rendered clips (one per transition, baked into
WebP strips); `docs/RENDERER-RESEARCH.md` is the note that replaced them, and
the Classic pack's numbers were measured from that art. If you ever want
hand-animated tiles back, the skin seam is where they go.

The whole board is one canvas. When every tile has landed the animation loop
**stops completely** and the page uses no CPU until something changes.

Three details that took real work, and that you would otherwise rediscover the
hard way:

- **Rest and landing are the same card.** A flap ends by drawing the
  destination card's bottom half exactly where the resting card's bottom half
  will be, so a tile never twitches as it settles. Keep it that way: the
  landing frame of any skin must be pixel-identical to the next resting frame.
- **Retargeting mid-flight never snaps.** A tile already moving finishes its
  current step, then carries on forward to the new target.
- **Settling is per band, not per board.** Each band reports coming to rest
  independently. With a single whole-board callback, a footer updating on its
  own clock would reset the hold on whatever is playing above it.

---

## Making it your own

### Change the characters

The ring is one list: `RING` in `lib/board/ring.mjs`. Everything downstream
derives from it — the cards a theme paints, layout, the API's advertised
charset, the substitution table, the estimates. Add lowercase, use a
different alphabet, cut it down to digits and a colon for a clock: edit the
list, keep `blank` first, and run the tests (`tests/theme-pack.test.mjs` pins
the current ring; update the snapshot deliberately).

It is the API contract every board advertises, so a change is a change for
every agent that has read a board's `/capabilities` — treat it like one.

### The sound

Every tile step is a flap, and `Flipboard.onFlap` reports each frame's
flaps to `lib/board/audio.mjs`. `planVoices` (pure, tested) decides how a
frame's flaps are voiced: at most eight voices a frame, gain scaled so a
full-board sweep is louder than one tile but plateaus well short of
clipping, each voice spread through the frame, panned by column and
pitch-jittered, playing one of sixteen single-flap samples at random.
`FlapSound` is the Web Audio shell around it (master gain → limiter).
The samples are cut from a recording of a real board by
`tools/build_audio.py` into one WAV sprite in `public/audio/`:

```bash
python3 tools/build_audio.py --src recording.mp3 --out public/audio
```

Mute and volume (M, ↑/↓) are the display's, kept in localStorage under
`flapper.audio.v1`, not the board's config.

### Add a theme

A theme is the *same* ring in different paint. A board's theme is in its
config (`PATCH /config {"theme":"canary"}`, or Settings → Display → Theme);
the display loads the new skin in the background and `Flipboard.setSkin()`
swaps it under the tiles in place. Every registered id reaches the
validator, the theme editor's preset picker, `/capabilities` and the MCP
`update_config` schema from `lib/board/themes.mjs` alone.

To ship a new preset, add a pack to `THEMES` in `themes.mjs`:

```js
'acme': preset({
  id: 'acme', name: 'Acme',
  card: { fill: '#f4efe6', edge: '#d8cfbf', radius: 0.12 },
  glyph: { fill: '#1f2a44', font: '400 0.9em Georgia, serif' },
  states: { '!': { glyph: { fill: '#d9381e' } }, '(': { art: 'logo' } },
  art: { logo: '/assets/acme/logo.png' },
}),
```

`validatePack` runs at module load, so a bad value fails `npm test`, not the
wall. Every field and its range is in `PACK_DEFAULTS`/`RANGES` in
`theme-pack.mjs`; unspecified fields are the Classic look. Iterate in a
board's Settings → Display → Theme, which draws the pack live and has the
whole thing as JSON under "Advanced"; copy it back here when it is right. A
pack cannot change the ring — that is `RING`, above.

Boards that were set to `classic-p` or `canary-p` while the drawn themes ran
alongside the old art still resolve (to `classic`/`canary`); the ids are not
accepted on write.

**A board's own look** needs no preset at all: `themePack` in its config is
a sparse set of overrides on top of its `theme` (`lib/board/board-theme.mjs`
- merge, limits, `sparsify`, the revision). The server stores only what
differs from the preset, `/queue` carries just the revision, and the display
fetches `/theme` when it moves. `docs/BOARD-API.md` "A board's own look" is
the contract; Settings → Display → Theme (`components/ThemeSettings.tsx`,
decisions in `lib/board/theme-editor.mjs`) is the UI for it.

### Change how it moves

Everything is in `lib/board/timing.mjs` and live-tunable from the panel under
**Motion**, or over `PATCH /api/b/{slug}/config`: `fastStepMs`,
`landStepMs`, `easeSteps`, `sweepMs`, `staggerMode`.

### Change the layout rules

`lib/board/layout.mjs` is where text becomes pages — the folding table (`&` →
` AND `, `?` → `.`, quotes dropped), word wrap, alignment, pagination. It is
pure and heavily tested, so it is the safest file in the repo to experiment in.

### Change the shape of the board

`lib/board/regions.mjs` partitions the grid into bands. It already takes an
arbitrary ordered list, so a header strip is a config key and an id — not a
redesign. Two bands are exposed today because two is what was needed.

### Change the cloud

`lib/broker/` is the entire cloud footprint: one interface, a Redis
implementation, a memory fake. Swapping Upstash for something else — or the
stream-poll SSE for a push transport — touches nothing outside that directory
and the two stream handlers in `lib/api/handlers.mjs`.

**The realtime bill is a polling bill.** Vercel functions cannot hold a
Redis subscription, so every display is a loop of REST commands: the
command stream polls `XRANGE` (750 ms while something is happening, 8 s
once idle), the display heartbeats its state every 5 s (`SET`), and each
5-minute stream reconnect touches the keys. One display running all day is
roughly 30k commands, so a wall that never sleeps is ~900k a month —
Upstash's free tier (500k) lasts about a fortnight. The numbers that set
this are `idleDelayMs`/`pollMs` in the stream handlers and `HEARTBEAT_MS`
in `hooks/useStatePublisher.ts`; the alternative is a push transport.

When Redis is down or over quota the app degrades rather than breaks:
`RedisBroker` turns every failure into a 503 that reads as a sentence (the
provider's text goes to the log), writes still succeed and log a skipped
nudge, `/health` answers `realtime: "unavailable"`, the dashboard says so,
and the streams hold their connection with 20 s heartbeats instead of
letting displays reconnect in a loop - which is what turns an over-quota
service into a more over-quota service.

### Drive it from something else

A feed, a build status, a now-playing hook — all `POST .../message` with the
board's API key. `GET .../events` is an SSE stream of board state if you want to
react to the board rather than only write to it.

For live tuning, `window.flipboard` and `window.controller` are exposed to the
display tab's devtools console:

```js
controller.configure({ cols: 44, rows: 6, footerRows: 2, sweepMs: 450 })
controller.enqueue('HELLO', { region: 'footer', repeat: true })
```

---

## Conventions worth keeping

These are the rules the existing code follows. Break them deliberately, not by
accident.

- **Pure logic goes in a module a test can import.** The player's and
  evaluator's decisions live in `lib/board/`, not the components; the API's
  decisions live in `lib/api/`, not the route files. If you find yourself writing a decision inside a
  component or a `route.ts`, that is the signal.
- **Reject, don't ignore.** An option that doesn't apply gets a `422` naming
  the field and why. Silently dropping it reads as a bug from the caller's
  side.
- **All Redis access goes through `lib/broker`, all Postgres through
  `lib/db`.** Handlers never import `@upstash/redis` or `drizzle-orm`
  directly; that is what keeps every test runnable with the memory fake and an
  in-memory PGlite, and both layers swappable.
- **Auth stays behind the injected `getSession`.** Only `lib/auth.ts` and
  `lib/api/next-ctx.ts` know Better Auth exists; handlers and tests receive a
  plain async function.
- **Route files stay Next-free at the top level.** Handlers are plain
  `(Request) => Response` functions, which is what lets `node --test` exercise
  the whole API without a server.
- **Errors cross boundaries as values, not exceptions.** The dispatch envelope
  is `{ok, value}` or `{ok: false, error: {message, status}}`, so a 422 from
  the controller stays a 422 by the time it reaches a caller.
- **Comments say *why*.** The code already says what.

- **A control's value is never uppercased by the page.** `input`, `textarea`
  and `select` reset `text-transform`; only `.as-board` (the message
  composers) shows what the glass will show. A name, a slug, a colour, JSON
  are data (`app/board.css`, "A control's value is data").
- **A write never fails because the realtime service is down.** `nudge` is
  best-effort and logged; `RedisBroker` turns every provider failure into a
  503 in plain words; the streams hold their connection and back off. If
  you add a broker call to a write path, wrap it in `bestEffort`.
- **Consent is a record, not a flag.** Signup stores `termsVersion`,
  `termsAcceptedAt`, `marketingConsent`, `marketingConsentAt` with
  server-set timestamps (`lib/auth.ts` `databaseHooks`). Never set those
  timestamps from the client, and never pre-tick the marketing box.


## Testing

```bash
npm test                          # everything
node --test tests/layout.test.mjs # one file
```

`node --test` only — no framework, no mocking library, no jsdom. The controller
and player suites share `tests/stub-board.mjs`, a fake board that resolves its
bands with the *real* `regions.mjs`, so band behaviour is exercised rather than
described. `tests/api.test.mjs` calls the real handlers with `new Request(...)`
against a `MemoryBroker` and an in-memory PGlite, with sessions stubbed
through the injected `getSession` — the privacy matrix (anon/key/owner/
stranger) lives there. `tests/db.test.mjs` covers board CRUD and slug rules;
`tests/broker.test.mjs` runs the same contract against Redis when
`UPSTASH_REDIS_REST_URL` is set and skips it otherwise.

**`flipboard.js` has no automated coverage** — it needs a canvas. That is the
honest gap, and it is why anything worth testing gets extracted out of it. The
React components are in the same position; keep them thin.

## Where the bodies are buried

- A band whose queue has drained still shows its last page. It reports
  `showing: null` and `holding: {...}` — treat "nothing playing" and "nothing
  on the glass" as different states, or your readout will say *idle* while the
  board plainly says otherwise.
- `flush` drops what is *pending*. A repeating message that is currently
  showing is not pending, so flush will not stop a cycle — `clear` will.
- `repeat` cannot be switched off once a message is queued.
- A `202` from the API proves validation, not display. `/status.stale` is how
  you tell whether anything is actually showing the board.
- The SSE routes end themselves before Vercel's function window closes;
  `EventSource` reconnects with `Last-Event-ID` and nothing is lost. Don't
  "fix" the disconnects.
- Two tabs on one board both consume the stream and both flip — mirrored
  displays for free — but their state posts interleave; last writer wins.
- **Renaming a slug moves the API base and the display URL.** Open displays
  404 on their next reconnect and show a "reopen from the dashboard" note;
  this is documented behaviour, not a bug.
- The API key is stored in the clear (settings must show it) and scoped to one
  board; regeneration is the recovery story. Do not "harden" it into a hash
  without redesigning settings.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
