# RFC 0002 — Queue modes and time-based playback (shared queues)

*Status: awaiting sign-off · Author: Claude · 2026-08-20*
*Scope: SPEC workstream W4 (Plus offering). Nothing here ships in 3.0.*

## The frame (Neal's toggle model)

A queue has an explicit, user-facing **mode**:

| Mode | Boards | Who advances playback |
| --- | --- | --- |
| **Live queue** (default) | exactly one | the display: play → report → next (what 3.0 ships) |
| **Time-based** | one or many | the clock: the queue compiles to a timeline; displays render whatever the current moment says |

The mode is a toggle on the queue, not an emergent property of sharing —
behaviour never changes silently under a user. Attaching a **second board**
to a queue *requires* time-based mode: the UI offers a confirmed conversion
("this queue will switch to time-based playback"), never an automatic flip.
Detaching back to one board does **not** auto-revert; the owner can toggle
back to live explicitly. Both modes are Plus-gated only where sharing is:
a single board may use either mode; multiple boards require Plus.

This resolves the R1 hybrid cleanly: two playback machines, each engaged by
an explicit state everyone can see.

## What "time-based" means (recommendation: cycle first, calendar later)

Two candidate shapes:

**A. Continuous cycle (recommended for v1 of W4).** The queue compiles into a
repeating timeline: each item gets a computed duration (pages ×
`estimatePageMs` + dwell — shared code the server already runs for
`/preview`'s `estimatedMs`), and the cycle length is their sum. Playback
position is a pure function of the wall clock:
`offset = (now - cycleAnchor) % cycleLength`. Every display evaluates the same
function, so boards agree to within clock skew with **zero coordination** —
no advance calls, no leader election, and a display that reloads lands
mid-cycle exactly where its siblings are. Non-loop semantics in this mode:
one-shot items are spliced into the *next* cycle boundary once, then drop out
at recompile.

**B. Calendar slots.** Items pinned to wall-clock windows ("9:00–9:05 this
message"), with the cycle (or blank) filling gaps. Real use cases (menus by
daypart, meeting-room schedules) but a much bigger surface: recurrence rules,
timezone handling per board, conflict resolution, empty-slot behaviour.

Recommendation: ship **A** as the time-based mode; design the schema so **B**
becomes an additive layer (a `window` column on timeline entries) rather than
a second system. Calendar slots become their own RFC when demand is real.

## Sketch

**Schema (additive):**
- `queues`: id, ownerId, name, mode (`live | timed`), cycleAnchor timestamptz,
  compiledAt, cycleMs.
- `queue_items.queueId` replaces the implicit board ownership;
  `boards.queueId` fk (a board's private queue is just a queue with one
  board attached). Migration: every existing board gets a queue row wrapping
  its items — invisible to users and to the 3.0 API, whose routes keep
  resolving `board → its queue`.
- Timed mode adds per-item `computedDurationMs` (denormalized at compile).

**Playback (timed):** display fetches the compiled timeline (items +
durations + cycleAnchor + cycleMs), renders `itemAt(now)`, self-schedules the
next transition locally, and re-syncs on nudge exactly as today. No advance
endpoint in timed mode — completions are not reported, positions are derived.
Clock skew: displays use server time (`Date` header offset captured at fetch)
rather than trusting the kiosk clock; ±1 s of skew across boards is
acceptable for split-flap content and invisible once flip duration is
factored in.

**"Play now" in timed mode:** splices a temporary override slot (item ×
duration, starting now) broadcast by nudge; the cycle resumes underneath when
it ends. Same UX verb, different machinery — worth keeping because agents use
`priority: now` today.

**Editing:** any queue edit recompiles (durations recompute, cycleLength
changes) and re-anchors the cycle at the edit boundary so the current item
doesn't jump; nudge broadcasts as today.

**Entitlement / dormancy:** attaching board #2 checks `can(tier,
'sharedQueues')`. On downgrade, extra attachments go dormant: the queue keeps
playing on its **first-attached** board; other boards show a labelled
"dormant — upgrade or detach" holding card. Nothing is deleted; re-upgrade
reactivates in place.

## Open questions for sign-off

1. Cycle-first (A now, B later) — agreed?
2. Timed mode for a *single* board is free-tier in this sketch (mode is free,
   sharing is Plus). Keep, or make timed itself Plus?
3. One-shot items in timed mode: splice-next-cycle-then-drop (recommended) or
   refuse non-loop items in timed queues?
4. Dormancy display: blank vs labelled holding card (recommended: labelled).
