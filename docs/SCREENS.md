# Flapper — Screen & Functionality Audit

*Baseline of the **2.0** release (commit `b713c89`, 2026-08-20), kept as the
before-picture of the 3.0 rework. Since then: the queue moved server-side,
the on-board panel and keyboard are gone (Settings is the control room),
bands are paused, /docs exists, and findings 2, 3, 4, 6 (partially), 7 and 13
(queue cap + spoof-proof state) have been addressed. A fresh survey follows
the 3.0 feedback phase.*

---

## The app in one paragraph

Flapper is a multi-user split-flap display service. A signed-in user provisions
**boards** from a dashboard; each board is a URL (`/b/{slug}`) that renders a
canvas of mechanical split-flap tiles on any screen, and an API base
(`/api/b/{slug}`) that anything speaking HTTP can drive with the board's key.
Displays stay in sync through a per-board command stream (Redis, consumed over
SSE) and post their state back, so the API can always say what is literally on
the glass. Boards are public (anyone with the URL can watch) or private (key or
owner login required even to view).

---

## Screen inventory

### 1. Landing — `/`

| | |
| --- | --- |
| Access | public; signed-in users are redirected to `/dashboard` |
| Job | pitch + route to signup/login |

FLAPPER wordmark, one-paragraph pitch, **Create account** / **Sign in** CTAs,
a one-line feature note (per-board URL, API key, AGENTS.md, privacy). Static —
no imagery, no demo board, no motion.

### 2. Sign up / Sign in — `/signup`, `/login`

| | |
| --- | --- |
| Access | public |
| Job | email + password auth (Better Auth) |

Shared `AuthForm`: name (signup only), email, password (min 8). Inline error
line. Honors `?next=` for post-auth redirect (used by gated pages). Cross-links
between the two modes.

**Not present:** password reset (no email provider configured), email
verification, OAuth providers, "show password", any profile management after
signup.

### 3. Dashboard — `/dashboard`

| | |
| --- | --- |
| Access | session required; redirects to `/login?next=/dashboard` |
| Job | board CRUD home |

- **App bar** (shared chrome): FLAPPER brand → dashboard; user name + Sign out.
- **Create row**: optional name field + **New board** → creates with a
  generated slug (`amber-falcon-42` style) and lands on the board's settings so
  the key is seen immediately.
- **Board card grid** (`auto-fill minmax(260px, 1fr)`): each card shows name,
  `/b/{slug}`, `public|private · created YYYY-MM-DD`; actions **Open**,
  **Settings**, **Delete** (dashed ghost button, native `confirm()`).
- **Empty state**: short explainer + prompt to create.

**Not present:** any live signal on cards (is a display connected? what's
showing? queue depth), search/sort for many boards, rename from the card,
board thumbnails/previews.

### 4. Board display — `/b/{slug}`

| | |
| --- | --- |
| Access | public boards: anyone. Private: owner session or `?key=` |
| Job | the product — a full-bleed split-flap canvas, no chrome |

Server component resolves slug → board, gates privacy, then mounts the
client-only engine (no SSR). States:

- **Loading**: "LOADING TILES" + progress bar while 42 WebP strips decode.
- **Failure**: overlay with the fetch error.
- **Greeting**: flips in `FLAPPER` if nothing has driven the board in 500ms.
- **Private gate** (anon, no/bad key): "This board is private" + key hint +
  Sign in CTA.
- **Gone note**: if the slug 404s after load (renamed/deleted board), a
  persistent hint replaces "Press C for controls".
- **Hint**: "Press C for controls", fades after ~3s.

Wiring: EventSource on `.../commands/stream` (auto-reconnect with
`Last-Event-ID`; `?key=` appended on private boards), throttled state POSTs
(≤1/500ms) plus a 5s heartbeat that keeps `/status.boardReady` true.
Two tabs on one board = mirrored displays (state posts last-writer-wins).

### 5. Control panel — overlay on the board (press `C`)

The queue console, unchanged in spirit from the desktop app:

- **Compose**: band picker chips (only when >1 band), text field (Enter
  sends), **Add**, `•••` options (priority queue/next/now, hold override,
  repeat) — options auto-open when any is non-default so nothing acts
  invisibly.
- **Band cards** (one per band): name, rows, now-showing/holding, queue count,
  per-message rows with priority/source badges; **Flush** (drop pending) and
  **Clear** (stop + blank; the only way to stop a repeat).
- **+ Add a footer band** (single-band boards only).
- **Board** section: columns, rows, footer rows, hold, align, valign, wrap.
- **Motion** section: scroll speed, landing, sweep, sweep shape, always flip.
- **Saved lines**: persistent playlist (localStorage), **Add all** as
  repeating messages.
- **Access**: API base + AGENTS.md pointer; owners get a **Settings** link,
  non-owners are told the key lives with the owner.
- **Footer**: status line (diagnostics of last action) + key legend.

Keyboard: `C` toggle panel · `Enter` open panel · `Space` add saved lines ·
`Esc` clear every band (the panic key) · `F` fullscreen.

Display-local settings (grid, motion, saved lines) persist per **browser** in
`localStorage`; API `configure` commands update the live board and the stored
board config, but a display's own saved defaults apply on next load — two
sources of truth that can drift.

### 6. Board settings — `/b/{slug}/settings`

| | |
| --- | --- |
| Access | owner only; anon → login redirect; non-owner → polite block page |
| Job | identity, privacy, access, deletion |

- **Identity**: name; slug (lowercase enforced, validated 3–40 chars
  `a-z0-9-`, reserved words blocked) with an explicit warning that renames
  move the URL and API base and 404 open displays. Save enabled when dirty.
