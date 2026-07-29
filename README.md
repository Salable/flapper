# Flapper

A desktop **split-flap board** — the kind on old airport departure gates. It
flips from whatever it's currently showing, scrolls forward through the character
set, and lands on the text you ask for, using real per-transition frame art
rather than a simulation of it.

![Flapper flipping through a sequence of messages: a wordmark, prose wrapping
across the grid, the board splitting into two independently-driven bands, a
paginated message, a departures frame placed cell by cell, and an urgent message
pre-empting the queue before the displaced one resumes](docs/flapper.gif)

*Everything above is driven over HTTP. The bottom strip is a second band running
its own queue on its own clock — note it changes out of step with the rows above
it. Near the end, `FIRE DRILL` jumps the queue and what it displaced comes back
where it left off.*

**This is a worked example, not a product.** It's here to be read, forked and
rebuilt — small enough to get through in an afternoon, complete enough to put on
an actual wall.

- **8 rows × 20 columns** by default, resizable to 80 × 40
- **Split the board into bands** — a rotating queue up top, a standing strip
  below, each with its own queue and clock
- **A REST API** with an [agent guide](docs/BOARD-API.md) served live from the
  board itself, so you can point an LLM at the machine and it learns the contract
- **No runtime dependencies.** Electron and a packager are the only devDependencies
- **167 tests**, no framework, no Electron in the loop

| I want to… | Read |
| --- | --- |
| install it and put text on it | this file |
| build my own version | [AGENTS.md](AGENTS.md) |
| drive a board over HTTP | [docs/BOARD-API.md](docs/BOARD-API.md) |
| know why it's built this way | [SPEC.md](SPEC.md) |

## Install

