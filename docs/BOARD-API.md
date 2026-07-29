# Flapper — Agent Guide

Instructions for driving a Flapper split-flap board over its REST API.

Flapper is a desktop application that renders a grid of mechanical split-flap
tiles — the kind on old airport departure boards. You send it text; it flips
through the alphabet and settles on what you sent. This document tells you
everything you need to drive one.

This guide is served live at `GET /AGENTS.md`, so if you can read it from a board,
that board is reachable and this copy describes *that* instance.

---

## 1. Connecting

The API listens on **`http://127.0.0.1:4747`** by default — local only, no
authentication.

Start here:

```bash
curl -s --max-time 3 http://127.0.0.1:4747/api/health
```

A healthy board answers:

```json
{ "ok": true, "version": "0.1.0", "boardReady": true, "uptimeMs": 12345 }
```

### If localhost does not respond

Do **not** assume the board is broken, and do not start guessing ports or
scanning the network. The board is very often on another machine — it is a wall
display, so it usually is. **Ask the user.** Suggested wording:

> I can't reach a Flapper board at `http://127.0.0.1:4747`. What's the URL of
> the board you'd like me to control? (For example
> `http://192.168.1.42:4747`, or a hostname like `http://lobby-board.local:4747`.)

Then retry `GET /api/health` against the URL they give you. If that also fails,
report the failure plainly and ask whether the app is running — do not keep
retrying.

**If the URL you were given is `0.0.0.0` or `[::]`, it will not work.** Those are
*bind* addresses — what the board listens on — not addresses anything can connect
to. The app's control panel shows `0.0.0.0` when it is in Public mode. Ask for the
machine's real address:

> `0.0.0.0` is the address the board listens on, not one I can reach it at. What's
> the machine's actual address on your network — its LAN IP (something like
> `192.168.1.42`) or hostname? Then I'd use `http://THAT_ADDRESS:4747`.

The user can find it with `ipconfig getifaddr en0` on macOS, or in System
Settings → Network.

Other useful things to ask when the user's answer is incomplete:

> Is the Flapper app currently running on that machine? The API only exists
> while the app is open.

### If `boardReady` is `false`

The server is up but the display window has not finished loading its tile art.
Wait a second and retry. If it stays `false`, the board's assets are missing and
the user needs to run `npm run build:assets` in the project.

---

## 2. Access — there is no authentication

**A Flapper board has no token, password, or key.** Access is controlled purely
by whether the API is bound to the network:

| Board is… | Who can control it |
| --- | --- |
| **Local only** (the default) | only software on that machine |
| **Public** | anyone who can reach the port on that network |

So if you can get a `200` from `/api/health`, you can already drive the board.
There is nothing to ask the user for beyond the URL.

This is a deliberate trade for a display on a trusted network. Two things follow
that you should honour:

- **Treat everything you send as public and permanent-ish.** It is a screen on a
  wall. Never send credentials, personal data, or anything confidential — not
  even as a test.
- **You are not the only writer.** Other clients and the person at the machine can
  send messages too, and nothing stops them overwriting yours. Do not assume the
  board still shows what you last sent; read `/api/status` if it matters.

### Turning network access on

Only the person at the machine can do this, and **you should not ask them to
unless they actually want remote control** — it opens the board to everyone on
their network with no authentication at all.

It is a button in the app's control panel (press `C`): **Local only ⇄ Public**.
Switching rebinds the server; the choice persists across restarts.

There is deliberately **no API route for it**. Being able to set text must not
become the ability to expose someone's machine to their network, so it cannot be
done remotely — including by you.

If a user wants you to drive a board from another machine:

> To control this board from here it needs to be reachable on your network. In the
> Flapper app, press `C` to open the controls and click **Local only** so it
> switches to **Public**, then tell me the URL it shows. Note that this puts the
> board under the control of anyone on that network — there's no password on it.

## 3. The character set — read this before sending anything

**A Flapper board can only display the characters the designer drew.** By
default that is:

```
A-Z   0-9   .   ,   !   (   )   and blank
```

There is **no lowercase, no hyphen, no apostrophe, no question mark, no colon,
no `%`, `#`, `&`, `+`, `=`, `/`, `*` or `?`.**

