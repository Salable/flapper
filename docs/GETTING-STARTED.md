# Getting started

Flapper puts a mechanical split-flap departure board on any screen and lets
you drive it from anywhere.

## 1. Create a board

Sign in and hit **New board** on the dashboard. Every board gets:

- a **display URL** — `/b/your-slug` — open it on the screen that should show
  it: a browser tab, a TV, a kiosk. The page is just the tiles; there is
  nothing to configure on the display itself.
- a **settings page** — `/b/your-slug/settings` — the control room: compose
  messages, manage the queue, tune the display, hold the API key.
- an **API base** — `/api/b/your-slug` — for driving it from software.

## 2. Put something on it

From **Settings → Compose**: type a message, choose a priority, optionally
mark it **Loop**, and add it to the queue. The board plays the queue in order;
loop items return to the back instead of leaving, so a handful of looping
messages makes a rotating display that runs forever.

Or over HTTP, with the API key from Settings → Access:

```bash
curl -X POST https://flapper-tan.vercel.app/api/b/YOUR-SLUG/message \
  -H 'authorization: Bearer YOUR_API_KEY' \
  -H 'content-type: application/json' \
  -d '{"text":"NOW BOARDING GATE 14","loop":true}'
```

## 3. The queue is the board

The queue lives on the server, not the display. That means:

- you can stack up messages while no screen is connected — the board plays
  them when one opens;
- editing, reordering, and removing happen in Settings (or the API) and every
  connected display follows;
- when the queue drains, the last message **stays on the glass** — a single
  message is enough for a standing sign;
- two screens opening the same board show the same thing.

## 4. Keys and privacy

The **API key** (Settings → Access) authorizes every write. Anyone with the
board's URL can *watch* a public board; making it **private** gates viewing
behind the key (`?key=…` on the display URL, for kiosks) or your login.
Regenerating the key instantly revokes the old one everywhere.

## 5. For agents

Every board serves a machine-oriented guide at
`/api/b/YOUR-SLUG/AGENTS.md` — the full REST contract with the board's own
URLs baked into the examples. Point an agent at it and it knows how to drive
the sign.