Grab the latest **[release](https://github.com/Salable/flapper/releases/latest)**
— a universal macOS build, Apple Silicon and Intel, ~213 MB zipped. Unzip and
drag **Flapper.app** to Applications.

**macOS will refuse to open it the first time.** Releases are ad-hoc signed —
there's no Apple Developer ID on the build — so Gatekeeper blocks it with *"Apple
could not verify Flapper is free of malware."* That's expected, not a broken
download. Either:

- **System Settings → Privacy & Security**, scroll to Security, find "Flapper was
  blocked", click **Open Anyway**, authenticate, then open it again. Once per
  machine.
- Or, after unzipping:

  ```bash
  xattr -dr com.apple.quarantine /Applications/Flapper.app
  ```

Removing that step needs a Developer ID certificate and notarisation, which means
a paid Apple Developer Program membership. With one, set `osxSign`/`osxNotarize`
in [tools/pack.mjs](tools/pack.mjs).

## Run from source

```bash
npm install && npm start
```

The generated tile art is committed, so there's no build step before your first
run. You only need `npm run build:assets` (Python 3 + Pillow) when you change the
art — see [Making it your own](AGENTS.md#making-it-your-own).

## Using it

The board starts blank, flips in a greeting, and then holds. Press <kbd>C</kbd>
to open the control panel — a **queue console**:

```
 MAIN  FOOTER   [ Add to footer — Enter to send ]      ADD   •••
 MAIN    6 rows  BRAVO                        +3   FLUSH  CLEAR
   1  CHARLIE                                        ↻ · API
   2  DELTA                                          ↻ · API
 FOOTER  2 rows  holding NOW PLAYING             FLUSH  CLEAR
 ▸ BOARD   ▸ MOTION   ▸ SAVED LINES
```

Type and press <kbd>Enter</kbd> to put a message on the board. If the board has
more than one band, the chips on the left pick which one it goes to; with a
single band they don't appear at all. `•••` reveals priority, hold and repeat,
and opens itself whenever any of them is set to something non-default.

Each band gets a card showing what it's doing — **playing**, **holding** (its
queue drained but its last page is still up), or **blank** — what's waiting, and
two buttons. **Flush** drops what's waiting; **Clear** stops the band. That
distinction matters: a repeating message isn't "waiting", so Clear is the only
thing that stops a cycle.

Board geometry, motion and a textarea of saved lines live behind the collapsed
disclosures. Everything persists between launches.

| Key | Action |
| --- | --- |
| <kbd>C</kbd> | show / hide the controls |
| <kbd>Space</kbd> | add the saved lines to the selected band |
| <kbd>Esc</kbd> | clear every band |
| <kbd>F</kbd> | fullscreen |

Characters the tiles can show: `A–Z`, `0–9`, `.` `,` `!` `(` `)` and blank.
Lowercase is uppercased; anything else flips to blank and is reported under the
panel.

## Controlling it over HTTP

The app serves a REST API on `http://127.0.0.1:4747` — local only, no auth, no
setup. Put text on the board:

```bash
curl -X POST http://127.0.0.1:4747/api/message -H 'content-type: application/json' -d '{"text":"NOW BOARDING GATE 14"}'
```

See what it would do without displaying it — useful because the tiles cannot draw
every character you might send:

```bash
curl -X POST http://127.0.0.1:4747/api/preview -H 'content-type: application/json' -d '{"text":"Café R&D: 50% done?"}'
```

That reports `CAFE R AND D. 50 DONE.` along with every substitution it made and
the `%` it had to drop. Reshape the board:

```bash
curl -X PATCH http://127.0.0.1:4747/api/config -H 'content-type: application/json' -d '{"cols":20,"rows":8,"align":"left","valign":"top"}'
```

Grid size, alignment, wrap mode, motion and dwell are all adjustable this way, and
from the control panel — both drive the same board. Accepted range is 1–80 columns
by 1–40 rows.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | discovery: points at the agent guide |
| `GET` | `/AGENTS.md` | instructions for an agent driving the board |
| `GET` | `/api/health` | liveness and version |
| `GET` | `/api/capabilities` | charset, grid, accepted values, limits |
| `GET` | `/api/status` | what's showing, the rendered rows, the queue |
| `GET` | `/api/events` | SSE stream of state, pushed on change |
| `POST` | `/api/message` | queue text, or an explicit grid of rows |
| | | `priority: next \| now` to jump the queue |
| | | `region: main \| footer` to pick a band |
| | | `repeat: true` to cycle it in that band |
| `POST` | `/api/preview` | lay out without displaying |
| `POST` | `/api/clear` | flush and blank; optional `region`, else every band |
| `DELETE` | `/api/queue` | flush pending, leave the current message playing; optional `region` |
| `PATCH` | `/api/config` | grid, `footerRows`, alignment, wrap, motion, dwell, per-band `regions` |

### Driving individual cells

Send `rows` instead of `text` to place every character yourself — no wrapping,
no alignment, no pagination:

```bash
curl -X POST http://127.0.0.1:4747/api/message -H 'content-type: application/json' -d '{"rows":["....................","  DEPARTURES  0900  ","  GATE 14   ON TIME ","...................."]}'
```

One input character per tile, one string per board row. Characters are still
folded onto what the tiles can draw, but only in width-preserving ways, so cell
*i* of your string is always cell *i* of the board.

### Jumping the queue

Messages play in the order they arrive. `priority` overrides that: `next` puts a
message at the head of the queue, and `now` displays it immediately.

```bash
curl -X POST http://127.0.0.1:4747/api/message -H 'content-type: application/json' -d '{"text":"FIRE DRILL","priority":"now"}'
```

A pre-empted message isn't lost — it returns to the head of the queue and
resumes on the page it was showing, so playback continues where it left off.

### Splitting the board

Reserve rows at the bottom and they become a second band with its own queue,
playing independently of the one above — a standing strip while other content
rotates:

```bash
curl -X PATCH http://127.0.0.1:4747/api/config -H 'content-type: application/json' -d '{"footerRows":2}'
curl -X POST http://127.0.0.1:4747/api/message -H 'content-type: application/json' -d '{"text":"NOW PLAYING. THE STROKES","region":"footer"}'
```

A message's row budget is its band, so read `grid.mainRows` from `/api/status`
rather than `rows`. `footerRows: 0` (the default) means one band and behaviour
identical to a board that never had the concept. A drained queue holds its last
page, so one message is enough to leave a footer standing.

Each band plays its own queue in order, laying every message into pages that fit
that band and holding each page before the next begins. `repeat: true` sends a
message back to the end of its band's queue when it finishes, so a band can cycle
— and because it keeps its id, a cycling band is the same few messages going
round. `DELETE /api/queue` won't stop a cycle (a showing message isn't pending);
`POST /api/clear` with that band's `region` will.

