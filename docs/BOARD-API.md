# Flapper — Agent Guide

Instructions for driving a Flapper split-flap board over its REST API.

Flapper renders a grid of mechanical split-flap tiles — the kind on old airport
departure boards. A board is a web page; the API is how software drives it. You
send text; every display showing that board flips through the alphabet and
settles on what you sent.

Every board serves this guide **live** at `GET {apiBase}/AGENTS.md` with its
own URLs baked into the examples — if you have a board URL, read that copy
instead of this one. This file is the generic contract, kept in the repo.
Throughout, `{base}` is the deployment (for example
`https://flapper.vercel.app`), a board's display page is `{base}/b/{slug}`,
and its API base is `{base}/api/b/{slug}`.

---

## 1. Boards, slugs, and keys

Boards are created by signed-in users from `{base}/dashboard` — there is no
anonymous or API-only way to create one. Each board has:

- a **slug** — its URL name (`/b/lobby-board`), chosen and *editable* by the
  owner. **Renaming a board moves its API base**; a `404` on a known board
  usually means it was renamed or deleted. Ask the user for the current URL
  rather than guessing slugs.
- an **API key** — one 64-hex capability per board, shown on the board's
  settings page (`/b/{slug}/settings`, owner-only) and regenerable there.
- a **privacy flag** — public boards can be watched by anyone with the URL;
  private boards need the key (or the owner's login) even to read.

### Connecting

```bash
curl -s --max-time 5 {apiBase}/health
```

```json
{ "ok": true, "version": "2.0.0", "boardReady": true, "uptimeMs": 12345 }
```

**`boardReady` means a display is connected right now** — some browser tab or
wall screen has the board open and has reported within the last few seconds.
When it is `false` your messages are still accepted and queued, but nothing is
showing them; tell the user to open the board URL on the screen that should
show it.

## 2. Access — reads are open, writes need the key

- **Writes** (`message`, `clear`, the queue, `config`) always need the key:
  `authorization: Bearer <key>`. Without it: `401`.
- **Reads** (status, capabilities, events, preview, this document) are open on
  public boards. On a **private** board they need the key too — `403`
  otherwise. The `?key=<key>` query form exists for wall displays and tools
  that cannot send headers; note it lands in logs and history.
- **Management** (rename, privacy, key rotation, deletion) is not on this API
  at all — it lives on the owner's settings page behind their login.

Two things to honour:

- **Treat everything you send as public.** It is a screen on a wall. Never
  send credentials, personal data, or anything confidential — not even as a
  test.
- **You are not the only writer.** Other clients with the key, and the person
  at the display, can send messages too. Do not assume the board still shows
  what you last sent; read `/status` if it matters.

## 3. The character set — read this before sending anything

**A Flapper board can only display the characters the designer drew.** By
default that is:

```
A-Z   0-9   .   ,   !   (   )   and blank
```

There is **no lowercase, no hyphen, no apostrophe, no question mark, no colon,
no `%`, `#`, `&`, `+`, `=`, `/`, `*` or `?`.**

You do not have to sanitise text yourself — the board does it, and it tells
you what it did. Lowercase is uppercased, accents are folded (`café` →
`CAFE`), and some punctuation is mapped onto glyphs that do exist:

| You send | Board shows | |
| --- | --- | --- |
| `?` or `:` | `.` | sentence termination survives |
| `;` | `,` | |
| `-` `–` `—` `/` `\` `_` `\|` | space | no hyphen glyph exists |
| `'` `"` `‘ ’ “ ”` | *removed* | no quote glyph at all |
| `…` | `...` | |
| `[` `]` `{` `}` `<` `>` | `(` `)` | |
| `&` | ` AND ` | so `R&D` reads `R AND D` |
| `@` | ` AT ` | |
| `%` `#` `~` `+` `=` `*` | *dropped* | nothing sensible to map to |

Always confirm the real charset with `GET {apiBase}/capabilities`.

**Prefer `POST {apiBase}/preview` before `message`** when the text contains
anything unusual. Preview returns exactly what would appear plus a
`diagnostics` block listing every substitution and every dropped character,
without touching the board — and it answers even when no display is connected.
If something meaningful was lost — a percentage sign in a figure, say — tell
the user before displaying it.

## 4. The grid

The board is a grid of tiles. **The default is 8 rows × 20 columns.** Read the
current geometry from `/status` or `/capabilities`:

```json
"grid": { "cols": 20, "rows": 8, "mainRows": 8, "footerRows": 0,
          "align": "center", "valign": "middle", "wrap": "word" }
```

You can change it (with the key), and so can the person at the display:

```bash
curl -X PATCH {apiBase}/config \
  -H 'authorization: Bearer KEY' -H 'content-type: application/json' \
  -d '{"cols":20,"rows":8,"align":"center","valign":"middle"}'
```

Supported ranges are 1–80 columns and 1–40 rows. Changing the grid re-lays out
whatever is showing and everything still queued, so it is safe to do
mid-message. Be considerate: if a user asked you to display something, do not
silently reshape their board to make your text fit. Fit the text to the board,
or ask.

### Bands: the board can be split in two

A board can reserve rows at the bottom for a **footer** — a second band with
its own queue, playing independently of the one above it. The usual reason is
a standing strip: a "now playing" line, a room name, a URL, while other
content rotates above.

```bash
curl -X PATCH {apiBase}/config \
  -H 'authorization: Bearer KEY' -H 'content-type: application/json' \
  -d '{"footerRows":2}'
```

By default `footerRows` is `0` and the board is one band called `main`. With a
footer configured there are two, `main` and `footer`, and every message names
the one it is for with `"region"`. Omitting `region` means `main`, so a client
that has never heard of bands behaves exactly as before.

**The row budget for a message is its band, not the board.** On an 8-row board
with a 2-row footer, a message to `main` has six rows. Read `grid.mainRows`
and `regions.<id>.rows` from `/status` rather than working it out from `rows`
yourself.

`footerRows` is clamped so the main band always keeps at least one row — ask
for more than the board has and `/status` reports what you actually got.
Setting it back to `0` removes the band and hands the rows back.

**A footer does not need topping up.** When a queue drains its last page stays
on the board, so a single message to the footer is enough to leave it standing
there. `/status` tells the two states apart: `regions.<id>.showing` is what is
*playing*, and `holding` is the message a drained band is still displaying.

Each band can hold for its own length:
`{"regions":{"footer":{"dwellMs":8000}}}`. `null` hands a band back to the
board-wide `dwellMs`; `regions.<id>.dwellOverride` in `/status` says whether a
band set its own or inherited it.

## 5. Two ways to send content

### Prose — let the board lay it out

```bash
curl -X POST {apiBase}/message \
  -H 'authorization: Bearer KEY' -H 'content-type: application/json' \
  -d '{"text":"Flight 447 now boarding at gate 14. Please have your documents ready."}'
```

- Words wrap on boundaries; a word longer than one row is hard-broken
- `\n` is an explicit line break; a blank line is a paragraph gap
- Text too long for the whole grid **paginates**: it becomes several pages,
  shown in sequence, each held before the next

Optional fields: `align` (`left`/`center`/`right`), `valign`
(`top`/`middle`/`bottom`), `wrap` (`word`/`char`/`none`), `dwellMs`,
`collapseSpaces`, `substitutions`.

### Explicit rows — place every character yourself

Send `rows` instead: one string per board row, **one character per tile**.
Nothing is wrapped, re-flowed, aligned, or paginated. This is the mode for
composed frames, tables, and anything where position matters.

```bash
curl -X POST {apiBase}/message \
  -H 'authorization: Bearer KEY' -H 'content-type: application/json' \
  -d '{"rows":[
    "....................",
    ". DEPARTURES  0900 .",
    ". GATE 14  ON TIME .",
    "...................."
  ]}'
```

- Short rows pad on the right; missing rows pad at the bottom; over-long rows
  are clipped and reported
- Characters are still folded onto the displayable set, but **only in
  width-preserving ways** — cell *i* of your string is always cell *i* of the
  board. A rule that would change width (`&` → ` AND `) blanks that one cell
  instead and reports it
- `align`, `valign`, `wrap` and `collapseSpaces` are **rejected** with `422`
  when `rows` is given, because honouring them would contradict the point
- Always exactly one page

Pad your rows to the full column count yourself if you care about the result;
count characters, do not eyeball them. On a board with a footer, `rows`
addresses **the band you are sending to**, not the whole board.

## 6. How playback works

**Within a band, messages queue and play strictly in order unless you ask for
a jump.** Bands are independent: each has its own queue, its own `priority`
ordering and its own dwell. Fire several messages at once without
coordinating; the display works out the rest.

A `202` from `message` means **validated and delivered to the board's command
stream** — not that a display showed it, or even that one is connected. Queue
position and page counts appear in `/status` once a display picks the message
up (normally well under a second). `preview` gives page counts and
`estimatedMs` up front if you need them before sending.

### Jumping the queue

| `priority` | Where it lands |
| --- | --- |
| `normal` *(default)* | the back of the queue |
| `next` | the head of the queue — plays when the current message finishes |
| `now` | displayed immediately, pre-empting whatever is playing |

**Nothing is discarded by a jump.** A `now` message pre-empts the current one,
but the displaced message goes straight back to the head of the queue and
resumes on the page it was showing. Use the lightest thing that works: `next`
is almost always enough; save `now` for things that are actually urgent.
`priority` is rejected on `preview`.

### Cycling a band

`repeat: true` sends a message back to the end of its own band's queue when it
finishes, so a band can rotate through the same few messages indefinitely. A
recycled message **keeps its id**.

**`DELETE {apiBase}/queue` will not stop a cycle.** It drops what is
*pending*, and a message that is currently showing is not pending — it
finishes and rejoins. Use `POST {apiBase}/clear` with the band's `region` to
stop it. There is no way to switch `repeat` off on a message once it is
queued.

- When the queue drains, **the last page stays on the board.** There is no
  automatic blanking
- Poll `GET {apiBase}/status`, or subscribe to `GET {apiBase}/events` for a
  server-sent-events stream of board state

## 7. Endpoints

| Method | Path (under `{base}`) | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/b/{slug}` | read | discovery: points at the guide and health |
| `GET` | `/api/b/{slug}/AGENTS.md` | read | this document, with live URLs |
| `GET` | `/api/b/{slug}/health` | read | liveness, whether a display is connected |
| `GET` | `/api/b/{slug}/capabilities` | read | charset, grid, accepted values, limits |
| `GET` | `/api/b/{slug}/status` | read | last reported state, plus `stale`/`updatedAt` |
| `GET` | `/api/b/{slug}/events` | read | SSE stream of board state |
| `POST` | `/api/b/{slug}/message` | key | queue `text` or `rows` → `202` |
| `POST` | `/api/b/{slug}/preview` | read | lay out and return pages **without displaying** |
| `POST` | `/api/b/{slug}/clear` | key | stop and blank; optional `region`, omitted = every band |
| `DELETE` | `/api/b/{slug}/queue` | key | drop pending, leave the current message playing |
| `PATCH` | `/api/b/{slug}/config` | key | grid, `footerRows`, motion, dwell, per-band `regions` |

"read" is open on a public board and needs the key on a private one. Two
further routes exist for the display itself and are not for API clients:
`GET .../commands/stream` (the SSE feed a display consumes) and
`POST .../state` (how a display reports what is on the glass).

### Status codes

| Code | Meaning | What to do |
| --- | --- | --- |
| `202` | validated and queued to the board's stream | check `/status` if delivery matters |
| `400` | malformed JSON | fix the body |
| `401` | missing or wrong API key | ask the user for the board's key (in its settings) |
| `403` | private board, no valid credential | ask the user for the key |
| `404` | unknown board — wrong, renamed, or deleted slug | ask the user for the board URL |
| `413` | body or text too large | send less; limits are in `/capabilities` |
| `422` | invalid value | the message says which field and why |

## 8. Recommended workflow

1. `GET {apiBase}/health`. `404` → ask the user for the board URL.
   `boardReady: false` → tell the user no display is connected.
2. `GET {apiBase}/capabilities` to learn the real charset, grid and bands. Do
   not assume — `regions` tells you whether this board has a footer, and
   `grid.mainRows` is your row budget.
3. If the text contains punctuation, digits with symbols, or anything
   non-English, `POST {apiBase}/preview` first and read the `diagnostics`.
4. If something meaningful was dropped, tell the user before displaying it.
5. `POST {apiBase}/message` with the API key.
6. `GET {apiBase}/status` to confirm, if it matters.

Things not to do:

- Do not guess slugs or keys, and do not probe for boards. Ask.
- Do not `clear` to make room for your own message unless the user asked — it
  wipes what they were reading. If you only need to get in front of the queue,
  `priority` does that without discarding anything.
- Do not reach for `priority: "now"` because your message feels important.
  `next` is the right default when something should not wait.
- Do not write to a band you were not asked to write to, and name the band you
  mean on `clear` — with no `region` it wipes every band.
- Do not set `repeat` unless the user wants something to cycle. It cannot be
  switched off afterwards — the only way out is clearing the band.
- Do not reshape the grid to fit your text without saying so.
- Do not send secrets, credentials, or personal data to a board. It is a
  display on a wall; treat everything you send as public.