- **Privacy**: public/private toggle with plain-language consequence text; for
  private boards, a ready-made **display URL** (`?key=...`) with copy button
  and a warning that the key is visible in logs/history.
- **Access**: API key masked by default (Reveal / Copy / **Regenerate** with
  a confirm that the old key dies instantly), the full curl example, the
  AGENTS.md link.
- **Danger**: Delete (native `confirm()`), → dashboard.

**Not present:** board display config (cols/rows/motion live only in the
on-board panel — a "settings" split across two places), transfer of ownership,
multiple keys or scoped keys, activity/audit info.

### 7. System pages

- **404 / error**: default unstyled Next.js pages — off-brand.
- **No favicon / app icons** beyond the Next default.

### 8. Desktop shell — `desktop/`

Electron kiosk (~100 lines): loads the service URL, remembers the last
`/b/{slug}` navigated to (including `?key=` for private boards), single
instance, keeps the display awake, `--kiosk` / `--url=` / `FLAPPER_URL`.
No preload, no IPC, no local server. Packaged via `desktop/pack.mjs`
(universal macOS .app, ad-hoc signed).

---

## The API surface

Base per board: `/api/b/{slug}`. Auth classes: **read** (open on public
boards; key or owner session on private), **key** (`authorization: Bearer`),
**owner** (session).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/boards` | session | create (name?, slug?) → full board incl. key |
| GET | `/api/b/{slug}` | read | discovery |
| PATCH | `/api/b/{slug}` | owner | name / slug / private |
| DELETE | `/api/b/{slug}` | owner | delete board + realtime channel |
| POST | `/api/b/{slug}/key` | owner | rotate key |
| GET | `.../health` | read | liveness + `boardReady` (display seen <10s) |
| GET | `.../capabilities` | read | charset, grid, limits (headless Controller) |
| GET | `.../status` | read | last snapshot + `stale`/`updatedAt`; `lines` = the glass |
| GET | `.../events` | read | SSE state stream (observers) |
| POST | `.../message` | key | queue text/rows → 202 (validated + streamed) |
| POST | `.../preview` | read | server-side layout + diagnostics, no display needed |
| POST | `.../clear` | key | stop + blank (optional region) |
| DELETE | `.../queue` | key | drop pending (optional region) |
| PATCH | `.../config` | key or owner | grid/motion/dwell/per-band; stored + streamed |
| GET | `.../commands/stream` | read | SSE command feed (the display's inbox) |
| POST | `.../state` | read | display posts its snapshot |
| GET | `.../AGENTS.md` | read | full agent guide, board URLs baked in |

Contract notes: `202` = validated-and-queued, never proof of display;
`/status.stale` is connectivity truth. 422s name the field. Rows mode is
width-preserving. Streams end themselves before Vercel's function window;
EventSource reconnects with cursor. Root `/AGENTS.md` serves a "you need a
board URL" guide.

## Data model

**Postgres** (Neon prod / PGlite dev): Better Auth `user`, `session`,
`account` (with 1.7 `issuer`), `verification`; `boards` — id (16-char base32,
the Redis key), unique slug, name, ownerId (cascade), private, **apiKey
(plaintext by design: settings must show it; rotation is recovery)**, config
jsonb, timestamps.

**Redis** (Upstash prod / memory dev): per board `commands` stream
(MAXLEN ~1000, 30-day sliding TTL) + `state` snapshot. Purely ephemeral;
Postgres is the durable record.

## The realtime loop

```
curl/agent ──POST message──▶ API (validate, key) ──XADD──▶ Redis stream
                                                              │ poll 750ms
display tab ◀────────── SSE commands/stream ◀─────────────────┘
     │ controller/canvas flips
     └─POST state (≤1/500ms + 5s heartbeat) ──▶ Redis snapshot ──▶ /status, /events
```

---

## Audit findings (inputs for the new course)

**Product / UX**
1. Landing page doesn't show the product — no live demo board, no motion, no
   screenshot. The best sales asset (the flip) is one route away and unused.
2. Dashboard cards are inert — no connected/stale indicator, no "now showing",
   no preview; you must open each board to know anything.
3. "Settings" is split: identity/access on `/settings`, display config
   (grid/motion) only in the on-board panel. Defensible, but never explained
   to the user anywhere.
4. Display-local `localStorage` settings vs. server-stored board config can
   drift; a fresh display may not look like the last one.
5. No onboarding after signup beyond an empty dashboard; no "open this on your
   display" step after creating a board.
6. Native `confirm()` for destructive actions; no styled modals or undo.
7. Default Next.js 404/error pages; no favicon or brand assets.
8. Mobile: board + panel work at phone width but the panel is dense; the
   dashboard is fine.

**Accounts & sharing**
9. No password reset or change, no email verification (no email provider
   wired), no profile page; sign-out only lives on the dashboard.
10. One owner per board — no sharing, no teams, no transfer; a colleague can
    watch but never manage.
11. Verification loose end: `nriley@adaptavist.com` is held by a throwaway
    account (delete the `user` row in Neon to reclaim).

**Access model**
12. One key per board, all-or-nothing: the private display URL (`?key=`)
    grants *write* as well as view. No scoped keys (display-only, write-only),
    no multiple keys, no last-used visibility.
13. No rate limiting or abuse controls on the API; the queue cap (500) is the
    only backpressure.

**Platform**
14. SSE polling costs ~1.3 Upstash commands/sec per connected display while
    active (backs off idle); fine now, worth watching at fleet scale.
15. No message history or replay beyond the 1000-entry stream; no analytics.
16. Desktop shell is macOS-packaged only; no Windows/Linux builds, no
    auto-update.
