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

## Multiple boards, one queue

Coming in a future release (the Plus offering): a queue will have a mode
toggle — **live queue** (what this page describes) or **time-based** — and a
time-based queue will be attachable to several boards at once, all showing
the same thing on the same clock. Design notes live in the repo under
`docs/rfcs/0002-scheduling.md`.
