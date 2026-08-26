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

Boards are created by signed-in users from `{base}/dashboard`, or by an agent
connected over MCP with the user's account (`create_board`) — never
anonymously. Each board has:

- a **slug** — its URL name (`/b/lobby-board`), chosen and *editable* by the
  owner. **Renaming a board moves its API base**; a `404` on a known board
  usually means it was renamed or deleted. Ask the user for the current URL
  rather than guessing slugs.
- an **API key** — one 64-hex capability per board, shown on the board's
  manage page (`/b/{slug}/manage`, owner-only) and regenerable there.
- a **privacy flag** — public boards can be watched by anyone with the URL;
  private boards need the key (or the owner's login) even to read.

### Connecting

```bash
curl -s --max-time 5 {apiBase}/health
```

```json
{ "ok": true, "version": "4.0.0", "boardReady": true, "uptimeMs": 12345 }
```

**`boardReady` means a display is connected right now** — some browser tab or
wall screen has the board open and has reported within the last few seconds.
When it is `false` your messages are still accepted and queued, but nothing is
showing them; tell the user to open the board URL on the screen that should
show it.

### MCP

The deployment also speaks the Model Context Protocol at `{base}/api/mcp` —
one endpoint for every board (Streamable HTTP, stateless). The tools mirror
the REST endpoints — same validation, same access gates, same status
semantics carried inside tool errors. Two ways to connect:

- **Sign in (OAuth)** — add `{base}/api/mcp` as a connector in claude.ai /
  Claude Desktop, Claude Code (`claude mcp add --transport http <name>
  {base}/api/mcp`, then authenticate from `/mcp`), or ChatGPT developer mode,
  and authorize when the browser opens; no key needed (clients self-register
  via DCR/CIMD). Connected this way you act as your account: every board tool
  takes a `slug` argument, and the account tools `list_boards`,
  `create_board`, and `get_board_key` come alive. `create_board` takes a
  `type`, or a `template` (the same starting points the /new screen
  offers: a type plus preset config and a seeded queue — `office-clock`,
  `match-day`, `departures`, … ; name/timezone/fallback still override
  it), and answers with the slug and URLs only — a board's key is never emitted as a side
  effect; `get_board_key` is the explicit ask, for when a display or script
  genuinely needs it.
- **Board API key** — present a board's key as the bearer token; every tool
  drives that board and `slug` must be omitted. The headless/automation mode:
  Claude Code takes `--header "authorization: Bearer <key>"`, ChatGPT offers
  bearer auth, claude.ai custom connectors take request headers.

Board tools: `get_board_info`, `get_docs`, `get_health`, `get_capabilities`,
`get_status`, `preview`, `post_message`, `list_queue`, `update_queue_item`,
`delete_queue_item`, `reorder_queue`, `flush_queue`, `clear_board`,
`update_config`, `export_queue`. Board management beyond the account tools
(rename, privacy, deletion, key rotation) stays on the manage page.

## 2. Access — reads are open, writes need the key

- **Writes** (`message`, `clear`, the queue, `config`) always need the key:
  `authorization: Bearer <key>`. Without it: `401`.
- **Reads** (status, capabilities, events, preview, this document) are open on
  public boards. On a **private** board they need the key too — `403`
  otherwise. The `?key=<key>` query form exists for wall displays and tools
  that cannot send headers; note it lands in logs and history.
- **Management** (rename, privacy, key rotation, deletion) is not on this API
  at all — it lives on the owner's manage page behind their login.

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

The same call sets the theme: `{"theme":"canary"}` repaints every display of
the board in Norwich green; `"classic"` is the charcoal original. Always take
the list from `/capabilities` (`themes`); a deployment may ship more, and an
unknown id is a 422. Do not change a board's theme unless asked to.

### A board's own look

A board can go beyond the presets: `themePack` in the same config is the
board's own overrides on top of its `theme`. Read `GET {apiBase}/theme` first
- it returns the preset (`theme`), the stored overrides (`themePack`, `null`
if none), the fully resolved `pack` the displays draw, and a `rev`.

```bash
curl -X PATCH {apiBase}/config \
  -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"themePack":{"card":{"fill":"#f4efe6","edge":"#d8cfbf"},"glyph":{"fill":"#1f2a44","font":"400 0.9em Georgia, serif"},"states":{"!":{"glyph":{"fill":"#d9381e"}}}}}'
```

- `card`, `hinge`, `glyph`, `motion` merge a level deep over the preset;
  `states` (per-character overrides), `art` (inline images by key) and
  `fonts` replace whole when present.
- The server stores only what differs from the preset, so sending the
  whole `pack` back with one change is the same as sending the change.
  `{"themePack": null}` resets to the preset.
- Art is `data:image/png;base64,…` or `data:image/webp;base64,…` (or a path
  the app ships) - never a remote URL. Limits and every field's range are in
  `/capabilities` under `themePack`; an oversize pack is a `413`, a bad
  value a `422` naming the field.
- `/queue` carries `themeRev`, not the pack: a display refetches `/theme`
  when the revision changes, and `/theme` honours `If-None-Match`.

Changing a board's look is a visible act on someone's wall. Do it only when
asked, and prefer the smallest change that does what was asked.

### Bands are paused

Flapper 1.x/2.x could split the board into a main band and a footer.
**Multi-band boards return in a future release**: for now every board is one
band (`main`), `footerRows` must stay `0`, and a `region` other than `main`
is refused with a `422` rather than misplayed. Do not design around footers
until they come back.

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
`collapseSpaces`, `substitutions`, `label` (a name for the item itself,
shown wherever it's picked out of a list — a board's control room, say —
never on the display).

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
count characters, do not eyeball them.

## 6. How playback works

**Playback depends on the board's type** — the per-board copy of this guide
(`GET {apiBase}/AGENTS.md`) documents only the type it belongs to. A **live
queue** board plays in order, below. A **scheduled** or **shared screens**
board is a clock: every item carries a `schedule` spec (`interval`,
`everyN`, `hourly`, `daily`, `weekly`, `once` — plus `durationMs`), the
active item is a pure function of the server clock on every screen, a
fallback message stands in the gaps, and there is nothing to advance. A
message without a schedule on a clock board plays once, immediately.

### Live queues

**The queue lives on the server.** `POST {apiBase}/message` adds to it; the
display plays it strictly in order and reports each completion. You can stack
messages while no display is connected — they play when one opens. A `202`
means **validated and queued**; `/status`'s `boardReady`/`stale` say whether
a display is connected, `frozen` says whether that display can actually
animate (a browser tab in the background keeps its heartbeat but loses
`requestAnimationFrame`, so the board halts mid-flip), and its `queue`
block is server truth either way. `lines` is the rows the display was last
told to show — during a transition (`animating: true`) the glass is still
part-way there. `showing` answers "what is on the glass?" in every state:
the message being played, or, once the queue drains, the finished one whose
last page still stands (`held: true`); `phase` is `playing`, `holding`, or
`blank`.
`preview` gives page counts and `estimatedMs` up front if you need them.

### Jumping the queue

| `priority` | Where it lands |
| --- | --- |
| `normal` *(default)* | the back of the queue |
| `next` | the head of the queue — plays when the current message finishes |
| `now` | displayed immediately, pre-empting whatever is playing |

**Nothing is discarded by a jump.** A `now` message pre-empts the current one,
but the displaced message goes straight back to the head of the queue and
plays again from the top once its turn comes back round — not from the page
it was on when it was pre-empted; page-resume from the 1.x desktop is
deliberately gone. Use the lightest thing that works: `next` is almost
always enough; save `now` for things that are actually urgent. `priority` is
rejected on `preview`.

Add `"interrupt": true` alongside `priority: "now"` for a message that is an
event rather than a slide in the rotation — a live announcement, not a
standing part of what cycles. It changes nothing about playback, and no
ranking exists between interrupters: firing one follows the same rule as any
`now` message above — it plays immediately, and whatever it displaced
(another interrupter included) simply gets its own turn once this one's is
over. A board's own control room reads `interrupt` to keep the message out
of the rotation's list and show it separately instead. `interrupt` and
`loop` are independent fields — a control room UI may only offer one-shot
interrupters, but the API accepts `{"priority": "now", "interrupt": true,
"loop": true}` for one that keeps cutting back to the front.

### Expiring a message

Live-queue boards only (a scheduled board's items already expire with their
own schedule). `"expiresInMs": 180000` removes the item outright once that
many milliseconds have passed — not just its turn ending, gone from the
queue entirely, whether or not it ever played. Nothing sets this by
default: a message left off it stands until dismissed. Give an automated
interrupter one whenever nothing else is guaranteed to clean it up later.

`PATCH {apiBase}/queue/items/{id}` with `{"expiresInMs": 180000}` re-bases
the countdown from now; `{"expiresInMs": null}` clears it back to "until
dismissed". Checked lazily, on the next `GET {apiBase}/queue` after it's
due — if the expired item was the one on the glass, the board moves on.

### Saved interrupters — name it once, fire it by name

Posting `{"priority": "now", "interrupt": true, ...}` straight to
`/message` fires an interrupter on the spot, but means resending its text
every time. For one that fires more than once, save it instead:

```bash
curl -X POST {apiBase}/interrupters \
  -H 'authorization: Bearer KEY' -H 'content-type: application/json' \
  -d '{"name": "fire-evacuate", "text": "FIRE - EVACUATE NOW", "durationMs": 600000}'
```

Then fire it, whenever, with nothing but its name:

```bash
curl -X POST {apiBase}/interrupters/fire-evacuate/fire -H 'authorization: Bearer KEY'
```

`durationMs` is one or the other, never both: a number is a hard limit —
shown, then gone outright the instant it's up, whichever comes first
between that and its own turn ending. Omit it for the switch instead: it
blocks the rotation entirely, full stop, until dismissed (removed) or
broken by a higher-ranked interrupter firing — there is no unbounded
"forever" the engine can promise, so this materializes as the longest
dwell it supports (currently 24 hours) with no expiry, which is the same
thing in practice.

This is the one door from a saved interrupter to the glass — it posts
exactly the saved text with `priority: "now"`, `interrupt: true`, and that
preset's own Duration translated to `dwellMs`/`expiresInMs`, the same as
composing it by hand would. `GET {apiBase}/interrupters` lists what's
saved; `POST {apiBase}/interrupters` with a name that already exists
replaces it outright (editing is re-saving, not a separate PATCH);
`DELETE {apiBase}/interrupters/{name}` removes one. A board keeps at most
20. Saving one never touches the glass — nothing is queued until
`.../fire` is called on it by name.

Saved order is the only ranking a saved interrupter has — there is no
rank field. `POST {apiBase}/interrupters/reorder` with `{"names": [...]}`
(every saved name, once) sets it, and it *is* enforced: firing one is
refused with a `409` if what's currently showing is itself a saved
interrupter ranked ahead of it (earlier in the saved order) — move the
one you're firing above it first, or wait for its own turn to end. Two
saved interrupters can never break each other out of order; a raw
`{"interrupt": true, "priority": "now"}` straight to `/message`, bypassing
the saved system entirely, still pre-empts unconditionally as it always
has — this rule only applies between two *named* interrupters.

### Looping

`loop: true` (alias: `repeat`) sends a played message to the back of the
queue instead of removing it, so a few looping messages rotate indefinitely.
A looping item keeps its id, and you can switch a loop off:
`PATCH {apiBase}/queue/items/{id}` with `{"loop": false}`, or remove the
item.

**`DELETE {apiBase}/queue` will not stop a loop.** It drops what is
*pending*, and the playing message is not pending — it finishes and rejoins.
Use `POST {apiBase}/clear` to stop everything, or edit the item.

- When the queue drains, **the last page stays on the board**, across display
  reloads. `clear` is the deliberate blank
- The queue holds at most 500 items across every board type; a full queue
  answers `429`
- **A board's type may cap it far below that, and roll instead of reject.**
  A live-queue board defaults to 5 (configurable per board, 1–50): past the
  cap, adding a `normal` or `next` message quietly rolls the oldest
  *waiting* message off to make room, a ticker rather than a form. The
  item on the glass is never rolled. `now` is exempt from this cap
  entirely - rare and deliberate by nature, and a board sitting exactly at
  its cap (a one-message "sign", most often) must still be interruptible.
  `GET {apiBase}/queue`'s `config.queueCap` carries this board's actual
  limit (see also `docs/QUEUES.md`)

### Editing the queue

| Call | Does |
| --- | --- |
| `GET {apiBase}/queue` | the list, what is current, and the board config |
| `POST {apiBase}/queue/items` | add — same body as `/message` |
| `PATCH {apiBase}/queue/items/{id}` | edit `text`/`rows`, toggle `loop`, set/clear `expiresInMs` |
| `DELETE {apiBase}/queue/items/{id}` | remove; removing the playing item skips |
| `POST {apiBase}/queue/reorder` | `{itemId, afterId}` — `afterId: null` is the front |

## 7. Endpoints

| Method | Path (under `{base}`) | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/b/{slug}` | read | discovery: points at the guide and health |
| `GET` | `/api/b/{slug}/AGENTS.md` | read | this document, with live URLs |
| `GET` | `/api/b/{slug}/health` | read | liveness, whether a display is connected; `realtime: "ok" \| "unavailable"` |
| `GET` | `/api/b/{slug}/capabilities` | read | charset, grid, accepted values, limits |
| `GET` | `/api/b/{slug}/status` | read | last reported state, plus `stale`/`frozen`/`updatedAt` |
| `GET` | `/api/b/{slug}/events` | read | SSE stream of board state |
| `POST` | `/api/b/{slug}/message` | key | queue `text` or `rows` (+`loop`) → `202` |
| `GET` | `/api/b/{slug}/queue` | read | the queue: items, current, config, `themeRev` |
| `GET` | `/api/b/{slug}/theme` | read | the board's theme: preset, overrides, resolved pack, `rev` |
| `POST` | `/api/b/{slug}/queue/items` | key | add — same body as `/message` |
| `PATCH` | `/api/b/{slug}/queue/items/{id}` | key | edit, toggle `loop` |
| `DELETE` | `/api/b/{slug}/queue/items/{id}` | key | remove (current = skip) |
| `POST` | `/api/b/{slug}/queue/reorder` | key | `{itemId, afterId}` |
| `POST` | `/api/b/{slug}/preview` | read | lay out and return pages **without displaying** |
| `POST` | `/api/b/{slug}/clear` | key | stop and blank; optional `region`, omitted = every band |
| `DELETE` | `/api/b/{slug}/queue` | key | drop pending, leave the current message playing |
| `GET` | `/api/b/{slug}/interrupters` | read | saved interrupters: name, text, Duration |
| `POST` | `/api/b/{slug}/interrupters` | key | save one — a name that exists already is replaced outright |
| `DELETE` | `/api/b/{slug}/interrupters/{name}` | key | remove a saved interrupter |
| `POST` | `/api/b/{slug}/interrupters/{name}/fire` | key | fire a saved one now — the only door from saved to the glass |
| `POST` | `/api/b/{slug}/interrupters/reorder` | key | `{names: [...]}`, every saved name once — rail order, the only ranking one has |
| `GET` | `/api/b/{slug}/export` | key | every queued item in a re-postable shape |
| `PATCH` | `/api/b/{slug}/config` | key | grid, `theme`, `themePack`, motion, dwell (`footerRows` must stay 0; `regions.main.dwellMs` only) |
| `GET` / `POST` | `/api/b/{slug}/key` | owner | read / rotate the API key — the owner's session only, never the key itself |

"read" is open on a public board and needs the key on a private one;
"owner" is the signed-in owner (the manage page, or a connector signed in
as them). Three further routes belong to the display itself and are not for
API clients:
`GET .../commands/stream`, `POST .../state`, and `POST .../queue/advance`
(the last two take a display credential the board page holds).

### Status codes

| Code | Meaning | What to do |
| --- | --- | --- |
| `202` | validated and queued; body carries `id`, `position` (1-based place in the queue) and `ahead` (how many play first) | check `/status` if delivery matters |
| `400` | malformed JSON | fix the body |
| `401` | missing or wrong API key | ask the user for the board's key (in its manage page) |
| `403` | private board, no valid credential | ask the user for the key |
| `404` | unknown board — wrong, renamed, or deleted slug | ask the user for the board URL |
| `413` | body or text too large | send less; limits are in `/capabilities` |
| `422` | invalid value | the message says which field and why |
| `429` | queue full — the 500-item backstop, or this board's own (lower) cap with nothing left to roll off | flush, clear, remove an item, or wait |
| `503` | the realtime service is unavailable — the write you made is saved, displays catch up when it returns | retry reads later; do not retry writes, they succeeded |

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
- Do not send a `region` — bands are paused and anything but `main` is a
  `422`; `clear` blanks the whole board.
- Do not set `loop` unless the user wants something to cycle; switch it off
  with `PATCH /queue/items/{id}` `{"loop": false}` or remove the item.
- Do not reshape the grid to fit your text without saying so.
- Do not send secrets, credentials, or personal data to a board. It is a
  display on a wall; treat everything you send as public.
