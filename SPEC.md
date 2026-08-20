# Flapper — Specification & Program Plan

*The course set after the 2.0 launch. The product direction below is Neal's;
the plan that follows turns it into research, implementation, feedback, and
delivery phases. The screen-by-screen baseline this plan starts from is
[docs/SCREENS.md](docs/SCREENS.md); the 1.x engine spec this file replaced
lives in git history (`git show 52c55db:SPEC.md`).*

---

## 1. Product direction

Two divergent **offerings**: a **Standard** (free) tier and a **Plus** (paid)
tier. Monetization is *not* being implemented now, but every feature from here
on is designed in these terms. Crucially, users must be able to move between
offerings in both directions — upgrade and downgrade — so tiered features must
be **interoperable but disconnectable**: switching tiers flips capabilities on
and off without destroying or corrupting data.

### The tasks

1. **All board configuration moves to the Settings interface.** The
   flapperboard itself becomes a passive display — no keyboard interactions,
   no on-board panel.
2. **Settings can send messages** to a running wallboard.
3. **Each board gets a server-side queue** the board reads from: accessible
   over the API, users queue messages into it, and a board on load reads the
   queue and begins pulling items off the top.
4. **Loop messages**: a per-message setting (`loop`) that returns a played
   message to the bottom of the queue instead of removing it.
5. **The settings screen allows editing the queue.**
6. **Multiple boards off a single queue** — possibly by making the queue
   time-based (schedule items into time slots; each board reads whatever is
   available for the current slot). Hard problem: vet options, bring back
   recommendations before building.
7. **Docs served from the app** at a `/docs` path.

---

## 2. What this actually changes (read before the phases)

Three of these tasks are one architectural decision wearing different hats.

**The queue changes sides.** Today the queue lives *inside the display tab*
(the browser's Controller/Track); the server only relays commands. Tasks 3, 4,
5 and 6 all require the queue to be a **first-class server entity**: durable,
API-addressable, editable while no display is connected, loopable, and —
eventually — attachable to more than one board. The display inverts from
*owner of the queue* to *player of a queue*: it loads, asks "what should I be
showing?", renders, reports progress, and asks again. This is the single
biggest change since the web migration, and most of the implementation risk
lives here — which is why it gets a real research phase (§4) rather than a
straight build.

**The board goes passive; Settings becomes the control room.** Task 1 removes
the on-board panel and keyboard entirely, and tasks 2 and 5 rebuild those
affordances inside Settings — compose, queue management, and (implied) the
grid/motion configuration that currently only exists on-board. This resolves
audit findings 3 and 4 (split settings; localStorage-vs-server drift): with no
on-board controls, **the server config becomes the only source of truth** and
display-local settings disappear.

**Tiers are an entitlement problem, not a billing problem.** No payments yet —
but the data model needs a place where "what can this account do" lives, so a
future upgrade/downgrade is a row update, not a migration. Downgrade must
never delete: Plus-only structures (e.g. shared queues) stay in the database
but stop being *exercised* on Standard.

### Proposed tier split (strawman — confirm in §8)

| Capability | Standard | Plus |
| --- | --- | --- |
| Boards per account | up to 3 | unlimited |
| Server-side queue, loop messages, queue editing | ✓ | ✓ |
| Private boards | ✓ | ✓ |
| Shared queues / multiple boards per queue | — | ✓ |
| Time-slot scheduling | — | ✓ |
| API keys per board | 1 | multiple / scoped (later) |

Downgrade behaviour: extra boards and shared-queue attachments become
**dormant** (read-only, clearly labelled), never deleted.

---

## 3. Program shape

Four phases. Research runs first because task 6's answer changes task 3's
schema, and task 3's schema is the foundation everything else sits on.

```
R  Research      queue architecture, playback ownership, scheduling model
I  Implementation four workstreams over the chosen architecture
F  Feedback      instrumented dogfood on production, structured review
D  Delivery      migration/cutover, docs, desktop, tag 3.0
```

---

## 4. Phase R — Research (decisions before code)

Each spike produces a short written recommendation in `docs/rfcs/` and ends
with a decision Neal signs off. Target: all three resolved before Phase I.

### R1 — Where the queue lives and who advances it *(the load-bearing spike)*

The core question: when a message finishes on the glass, **who decides what
plays next** — the display or the server?

Options to vet:

- **A. Display-driven cursor** — queue is an ordered table in Postgres; the
  display pulls the head, plays it, reports completion, pulls again. Loop =
  server moves the row to the tail on completion. *Pros:* closest to today's
  timing fidelity (dwell/settle stay local); simple. *Cons:* multi-board sync
  is cooperative at best — two boards drift.
- **B. Server-scheduled slots** — the queue compiles into a timeline
  (message × start-time × duration, from `estimatedMs` + dwell); displays
  render whatever the current slot says. *Pros:* multi-board sync falls out
  free (every board reads the same clock); pause/skip/reorder are server
  operations; enables task 6's "time-based" idea directly. *Cons:* the server
  must model playback timing (we already can: `estimatePageMs` is shared
  code); clock skew handling; live "play now" needs a timeline splice.
- **C. Hybrid** — display-driven for a single board (Standard), compiled
  timeline only when a queue is shared (Plus). *Pros:* each tier gets the
  simplest correct machine. *Cons:* two playback modes to keep honest.

Also in scope: whether the Redis command stream survives (likely yes, as the
"something changed, re-sync" nudge channel rather than the content channel),
and what happens to `priority: now/next` and the current band model in a
queue-first world.

**Deliverable:** RFC with a recommendation, schema sketch (`queues`,
`queue_items`, board↔queue attachment), and the API shape for queue CRUD.

### R2 — Scheduling model for shared queues (task 6)

Assuming R1 lands on B or C: what does "time-based" mean to a user? Vet:
continuous loop timeline (playlist repeats on a cycle, boards join at the
current offset) vs. calendar slots (this message plays 9:00–9:05) vs. both.
Decide the Standard/Plus boundary here. **Deliverable:** RFC + settings-UI
sketch of the scheduling surface.

### R3 — Entitlements plumbing

Small spike: `tier` column vs. entitlements table; where checks live (one
`can(user, capability)` helper in `lib/db/`, enforced in handlers); how
dormancy renders in the UI and API (403 with a named reason, never silent).
**Deliverable:** half-page RFC; this one is cheap and unblocks parallel work.

---

## 5. Phase I — Implementation (four workstreams)

Ordered so each lands green and shippable; W2 is the long pole.

### W1 — Foundations *(starts immediately, no research dependency)*

- Entitlements scaffold per R3; seed everyone as Standard.
- **`/docs` route (task 7):** render the repo's markdown (BOARD-API, guides,
  a new queue guide when it exists) inside the app shell with the Flapper
  look; `/docs` index + per-doc pages; link from landing, dashboard, and the
  per-board AGENTS.md. Cheap, visible, independent — good first ship.