You do not have to sanitise text yourself — the board does it, and it tells you
what it did. Lowercase is uppercased, accents are folded (`café` → `CAFE`), and
some punctuation is mapped onto glyphs that do exist:

| You send | Board shows | |
| --- | --- | --- |
| `?` or `:` | `.` | sentence termination survives |
| `;` | `,` | |
| `-` `–` `—` `/` `\` `_` `|` | space | no hyphen glyph exists |
| `'` `"` `‘ ’ “ ”` | *removed* | no quote glyph at all |
| `…` | `...` | |
| `[` `]` `{` `}` `<` `>` | `(` `)` | |
| `&` | ` AND ` | so `R&D` reads `R AND D` |
| `@` | ` AT ` | |
| `%` `#` `~` `+` `=` `*` | *dropped* | nothing sensible to map to |

Always confirm the real charset for the board you are talking to:

```bash
curl -s http://127.0.0.1:4747/api/capabilities
```

**Prefer `/api/preview` before `/api/message`** when the text contains anything
unusual. Preview returns exactly what would appear plus a `diagnostics` block
listing every substitution and every dropped character, without touching the
board. Use it to check the result reads correctly, and tell the user if something
important was lost — for example a percentage sign in a figure.

---

## 4. The grid

The board is a grid of tiles. **The default is 8 rows × 20 columns.** Read the
current geometry from `/api/status` or `/api/capabilities`:

```json
"grid": { "cols": 20, "rows": 8, "mainRows": 8, "footerRows": 0,
          "align": "center", "valign": "middle", "wrap": "word" }
```

You can change it, and so can the user. Both routes affect the same board:

- **Over the API**, with `PATCH /api/config`
- **In the app**, from the control panel (press `C`), under **Board** — sliders
  for columns, rows and footer rows, and selects for alignment and wrap mode

```bash
curl -X PATCH http://127.0.0.1:4747/api/config \
  -H 'content-type: application/json' \
  -d '{"cols":20,"rows":8,"align":"center","valign":"middle"}'
```

Supported ranges are 1–80 columns and 1–40 rows, though a typical installation
runs 20–45 columns by 3–10 rows. Larger grids are fine for performance; the
practical limit is how small the tiles get on the display.

Changing the grid re-lays out whatever is currently showing **and everything
still queued**, so it is safe to do mid-message.

Be considerate: if a user asked you to display something, do not silently reshape
their board to make your text fit. Fit the text to the board, or ask.

### Bands: the board can be split in two

A board can reserve rows at the bottom for a **footer** — a second band with its
own queue, playing independently of the one above it. The usual reason is a
standing strip: a "now playing" line, a room name, a URL, while other content
rotates above.

```bash
curl -X PATCH http://127.0.0.1:4747/api/config \
  -H 'content-type: application/json' -d '{"footerRows":2}'
```

By default `footerRows` is `0` and the board is one band called `main`. With a
footer configured there are two, `main` and `footer`, and every message names
the one it is for:

```bash
curl -X POST http://127.0.0.1:4747/api/message \
  -H 'content-type: application/json' \
  -d '{"text":"NOW PLAYING. THE STROKES","region":"footer"}'
```

**The row budget for a message is its band, not the board.** On an 8-row board
with a 2-row footer, a message to `main` has six rows and a message to `footer`
has two. Read `grid.mainRows` and `regions.<id>.rows` from `/api/status` rather
than working it out from `rows` yourself. Omitting `region` means `main`, so a
client that has never heard of bands behaves exactly as before.

`footerRows` is clamped so the main band always keeps at least one row — ask for
more than the board has and `/api/status` reports what you actually got. Setting
it back to `0` removes the band and hands the rows back.

**A footer does not need topping up.** When a queue drains its last page stays on
the board, so a single message to the footer is enough to leave it standing
there. Send another when you want it to change. `/api/status` tells the two
states apart: `regions.<id>.showing` is what is *playing*, and `holding` is the
message a drained band is still displaying.

Each band can hold for its own length, which is usually what you want when one
of them is a standing strip:

```bash
curl -X PATCH http://127.0.0.1:4747/api/config \
  -H 'content-type: application/json' \
  -d '{"regions":{"footer":{"dwellMs":8000}}}'
```

`null` hands a band back to the board-wide `dwellMs`. `regions.<id>.dwellOverride`
in `/api/status` says whether a band set its own or inherited it.

