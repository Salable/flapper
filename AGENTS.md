# Building your own split-flap board

This repo is a **worked example**, not a product. It renders a wall of mechanical
split-flap tiles, drives them from a REST API, and it is deliberately small
enough to read in an afternoon and rebuild your own way.

This file is for whoever — or whatever — is working on the code. If you want to
*drive* a running board instead, that contract is [docs/BOARD-API.md](docs/BOARD-API.md),
served live from any board at `GET /AGENTS.md`. For the full engineering detail
behind every decision here, see [SPEC.md](SPEC.md).

**The one idea worth taking away:** a split-flap tile can only ever move
*forward*, one step at a time, through a fixed ring of characters. Getting from
`Z` to `A` means travelling through the digits and punctuation — 17 steps. Every
other design decision in this repo falls out of that constraint.

---

## Run it

```bash
npm install && npm start
```

That's it — the generated tile art is committed, so there is no build step to
run first. `npm test` runs 167 tests in about a fifth of a second with no
Electron in the loop.

```bash
curl -X POST http://127.0.0.1:4747/api/message \
  -H 'content-type: application/json' -d '{"text":"HELLO"}'
```

---

## How it fits together

Four layers. The boundary that matters is **what can be tested** — anything with
a decision in it lives in a pure module a test can reach, and the parts that
touch a canvas or a `document` are left as thin appliers.

```
src/shared/     pure logic, no DOM and no Node          ← all unit-tested
src/main/       Electron main: HTTP, window, IPC
src/renderer/   the board engine, the queues, the panel
tools/          asset build, icon build, packaging
```

| Module | Does |
| --- | --- |
| `shared/layout.mjs` | text → pages: fold to the charset, wrap, align, paginate |
| `shared/timing.mjs` | the motion model, shared so animation and API estimates can't drift |
| `shared/regions.mjs` | row bands: partition the grid, map lines to tile targets |
| `renderer/flipboard.js` | the engine: tiles, frames, the animation loop |
| `renderer/track.mjs` | one queue, dwell clock and watchdog **per band** |
| `renderer/controller.mjs` | routes messages to bands; owns geometry and status |
| `renderer/panel.mjs` | what the control panel shows, worked out purely |
| `renderer/app.js` | the panel itself: DOM, keyboard, settings |
| `main/server.js` | REST + SSE, all request validation |
| `main/bridge.js` | main → renderer calls, which Electron doesn't provide |

A message's journey, end to end:

```
POST /api/message
  → server.js          validates, stamps source:'api'
  → bridge.js          main → renderer, correlated by id
  → controller.mjs     picks the band (default: main)
  → track.mjs          lays it out, queues it, starts the dwell clock
  → flipboard.js       retargets that band's tiles; rAF until they settle
```

---

## How the rendering works

**The art is the spec.** Each transition — `A`→`B`, `9`→`.`, `)`→`blank` — is a
separate piece of source art. `tools/build_assets.py` stacks each one's frames
into a vertical WebP strip and writes `assets/manifest.json` describing the ring.

At runtime a tile is **one integer**: which state it is resting on. That index is
both the character and the strip that leaves it:

```
at rest on state i    →  strips[i], frame 0
flipping i → i+1      →  strips[i], frames 1..9
```

The whole board is one canvas, one `drawImage` per tile per frame. A 20×8 board
is 160 draws. When every tile has landed the animation loop **stops completely**
and the app uses no CPU until something changes.

Three details that took real work, and that you would otherwise rediscover the
hard way:

- **The landing seam.** Every source GIF was rendered independently, so one
  file's "settled A" differs from the next file's by about a pixel. Chaining them
  naively makes tiles *twitch* at the exact moment they come to rest. The build
  fixes it by replacing each transition's final frame with frame 0 of the next
  one, displacing the discrepancy onto a moving frame where nobody can see it.
- **Retargeting mid-flight never snaps.** A tile already moving finishes its
  current step, then carries on forward to the new target.
- **Settling is per band, not per board.** Each band reports coming to rest
  independently. With a single whole-board callback, a footer updating on its own
  clock would reset the hold on whatever is playing above it — and a fast enough
  footer would stop the main queue advancing at all.

---

## Making it your own

### Change the characters

**Nothing about the character set is hardcoded.** The build walks the filenames,
derives the ring, and asserts that it closes and covers every transition. Supply
art named `FROM-TO.gif` for a closed cycle and everything downstream follows —
layout, the API's advertised charset, the substitution table, the estimates.

