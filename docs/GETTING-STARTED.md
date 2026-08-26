# Getting started

Flapper puts a mechanical split-flap departure board on any screen and lets
you drive it from anywhere.

## 1. Create a board — and pick its type

Sign in and hit **New board** on the dashboard. The first choice is what
kind of board it is:

- **Live queue** — a rolling queue that plays as it arrives. Holds a
  handful of messages; adding past the cap rolls the oldest waiting one
  off. Loop items rotate forever; one message makes a standing sign.
- **Scheduled** — messages on a clock, down to the second: every N
  minutes, hourly at :15, daily at 09:00, once at a moment. A **fallback
  message** stands in the gaps.
- **Shared screens** — a scheduled board built for many displays: open the
  same URL everywhere and every screen shows the same thing at the same
  moment, synced on the server clock. Nothing to pair.

Every board gets:

- a **display URL** — `/b/your-slug` — open it on the screen that should
  show it. The page is just the tiles; <kbd>F</kbd> is fullscreen,
  <kbd>Esc</kbd> blanks in place.
- a **manage page** — `/b/your-slug/manage` — the control room, in
  three tabs: **Settings** (identity, design & shape, privacy, the API key,
  pause & export, delete), **Board** (the rotation — or, on a scheduled/
  shared board, the schedule editor), and, on a live board only,
  **Interruptions** (save a named interrupter, then fire it to cut to
  the front).
- an **API base** — `/api/b/your-slug` — for driving it from software.

## 2. Put something on it

From **Board**: on a live board, **+ Slide** adds a blank slide to the
rotation — type into it, set how long it holds, done; every slide in the
rotation loops back round by default, so removing it is what ends it. For a
one-off instead, use the **Interruptions** tab: save a name, its text, and
how long it holds, then fire it — it cuts to the front, plays once, and
doesn't join the rotation. On a scheduled board, compose *onto the
clock* — choose the schedule, watch the live "next occurrences" preview, and
set how long it shows (one read-through, a fixed time, or *until its next
trigger* for a standing sign).

Or over HTTP, with the API key from the Settings tab:

```bash
curl -X POST https://flapper-tan.vercel.app/api/b/YOUR-SLUG/message \
  -H 'authorization: Bearer YOUR_API_KEY' \
  -H 'content-type: application/json' \
  -d '{"text":"NOW BOARDING GATE 14","loop":true}'
```

On a scheduled board, add a `schedule`:

```bash
curl -X POST https://flapper-tan.vercel.app/api/b/YOUR-SLUG/message \
  -H 'authorization: Bearer YOUR_API_KEY' \
  -H 'content-type: application/json' \
  -d '{"text":"LUNCH IS SERVED","schedule":{"kind":"daily","at":"12:00","durationMs":60000}}'
```

## 3. The queue is the board

The queue lives on the server, not the display. That means:

- you can stack up messages while no screen is connected — the board plays
  them when one opens;
- editing and removing happen in Settings (or the API) and every connected
  display follows;
- on a live board, when the queue drains the last message **stays on the
  glass** — a single message is enough for a standing sign; on a clock
  board the fallback message stands between slots;
- two screens opening the same board show the same thing — and a **shared
  screens** board makes that a promise, on the clock, for as many screens
  as you like.

## 3½. Keep the display in the foreground

A board is a browser tab drawing on a canvas, and **a browser tab in the
background does not animate.** Every browser suspends
`requestAnimationFrame` for hidden tabs — the flip halts mid-turn with
half-flipped tiles, while the tab's timers keep running and the board
still reports as connected. So for a wall:

- give the display its own window, full-screen, and leave it in front — a
  screensaver, an OS window switch, or another tab on top all count as
  "background" in most browsers;
- or run the **desktop kiosk shell** (`cd desktop && npm start`), which
  keeps one board in front on purpose;
- and watch for **frozen** on the dashboard card (amber dot) or
  `frozen: true` from `GET /status` — it means a display is connected but
  cannot draw. Bringing the tab to the front is the fix; it resumes where
  it stopped.

## 4. Keys and privacy

The **API key** (Settings tab) authorizes every write. Anyone with
the board's URL can *watch* a public board; making it **private** gates
viewing behind the key (`?key=…` on the display URL, for kiosks) or your
login. Regenerating the key instantly revokes the old one everywhere.

## 5. Connect Claude or ChatGPT

Flapper is an MCP server. The fastest way to put something on the glass is
to hand the board to an AI and ask:

1. Copy the MCP URL from the dashboard — it is
   `https://flapper-tan.vercel.app/api/mcp` for this deployment, one URL for
   every board.
2. Add it as a connector: **claude.ai / Claude Desktop** → Settings →
   Connectors → *Add custom connector*; **ChatGPT** → Settings → Connectors
   (developer mode); **Claude Code** →
   `claude mcp add --transport http flapper https://flapper-tan.vercel.app/api/mcp`.
3. Sign in to Flapper when the browser opens, allow the connection, and it
   can list your boards, create new ones, preview text against the
   character set, and post to any board you own.

To give an agent **one board only** — a kiosk script, a CI job, a friend —
use that board's API key as the bearer token instead of signing in. The
exact `claude mcp add … --header` command is on the board's Settings tab,
and it works for any MCP client that can send a header.

## 6. For agents over plain HTTP

Every board also serves a machine-oriented guide at
`/api/b/YOUR-SLUG/AGENTS.md` — the full REST contract **for that board's
type**, with its URLs baked into the examples. Point an agent at it and it
knows how to drive the sign. And if you want a kind of board that doesn't
exist yet, [BOARD-TYPES.md](/docs/board-types) is the recipe for building
one.