---

## 5. Two ways to send content

### Prose — let the board lay it out

Send `text` and the board handles wrapping, paragraphs, alignment and pagination:

```bash
curl -X POST http://127.0.0.1:4747/api/message \
  -H 'content-type: application/json' \
  -d '{"text":"Flight 447 now boarding at gate 14. Please have your documents ready."}'
```

- Words wrap on boundaries; a word longer than one row is hard-broken
- `\n` is an explicit line break; a blank line is a paragraph gap
- Text too long for the whole grid **paginates**: it becomes several pages, shown
  in sequence, each held before the next. The response tells you how many

Optional fields: `align` (`left`/`center`/`right`), `valign`
(`top`/`middle`/`bottom`), `wrap` (`word`/`char`/`none`), `dwellMs`,
`collapseSpaces`, `substitutions`.

### Explicit rows — place every character yourself

Send `rows` instead: one string per board row, **one character per tile**. Nothing
is wrapped, re-flowed, aligned, or paginated. This is the mode for composed
frames, tables, and anything where position matters.

```bash
curl -X POST http://127.0.0.1:4747/api/message \
  -H 'content-type: application/json' \
  -d '{"rows":[
    "....................",
    ". DEPARTURES  0900 .",
    ". GATE 14  ON TIME .",
    "...................."
  ]}'
```

- Short rows pad on the right; missing rows pad at the bottom; over-long rows are
  clipped and reported
- Characters are still folded onto the displayable set, but **only in
  width-preserving ways** — so cell *i* of your string is always cell *i* of the
  board. A rule that would change width (`&` → ` AND `) blanks that one cell
  instead and reports it, rather than shifting everything after it
- `align`, `valign`, `wrap` and `collapseSpaces` are **rejected** with `422` when
  `rows` is given, because honouring them would contradict the point
- Always exactly one page

Pad your rows to the full column count yourself if you care about the result;
count characters, do not eyeball them.

On a board with a footer, `rows` addresses **the band you are sending to**, not
the whole board: six strings for `main` on an 8-row board with a 2-row footer.
Extra rows are clipped and reported as `truncated`. `grid.mainRows` is the number
to compose against.

---

## 6. How playback works

**Within a band, messages queue and play strictly in order unless you ask for a
jump.** Bands are independent: a footer changing does not disturb the hold on
whatever the main band is showing, and each band has its own queue, its own
`priority` ordering and its own dwell.

You can fire several messages at once without coordinating. Each `POST` returns
immediately with a queue position and an estimate; the board works out the rest.

```bash
for m in "ALPHA" "BRAVO" "CHARLIE"; do
  curl -s -X POST http://127.0.0.1:4747/api/message \
    -H 'content-type: application/json' -d "{\"text\":\"$m\",\"dwellMs\":1500}"
done
```

The board flips to the first, waits for the tiles to actually settle, holds it for
its `dwellMs`, then moves on. Multi-page messages show every page before the next
message begins. `dwellMs` is per-message, so a 5-second notice and 800 ms ticks
can share one batch.

### Jumping the queue

By default a message you send waits behind everything already queued. When
something genuinely cannot wait, `priority` on `POST /api/message` moves it:

| `priority` | Where it lands |
| --- | --- |
| `normal` *(default)* | the back of the queue |
| `next` | the head of the queue — plays when the current message finishes |
| `now` | displayed immediately, pre-empting whatever is playing |

```bash
curl -X POST http://127.0.0.1:4747/api/message \
  -H 'content-type: application/json' \
  -d '{"text":"FIRE DRILL. LEAVE BY THE NEAREST EXIT.","priority":"now"}'
```

**Nothing is discarded by a jump.** A `now` message pre-empts the current one,
but the message it displaced goes straight back to the head of the queue and
resumes on the page it was showing — so a five-page notice interrupted on page
three carries on from page three. The response tells you what you interrupted:

```json
{ "id": "m42", "position": 0, "interrupted": { "id": "m41", "resumesOnPage": 3 } }
```

Use the lightest thing that works. `next` is almost always enough and never
disturbs what someone is mid-way through reading; save `now` for things that are
actually urgent. Neither is a substitute for `POST /api/clear`, which is still
the only way to *discard* what is queued.

