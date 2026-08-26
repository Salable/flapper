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
exportable from the Settings tab.

## Live playback

- **Order** is the rail order on the Board tab (or `GET /api/b/{slug}/queue`).
- A finished message is **removed** — unless it **loops**, in which case it
  returns to the back of the queue. A queue of looping messages cycles
  forever. (Every slide added from the Board tab loops by default — being in
  the rotation is what makes it one; a true one-off is a slide you remove
  after it plays, or an interrupter, below.)
- When the queue **drains**, the last message's final page stays on the glass
  ("holding"), across reloads and power cycles — a single message makes a
  standing sign.
- **Clearing** is the deliberate full stop: queue emptied, glass blanked.
- Priorities: `normal` joins the back, `next` plays after the current message,
  `now` plays immediately (what it displaced stays next in line, and nothing
  is discarded — it plays again from the top once its turn comes round).
- **Interrupters** (`interrupt: true` alongside `priority: "now"`) are events,
  not standing members of the rotation — a live announcement, never looped
  in the UI (the API itself allows pairing `interrupt` with `loop` if you
  want one that keeps cutting back in). They change nothing about playback
  and rank nothing against each other; a board's control room keeps them
  out of the rotation's list and shows them on their own. The UI only ever
  fires a **saved** one — see "Saved interrupters" below; the underlying
  `interrupt: true` field itself is available to any API caller directly,
  with no save step required.
- **Saved interrupters** are a name plus text and its own Duration, kept
  on the board (`config.interrupters`, `GET`/`POST {apiBase}/interrupters`)
  and fired later by name (`POST {apiBase}/interrupters/{name}/fire`) — see
  `docs/BOARD-API.md`. Duration is one or the other, not both: a hard
  time limit (shown, then gone outright the instant it's up), or the
  switch (blocks the rotation entirely until dismissed or broken by a
  higher rank) if left unset. The control room's Interruptions tab only
  ever fires a saved one: there is no path from typed text straight to
  the glass there, on purpose. Unlike a raw `interrupt: true` post, a
  saved one *does* rank against the others: its position in the saved
  list (`POST {apiBase}/interrupters/reorder`) decides who wins a clash —
  firing one is refused if a higher one is currently showing.
- **`label`** names an item for people — what a list calls it — distinct
  from what it displays; nothing shown on the glass ever reads it.
- The rotation is also capped, and the cap rolls rather than rejects: past
  it (5 by default, configurable per board 1–50), adding a slide rolls the
  oldest waiting one off to make room, a ticker rather than a form. The
  item on the glass is never rolled. An interrupter is exempt from this
  cap entirely - firing one always goes through, even on a board sitting
  exactly at its cap (a one-message "sign", most often).

## Editing

The Board tab shows the rotation as a rail, one tab per slide, with the
selected slide's own name/text/hold on the right and ↑/↓ to move it earlier
or later; removing a slide is the only way to take it out of the loop, since
slides added there loop by definition. A live board (not scheduled/shared)
also gets a separate Interruptions tab, the same rail-and-panel shape but
for saved interrupters: one tab per saved name, "+ Interrupt" to save a new
one, and — only once something is selected — a Fire button. Saving and
firing are two separate steps on purpose; nothing reaches the glass from
this tab without a name behind it first.

Everything the UI does is also on the API, and the API can do more (set
`priority`, `interrupt`, `label`, or toggle `loop` on an existing item —
none of which every UI control offers):

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
board stands on its **fallback message**, set on the Board tab alongside the
board's timezone (these types get their own schedule editor there instead of
the live rotation/Interruptions tabs).

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
