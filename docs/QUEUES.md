# Queues & board types

Every board has a durable, server-side queue of messages; **the board's type
decides what that queue means**. The display owns nothing — it renders what
its type's playback says and nothing else.

| Type | The queue is… | Playback |
| --- | --- | --- |
| **Live queue** | a rolling list (cap ~5; the oldest waiting message drops) | in order, as it arrives |
| **Scheduled** | a schedule — every item carries a spec | whatever the clock says is active; a fallback message in the gaps |
| **Shared screens** | a schedule, for many screens | same as scheduled — every screen showing the URL stays in step on the server clock |

You pick the type when creating the board. A type an installation cannot run
(or a deactivated board) shows a paused card; the queue is kept and
exportable from Settings → General.

## Live playback

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
| `PATCH /queue/items/{id}` | edit text/rows, toggle `loop`, change `schedule` |
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

## Scheduled playback

On a **scheduled** (or **shared screens**) board the queue is a schedule:
every item carries a spec and the clock decides what shows. Between slots the
board stands on its **fallback message** (Settings → Queue → Clock).

| Spec | Fires |
| --- | --- |
| every N seconds / minutes | on a fixed period — minutes anchor at local midnight, so ":15 past" holds through DST |
| hourly at :MM | every hour, at that minute |
| daily / weekly at HH:MM[:SS] | at that wall time in the board's timezone |
| once, at a moment | exactly once; played-out items clean themselves up |

Each item also says how long it **shows for**: one read-through of its text
(the default), a fixed time, or *until its next trigger* — a standing sign
that timed items overlay and hand back to. The latest trigger wins the
glass; exact ties alternate. A plain `POST /message` (no schedule) plays
once right now over whatever is scheduled.

Playback is a pure function of the **server clock** — every screen showing
the board computes the same answer at the same moment, which is why shared
screens stay in step with nothing to pair or configure. Design notes:
`docs/rfcs/0002-scheduling.md`; the removed 3.0 queue-mode machinery and
what replaced it: `docs/attic/README.md`.

## Building a new type

Board types are packages of playback behavior behind one contract —
`docs/BOARD-TYPES.md` is the complete authoring guide, written so an agent
can produce a loadable type from it alone.
