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
- a **settings page** — `/b/your-slug/settings` — the control room, in
  three tabs: **Queue** (compose and manage), **Display** (a drag-and-scale
  layout picker plus grid and motion), **General** (identity, privacy, the
  API key, pause & export, delete).
- an **API base** — `/api/b/your-slug` — for driving it from software.

## 2. Put something on it

From **Settings → Queue**: on a live board, type a message, pick a
priority, optionally **Loop** it. On a scheduled board, compose *onto the
clock* — choose the schedule, watch the live "next occurrences" preview,
and set how long it shows (one read-through, a fixed time, or *until its
next trigger* for a standing sign).

Or over HTTP, with the API key from Settings → General:

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

## 4. Keys and privacy

The **API key** (Settings → General) authorizes every write. Anyone with
the board's URL can *watch* a public board; making it **private** gates
viewing behind the key (`?key=…` on the display URL, for kiosks) or your
login. Regenerating the key instantly revokes the old one everywhere.

## 5. For agents

Every board serves a machine-oriented guide at
`/api/b/YOUR-SLUG/AGENTS.md` — the full REST contract **for that board's
type**, with its URLs baked into the examples. Point an agent at it and it
knows how to drive the sign. And if you want a kind of board that doesn't
exist yet, [BOARD-TYPES.md](/docs/board-types) is the recipe for building
one.