`priority` is rejected on `/api/preview`, which never queues anything.

### Cycling a band

`repeat: true` sends a message back to the end of its own band's queue when it
finishes, so a band can rotate through the same few messages indefinitely:

```bash
for m in ALPHA BRAVO CHARLIE; do
  curl -s -X POST http://127.0.0.1:4747/api/message \
    -H 'content-type: application/json' -d "{\"text\":\"$m\",\"repeat\":true}"
done
```

A recycled message **keeps its id**, so a queue that is cycling is the same few
messages going round rather than a stream of copies — worth knowing if you are
tracking what is on a board. It comes back as an ordinary message: a
`priority: "now"` that also repeats jumps the queue once, not every time round.

**`DELETE /api/queue` will not stop a cycle.** It drops what is *pending*, and a
message that is currently showing is not pending — it finishes and rejoins. Use
`POST /api/clear` with the band's `region` to stop it. There is no way to switch
`repeat` off on a message once it is queued.

Other consequences to keep in mind:

- When the queue drains, **the last page stays on the board.** There is no
  automatic blanking
- Poll `GET /api/status` to see what is showing and what is waiting, or subscribe
  to `GET /api/events` for a server-sent-events stream pushed on every change.
  A jumped message shows its `priority` in the queue listing, and a pre-empted
  one shows `resumesOnPage`

---

## 7. Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | discovery: points at this document and at health |
| `GET` | `/AGENTS.md` | this document, for the live board |
| `GET` | `/api/health` | liveness, version, whether the display is ready |
| `GET` | `/api/capabilities` | charset, grid, accepted values, limits |
| `GET` | `/api/status` | current message, rendered rows, queue, grid, motion |
| `GET` | `/api/events` | SSE stream of state, pushed on change |
| `POST` | `/api/message` | queue `text` or `rows`, optionally `region`, `priority`, `repeat` → `202` |
| `POST` | `/api/preview` | lay out and return pages **without displaying** |
| `POST` | `/api/clear` | flush and blank; optional `region`, omitted means every band |
| `DELETE` | `/api/queue` | flush pending, leave the current message playing; optional `region` |
| `PATCH` | `/api/config` | grid, `footerRows`, alignment, wrap, motion, dwell, per-band `regions` |

### Status codes

| Code | Meaning | What to do |
| --- | --- | --- |
| `202` | queued | read `id`, `pages`, `position`, `estimatedMs`, `interrupted` |
| `400` | malformed JSON | fix the body |
| `404` | unknown route | the body lists valid routes |
| `413` | body or text too large | send less; limits are in `/api/capabilities` |
| `422` | invalid value | the message says which field and why |
| `429` | queue full | wait, or flush |
| `503` | display not ready | wait and retry |
| `504` | display did not answer | the app may be wedged; tell the user |

---

## 8. Recommended workflow

1. `GET /api/health`. No response → **ask the user for the URL** (section 1).
2. `GET /api/capabilities` to learn the real charset, grid and bands. Do not
   assume — `regions` tells you whether this board has a footer, and
   `grid.mainRows` is your row budget.
3. If the text contains punctuation, digits with symbols, or anything non-English,
   `POST /api/preview` first and read the `diagnostics`.
4. If something meaningful was dropped, tell the user before displaying it.
5. `POST /api/message`.
6. `GET /api/status` to confirm, if it matters.

Things not to do:

- Do not scan ports or probe hosts looking for a board. Ask.
- Do not `POST /api/clear` to make room for your own message unless the user
  asked you to — it wipes what they were reading. If you only need to get in
  front of the queue, `priority` does that without discarding anything.
- Do not reach for `priority: "now"` because your message feels important. It
  takes the board away from whatever someone is reading mid-sentence. `next` is
  the right default when something should not wait.
- Do not write to a band you were not asked to write to. A footer is usually
  standing information someone put there deliberately; `POST /api/clear` with no
  `region` wipes it along with everything else, so name the band you mean.
- Do not set `repeat` unless the user wants something to cycle. It cannot be
  switched off afterwards — the only way out is clearing the band, which takes
  everything else in it with it.
- Do not reshape the grid to fit your text without saying so.
- Do not send secrets, credentials, or personal data to a board. It is a display
  on a wall; treat everything you send as public.
