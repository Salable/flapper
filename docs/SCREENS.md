# Flapper — Screen & Functionality Survey (4.0)

*The state of the app after the 4.0 board-types iteration (August 2026).
The 2.0 baseline this replaces lives in git history (`b713c89`); what was
removed on the way and why lives in `docs/attic/README.md`.*

---

## The app in one paragraph

Flapper is a multi-user split-flap display service. A signed-in user creates
**boards of a type** — live queue, scheduled, or shared screens — from a
dashboard; each board is a URL (`/b/{slug}`) that renders a canvas of
mechanical split-flap tiles on any screen, and an API base (`/api/b/{slug}`)
that anything speaking HTTP can drive with the board's key. The type packages
playback: live boards play a rolling queue in order; clock boards (scheduled,
shared) evaluate a schedule as a pure function of the server clock, which is
how any number of screens stay in step with nothing to pair. The whole UI is
built on the Flapper design system (`docs/DESIGN-SYSTEM.md`); board types are
an extension point with a written contract (`docs/BOARD-TYPES.md`).

---

## Screen inventory

### 1. Landing — `/`

| | |
| --- | --- |
| Access | public; signed-in users are redirected to `/dashboard` |
| Job | pitch + route to signup/login |

Tile-styled FLAPPER wordmark (the MiniBoard component, animated flap-in),
pitch, **Create account** / **Sign in** CTAs.

### 2. Sign up / Sign in — `/signup`, `/login`

Better Auth email+password, design-system fields, error states inline.

### 3. Dashboard — `/dashboard`

| | |
| --- | --- |
| Access | signed-in |
| Job | the fleet at a glance; create and open boards |

Board cards show a live dot (display connected), what the glass is showing,
and chips for **type**, **private**, and **paused**. Clicking a card opens
its **Settings** (the control room); *Open display* is the explicit action.
**New board** goes to `/new`.

### 4. Create — `/new`, the rails

Choosing a board the way you choose something to watch: horizontal,
snap-scrolling rails, one per family of use, each card a **template** from
`lib/board-types/templates.mjs` — a type plus a preset config (grid, theme,
timezone, fallback) and a seeded queue. The first rail is the registry
itself, every type blank, so a new type is a card for free; the rest
(*Around the office*, *Events and match day*, *Many screens*) are curated.
A card's poster is the board in CSS tiles (`MiniBoard`), skinned by the
template's theme — the Canary cards are green.

Selecting a card expands a detail panel under its rail: the poster larger,
what you get, what it starts with, and the form — name (prefilled from the
template), the type's non-advanced `createParams` (timezone defaults from
the browser), an optional slug. **Create board** posts `{template, …}` to
`POST /api/boards`; the server applies the template's params and config
and admits its seeds through the same door as `POST /message`, then the
page lands on the board's Settings with the queue already primed. Arrow
buttons appear on hover for mouse users; touch swipes.

### 5. Settings — `/b/{slug}/settings` (owner-only)

Three tabs; the AppBar shows the slug, the type chip, and a paused chip when
deactivated.

- **Queue** — per-type. Live: compose (priority, hold, loop) + the rolling
  list with reorder/edit/loop/remove, flush, clear. Scheduled: the schedule
  editor — compose onto the clock (every N sec/min, hourly, daily, weekly,
  once; duration incl. "until next trigger"), a live next-3-occurrences
  preview running the real evaluator, the schedule list with next times and
  the active marker, and the board's timezone + fallback. Shared: the same,
  headed by a **Screens** panel (copy the URL, whether anything is watching).
- **Display** — the visual **layout picker** (drag the board around a
  miniature screen, scale by the corner; stored as viewport percentages so
  one layout fits a phone and a video wall) + the display config sliders.
- **General** — identity (name, slug), privacy + keyed display URL, access
  (key reveal/rotate, copy-curl, per-board AGENTS.md link), **pause &
  export** (pause sends displays to a standing card, keeps the queue; export
  returns items as paste-able JSON), delete.

### 6. Display — `/b/{slug}`

| | |
| --- | --- |
| Access | public boards: anyone; private: `?key=` or owner session |
| Job | the glass — passive renderer of the board's type playback |

Renders inside its configured layout region. Live boards play the queue and
report completions (idempotent per play; mirrors advance once). Clock boards
run the type's `itemAt` against the server clock — evaluate, cut, sleep
until the next change; fallback in the gaps; an unplayable item shows the
fallback, never a dark gap. Keys: **F** fullscreen, **Esc** panic-blank
(held until the queue's content changes), **M** mute, **↑ / ↓** volume in
10% steps (sound is per browser, remembered in localStorage; a browser tab
stays silent until its first key or click, the kiosk shell does not). Paused/unknown-type boards show
"BOARD PAUSED. SEE SETTINGS".

### 6½. Account — `/account` (signed in)

Who you are and what is connected to you: profile (name, email, member
since) and **Connected apps** — the OAuth clients that have signed in as
you, each with Disconnect (access ends on the client's next request, via
the revocation watermark in `lib/api/revocations.mjs`). Reached from your
name in the AppBar (`UserMenu`). Billing and tier land here when they
exist; the dashboard's connect column only glances at this list.

### 7. Docs — `/docs`, `/docs/{slug}`

Getting started · Queues & board types · Authoring board types · Design
system · Board API. The per-board agent guide is served live at
`GET /api/b/{slug}/AGENTS.md` with the board's URLs baked in, **speaking the
board's type** (a clock board's copy documents schedules and has no
priority table).

---

## Cross-cutting

- **Design system**: `app/design-tokens.css` + `components/ui/*` (Button,
  Field, Tabs, Modal, ConfirmDialog — no native `confirm()` anywhere —
  Chip, MiniBoard, KeyReveal…). Flap motion tokens, reduced-motion safe.
- **Type registry**: `lib/board-types/` (server) mirrored by
  `components/board-types/registry.ts` (client); the contract harness keeps
  them identical and every definition honest. Failure containment: a broken
  or unknown type pauses that board, never the app.
- **Deactivation**: pause + JSON export, never deletion — the future
  Salable gating story hangs off `boards.status`.
- **Cleanup certainty**: knip runs in CI (dead files/exports/deps fail the
  build); removed 3.0 machinery lives in `attic/` with a documented
  README; removed routes answer **410** with a pointer.

## Known seams (deliberate)

- Bands/regions and multi-section layouts: deferred (the layout picker is
  built to grow into N regions).
- Custom per-board media/skins: future work alongside Salable gating.
- `user.tier` column is dormant, documented in the schema.