- Brand sweep while we're in the chrome: favicon, styled 404/error pages
  (audit findings 7).

### W2 — The server-side queue *(tasks 3 + 4, per R1's decision)*

- Schema + `lib/db/queues.mjs` (same testable seam as `boards.mjs`).
- Queue API under the board: list/append/insert/reorder/edit/remove items,
  `loop` flag per item; keep the 422 culture. `POST /message` becomes
  sugar for "append to the queue" so **every existing API client keeps
  working unchanged**.
- Display inversion: the board page loads the queue and plays it; completion
  reporting; reconnect/resume semantics; the Redis stream becomes the re-sync
  nudge. The engine (`lib/board/`) does not change — only who feeds it.
- Contract updates: AGENTS.md + BOARD-API gain the queue endpoints;
  `/status` grows queue-position truth from the server side.

### W3 — Settings becomes the control room *(tasks 1, 2, 5)*

- Settings gains three new sections: **Compose** (send now / add to queue,
  band, priority, loop), **Queue** (live list with reorder, edit, remove,
  loop toggles, now-playing marker fed by `/events`), and **Display**
  (grid, motion, dwell — the config that today lives only on-board).
- The board page goes passive: panel, keyboard map, and localStorage settings
  removed; the display renders server config only. Decide the survivors in
  §8 (fullscreen? a connection indicator?).
- Dashboard cards get the live signal this unlocks for free (connected/
  now-showing — audit finding 2).

### W4 — Shared queues & scheduling *(task 6, Plus-gated, per R2)*

- Queue becomes attachable to multiple boards; the scheduling surface from
  R2; entitlement checks; dormancy behaviour on downgrade.
- Ships last, dark-launched behind the entitlement so it can bake.

Testing bar throughout: every decision in `lib/` under `node --test`
(queue semantics get the same treatment the privacy matrix got); browser
verification per screen; the full curl walk against the served AGENTS.md
after every workstream.

---

## 6. Phase F — Feedback

- **Dogfood on production:** at least one real wall display (the desktop
  shell) running a looped queue for a week; Neal drives it only through
  Settings and the API. Friction goes into a running log by finding-number.
- **Structured review:** a session against each task 1–7 — "is this what you
  meant?" — plus the tier strawman. The queue-editing UX (W3) and the
  scheduling model (W4) are the two most likely to need a second pass;
  budget for one revision cycle each.
- **Agent test:** point a fresh Claude session at a board's AGENTS.md with
  only a slug and key, ask it to program a looping schedule; where it
  stumbles, the docs (not the agent) get fixed.

Exit criteria: no severity-1 friction open, tasks 1–7 each demoed
end-to-end, tier toggles proven in both directions on a real account.

---

## 7. Phase D — Delivery

- **Migration/cutover:** drizzle migrations additive-first; on deploy,
  in-flight display-side queues are simply not migrated (they were ephemeral
  by design) — boards come up idle reading their new server queue. Announce
  in the changelog that the on-board panel is gone and where it went.
- **Docs:** `/docs` is the home; BOARD-API + AGENTS.md regenerated for the
  queue contract; README and this SPEC updated; audit doc
  (`docs/SCREENS.md`) revised to describe the new world.
- **Desktop shell:** unchanged code, re-verified against the passive board;
  release notes.
- **Tag `v3.0.0`**, production verification walk (the full matrix, plus the
  new queue walk), and a fresh field-survey artifact as the next baseline.

---

## 8. Decisions needed from Neal

1. **Tier strawman (§2)** — right lines? In particular: board count limit on
   Standard, and whether private boards stay free.
2. **Board passivity (task 1)** — does *no keyboard interactions* include
   fullscreen (`F`) and the panic clear (`Esc`), or do those survive as the
   only two? Recommendation: keep `F` (it's display-local and harmless),
   move panic-clear to Settings.
3. **R1 architecture** — sign-off on the RFC when it lands; the strawman
   leaning is **C (hybrid)**: display-driven for single boards, compiled
   timeline for shared queues.
4. **Bands in a queue world** — does the footer band get its own queue in
   the new model (parity with today) or is multi-band deferred to keep W2
   small? Recommendation: parity — a queue per band, same schema.
5. **Priority `now`/`next`** — keep as queue-insert positions (head/splice)
   or drop in favour of explicit reordering in Settings? Recommendation:
   keep; API clients rely on them.
