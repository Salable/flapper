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

That's it — the generated tile art is committed, and with no environment the
app runs on a local PGlite database and an in-memory realtime broker. Create
an account at http://localhost:3000, provision a board from the dashboard, and
drive it with the key from its settings page:

```bash
curl -X POST http://localhost:3000/api/b/YOUR-SLUG/message \
  -H 'authorization: Bearer YOUR_KEY' \
  -H 'content-type: application/json' -d '{"text":"HELLO"}'
```

`npm test` runs ~190 tests in a few seconds with no browser in the loop.

---

## How it fits together

The boundary that matters is **what can be tested** — anything with a decision
in it lives in a pure module a test can reach, and the parts that touch a
canvas, the DOM, or Redis are left as thin appliers.

```
lib/board/    the engine and its logic: pure ESM, no React     ← all unit-tested
lib/board-types/  one definition per board type + the registry  ← contract-tested
lib/db/       drizzle schema + board/queue queries (Neon or PGlite) ← PGlite-tested
lib/api/      validation + route handlers as (Request) -> Response  ← unit-tested
lib/broker/   the realtime channel (Upstash or memory)         ← contract-tested
lib/auth.ts   Better Auth over the same db; next-ctx.ts injects sessions
app/          Next.js: pages, and route.ts one-liners over lib/api
components/   React chrome around the imperative engine
hooks/        the display tab's cloud connection
desktop/      the Electron kiosk shell (three files, no build)
tools/        asset build, icon build, build-time migration
```

| Module | Does |
| --- | --- |
| `lib/board/layout.mjs` | text → pages: fold to the charset, wrap, align, paginate |
| `lib/board/timing.mjs` | the motion model, shared so animation and API estimates can't drift |
| `lib/board/regions.mjs` | row bands: partition the grid, map lines to tile targets |
| `lib/board/flipboard.js` | the engine: tiles, frames, the animation loop |
| `lib/board/track.mjs` | one queue, dwell clock and watchdog **per band** |
| `lib/board/controller.mjs` | routes messages to bands; owns geometry and status |
| `lib/board/player.mjs` | the display's playback machines: live (play/report) and clock (evaluate/cut/sleep) |
| `lib/board/schedule.mjs` | the pure schedule evaluator: triggers, ties, DST, next-change |
| `lib/board-types/index.mjs` | the type registry; `docs/BOARD-TYPES.md` is the authoring guide |
| `lib/db/queue.mjs` | the server-side queue: order, caps, the playback head, epochs |
| `components/BoardApp.tsx` | boots the engine and the player, applies layout, wires F/Esc |
| `lib/api/validators.mjs` | request validation, every 422 named |
| `lib/api/handlers.mjs` | the API surface; route.ts files are one-line wrappers |
| `lib/api/mcp.mjs` | the MCP tools: each drives a REST handler with a constructed Request |
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

**The art is the spec.** Each transition — `A`→`B`, `9`→`.`, `)`→`blank` — is a
separate piece of source art. `tools/build_assets.py` stacks each one's frames
into a vertical WebP strip and writes `public/assets/manifest.json` describing
the ring.

At runtime a tile is **one integer**: which state it is resting on. That index
is both the character and the strip that leaves it:

```
at rest on state i    →  strips[i], frame 0
flipping i → i+1      →  strips[i], frames 1..9
```

The whole board is one canvas, one `drawImage` per tile per frame. A 20×8 board
is 160 draws. When every tile has landed the animation loop **stops completely**
and the page uses no CPU until something changes.

Three details that took real work, and that you would otherwise rediscover the
hard way:

- **The landing seam.** Every source GIF was rendered independently, so one
  file's "settled A" differs from the next file's by about a pixel. Chaining
  them naively makes tiles *twitch* at the exact moment they come to rest. The
  build fixes it by replacing each transition's final frame with frame 0 of the
  next one, displacing the discrepancy onto a moving frame where nobody can see
  it.
- **Retargeting mid-flight never snaps.** A tile already moving finishes its
  current step, then carries on forward to the new target.
- **Settling is per band, not per board.** Each band reports coming to rest
  independently. With a single whole-board callback, a footer updating on its
  own clock would reset the hold on whatever is playing above it.

---

## Making it your own

### Change the characters

**Nothing about the character set is hardcoded.** The build walks the
filenames, derives the ring, and asserts that it closes and covers every
transition. Supply art named `FROM-TO.gif` for a closed cycle and everything
downstream follows — layout, the API's advertised charset, the substitution
table, the estimates.

```bash
python3 tools/build_assets.py --src ./my-art --size 128
```

Add lowercase, use a different alphabet, cut it down to digits and a colon for
a clock — the app does not need to know. Use `--size` to match how big your
tiles actually render; every frame stays decoded in memory in the display tab
(~105 MB at 256, ~28 MB at 128).

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
