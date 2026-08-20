# The attic

Removed source, preserved on purpose. Git history keeps everything, but the
attic keeps the *interesting* removals findable: each entry records what the
thing was, why it left, and what would bring it back. Code here is not
imported by anything and is excluded from knip and the build.

## Entries

### `timeline.mjs` + `schedule-cycle.mjs` — the 3.0 compiled-cycle scheduler
**Was:** timed queues compiled loop items into a fixed repeating cycle
(`offset = (now - anchor) % cycleMs`), with server-side re-anchoring on edit
and spliced one-shots (`playAtMs`).
**Why it left:** Flapper 4.0 replaced queue *modes* with board *types*; the
scheduled type evaluates per-item cron-like schedule specs instead of one
compiled cycle.
**Would return if:** a pure "playlist on repeat" type is wanted again — the
cycle math and the re-anchor-on-edit trick are worth stealing.

### `queues-entity.mjs` + queue mode/attach/detach (see also 410 routes)
**Was:** queues as shareable entities: a live/timed mode toggle, multi-board
attachment (earliest-attached = primary), detach onto fresh queues.
**Why it left:** multi-board-per-queue was the wrong sharing model — a shared
board is the same board slug opened on many screens, not many boards on one
queue. The API routes answer 410 with a pointer.
**Would return if:** sections land and a queue-per-section model needs the
queue to be a first-class entity again (the 1:1 queue row plumbing was kept
in the schema for exactly that).

### `entitlements.mjs` — tiers as entitlements
**Was:** `user.tier` (standard/plus) gating board count, timed mode, and
sharing; a free dashboard toggle; dormancy for under-entitled boards.
**Why it left:** board *types* became the unit of value and every type is
open for now. The `user.tier` column remains in the schema (dormant,
harmless) so Better Auth's tables didn't churn.
**Would return if:** Salable-based gating lands — but as "which board types
may this account create/keep active", wired to `boards.status =
'deactivated'` + the export flow, not as a feature-flag matrix. This file is
the reference for the dormancy semantics that already worked.

### `QueueModePanel.tsx`
**Was:** the Settings UI for mode toggling, attach/detach, and dormancy
display. Superseded by the type picker at creation; dormancy display is now
the fixed paused card.

### `timed.test.mjs`
**Was:** the test suite for modes/attach/dormancy. Kept because it documents
the exact semantics of the removed system better than prose.