```bash
python3 tools/build_assets.py --src ./my-art --size 128
```

Add lowercase, use a different alphabet, cut it down to digits and a colon for a
clock — the app does not need to know. Use `--size` to match how big your tiles
actually render; the default 256 px is usually 4× more detail than a wall board
shows, and every frame stays decoded in memory (~105 MB at 256, ~28 MB at 128).

Filenames use word tokens where a character is filesystem-hostile: `blank`,
`fullstop`, `comma`.

### Change how it moves

Everything is in `shared/timing.mjs` and live-tunable from the panel under
**Motion**, or over `PATCH /api/config`:

| | |
| --- | --- |
| `fastStepMs` | how fast it scrolls |
| `landStepMs` | how slowly it arrives — this is what reads as *mechanical* |
| `easeSteps` | how many trailing steps decelerate |
| `sweepMs` | total time from the first tile moving to the last, so the wave takes the same wall-clock time on any grid |
| `staggerMode` | the shape of that wave: `diagonal`, `column`, `row`, `random`, `none` |

### Change the layout rules

`shared/layout.mjs` is where text becomes pages — the folding table (`&` →
` AND `, `?` → `.`, quotes dropped), word wrap, alignment, pagination. It is pure
and has 37 tests, so it is the safest file in the repo to experiment in.

### Change the shape of the board

`shared/regions.mjs` partitions the grid into bands. It already takes an
arbitrary ordered list, so a header strip is a config key and an id — not a
redesign. Two bands are exposed today because two is what was needed.

### Drive it from something else

A feed, a build status, a now-playing hook — all `POST /api/message`. There is a
`GET /api/events` SSE stream if you want to react to the board rather than only
write to it. [docs/BOARD-API.md](docs/BOARD-API.md) is the full contract, and any
running board serves it at `GET /AGENTS.md` so you can point an LLM straight at
the machine.

For live tuning, `window.flipboard` and `window.controller` are exposed to the
devtools console:

```js
controller.configure({ cols: 44, rows: 6, footerRows: 2, sweepMs: 450 })
controller.enqueue('HELLO', { region: 'footer', repeat: true })
```

---

## Conventions worth keeping

These are the rules the existing code follows. Break them deliberately, not by
accident.

- **Pure logic goes in a module a test can import.** `app.js` reads `document` at
  module scope and can never be unit-tested, which is exactly why `panel.mjs`
  exists. If you find yourself writing a decision inside `app.js`, that is the
  signal.
- **Reject, don't ignore.** An option that doesn't apply gets a `422` naming the
  field and why. Silently dropping it reads as a bug from the caller's side.
- **Validate shape in main, existence in the renderer.** Whether `footer` exists
  depends on the current geometry, which only the renderer knows — so it answers,
  naming the bands that do exist. One source of truth beats a list that drifts.
- **Errors cross the bridge as values, not exceptions.** `contextBridge` copies a
  thrown `Error` between isolated worlds and strips its own properties, so a
  `status` of 422 arrives as `undefined` and gets served as a 500. The dispatch
  returns `{ok, value}` or `{ok: false, error}` instead.
- **Comments say *why*.** The code already says what.

## Testing

```bash
npm test                          # everything
node --test tests/layout.test.mjs # one file
```

`node --test` only — no framework, no mocking library, no jsdom. The controller
and panel suites share `tests/stub-board.mjs`, a fake board that resolves its
bands with the *real* `regions.mjs`, so band behaviour is exercised rather than
described. `tests/routes.test.mjs` drives real HTTP against `createServer` with
the bridge stubbed; `server.js` has no Electron dependency of its own, which is
what makes that possible.

**`flipboard.js` has no automated coverage** — it needs a canvas. That is the
honest gap, and it is why anything worth testing gets extracted out of it.

## Where the bodies are buried

Read [SPEC.md](SPEC.md) §14 for what has been verified by hand and §15 for known
limitations. The short version of what will bite you:

- A band whose queue has drained still shows its last page. It reports
  `showing: null` and `holding: {...}` — treat "nothing playing" and "nothing on
  the glass" as different states, or your readout will say *idle* while the board
  plainly says otherwise.
- `flush` drops what is *pending*. A repeating message that is currently showing
  is not pending, so flush will not stop a cycle — `clear` will.
- `repeat` cannot be switched off once a message is queued.