### Pointing an agent at it

```bash
curl http://127.0.0.1:4747/AGENTS.md
```

Returns [docs/BOARD-API.md](docs/BOARD-API.md) — the whole contract in one
document: how to connect, why there is nothing to authenticate with, what the
tiles can and cannot draw, both input modes, bands, queue behaviour, and the
endpoint list. The served copy has its example URLs rewritten to whatever address
you asked, and a trailing block stating that instance's base URL, whether it is
reachable beyond this machine, and whether the display is ready.

It tells an agent to **ask you for a URL** rather than scan for one when
`127.0.0.1:4747` doesn't answer — a board is usually on another machine — and to
ask again if handed `0.0.0.0`, since that's a bind address rather than a
reachable one.

### Letting other machines reach it

Press <kbd>C</kbd> and click **Local only** — it switches to **Public** and
rebinds the API to all interfaces. Click again to restrict it. The choice
persists across restarts.

**There is no authentication.** While Public is on, anyone who can reach the port
can put anything on the board. That's a deliberate trade for a display on a
trusted network — don't enable it on one you don't trust, and don't forward the
port to the internet.

The panel shows `0.0.0.0` in Public mode, which is the bind address, not
something you can connect to. From another machine use this machine's LAN
address:

```bash
ipconfig getifaddr en0
```

```bash
curl -X POST http://192.168.1.42:4747/api/message -H 'content-type: application/json' -d '{"text":"HELLO FROM AWAY"}'
```

To fix the mode at launch instead — which also disables the button, so a kiosk
script can't be overridden from the panel:

```bash
FLAPPER_HOST=0.0.0.0 npm start
```

| Setting | Env | Flag | Default |
| --- | --- | --- | --- |
| enable | `FLAPPER_SERVER=0` | `--no-server` | on |
| host | `FLAPPER_HOST` | `--host=` | `127.0.0.1` |
| port | `FLAPPER_PORT` | `--port=` | `4747` |
| CORS origin | `FLAPPER_CORS_ORIGIN` | `--cors=` | none (off) |

## Tests

```bash
npm test
```

167 tests over the testable modules — text layout, board regions, the queue
controller, the panel view model, the REST routes, server config, and persisted
settings — with no Electron in the loop. The controller and panel tests run
against a stub board with mocked timers; the route tests drive real HTTP against
`createServer`.

CI runs them on every push. Tagging `v*` builds the macOS app on a runner and
publishes a release, but only after the suite passes, the tag matches
`package.json`, and the bundle is checked for its signature, both architectures,
and that the source art hasn't leaked into it.

## Building it yourself

```bash
npm run pack
```

Produces `dist/Flapper-darwin-universal/Flapper.app` and a ready-to-send
`dist/Flapper-<version>-universal.zip` (~213 MB). Needs `assets/` and
`build/icon.icns`, both committed; the script checks and tells you if they're
missing. `npm run pack -- --arch=arm64` builds for Apple Silicon only, at
roughly half the size.

**Send the zip the script made, don't re-zip the .app.** Electron bundles contain
symlinks inside `Electron Framework.framework`; `zip -r` dereferences them, which
bloats the archive and invalidates the code signature. The script uses `ditto`,
which preserves them. Finder's "Compress" is also safe.

## How it's built

The short version: each transition between two characters is a separate piece of
frame art, stacked into a sprite strip at build time. A tile at runtime is one
integer — which state it's resting on — and that index is both the character and
the strip that leaves it. Tiles only ever travel **forward** through a closed
ring of 42 states, which is the constraint every other design decision follows
from.

[AGENTS.md](AGENTS.md) covers the components and how to swap in your own
character set. [SPEC.md](SPEC.md) has the engineering detail: the frame-level
contract with the art, the timing model, the band system, and the reasoning
behind the trade-offs.
