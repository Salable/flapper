# Queues

The queue is the heart of a Flapper board: a durable, server-side list of
messages the display plays in order. The display owns nothing — it asks what
to show, shows it, reports that it finished, and asks again.

## Playback

- **Order** is the list order in Settings (or `GET /api/b/{slug}/queue`).
- A finished message is **removed** — unless it **loops**, in which case it
  returns to the back of the queue. A queue of looping messages cycles
  forever.
- When the queue **drains**, the last message's final page stays on the glass
  ("holding"), across reloads and power cycles — a single message makes a
  standing sign.
- **Clearing** is the deliberate full stop: queue emptied, glass blanked.
- Priorities: `normal` joins the back, `next` plays after the current message,
  `now` plays immediately (what it displaced stays next in line).

## Editing

Settings → Queue shows the live list: the ▶ marker is what is playing, ◼ is a
held (drained) message. Reorder with the arrows, toggle **↻** to loop, ✎ to
edit text in place, ✕ to remove. Removing the playing message skips it.
**Flush pending** drops everything that is waiting but lets the current
message finish; **Clear board** stops and blanks.

Everything the UI does is also on the API:

| Call | Does |
| --- | --- |
| `GET /queue` | the list + what is current |
| `POST /queue/items` | add (same body as `/message`) |
| `PATCH /queue/items/{id}` | edit text/rows or toggle `loop` |
| `DELETE /queue/items/{id}` | remove (removing current skips) |
| `POST /queue/reorder` | `{itemId, afterId}` — `afterId: null` is the front |
| `DELETE /queue` | flush pending |
| `POST /clear` | clear + blank |

All writes take `authorization: Bearer <api key>`.

## Displays

A display keeps exactly one message on the glass and reports each completion.
Completions are idempotent per play, so **two screens on one board stay in
step** — both play, the server counts once, and the follower snaps to the
truth on the next sync. Displays that lose their network keep the last page
standing and converge when they reconnect.

On the display itself only two keys exist: **F** for fullscreen and **Esc**
to blank the glass in place — the queue is untouched, and the blank lifts as
soon as someone adds or edits a message.

## Playback modes — live and time-based

Every queue has an explicit **mode**, set in Settings → Playback mode:

- **Live queue** (default, everything above): the display plays the list top
  to bottom and reports back. One board per queue.
- **Time-based** (Plus): the queue compiles into a repeating cycle — every
  loop message gets a slot sized to how long it takes to flip and dwell — and
  each display renders whatever the clock says. One-off messages are spliced
  in once at the next slot boundary (`priority: now` starts immediately),
  play once, and drop out. Editing the queue recompiles the cycle without
  jumping whatever is showing.

## Multiple boards, one queue (Plus)

A **time-based** queue can drive several boards at once: Settings → Playback
mode → Attach board. Every attached display evaluates the same timeline from
the same (server) clock, so they stay in step with no coordination — a
reloaded board lands mid-cycle exactly where its siblings are. The arriving
board's own queue must be empty first (nothing is ever deleted for you), and
Detach gives a board a fresh live queue of its own.

**Offerings:** time-based mode and sharing are part of **Plus** (toggle your
offering from the dashboard — free while Flapper has no billing). Switching
back to Standard *pauses* Plus features rather than deleting anything: paused
displays show a labelled notice or a blank board (your choice, per queue),
and everything resumes exactly where it was on re-upgrade. Design notes:
`docs/rfcs/0002-scheduling.md`.
