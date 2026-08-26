/**
 * The agent guide served at GET /api/b/{slug}/AGENTS.md, generated with the
 * asking board's live base URL and slug baked into every example so the whole
 * document is copy-pasteable against the board being asked.
 *
 * docs/BOARD-API.md in the repo is the human-readable companion; change the
 * contract and both must move together.
 */

export function boardDoc({ base, slug, isPrivate = false, version, type = null }) {
  const api = `${base}/api/b/${slug}`;
  const display = `${base}/b/${slug}`;
  const KEY = 'KEY'; // placeholder the reader replaces with the board's API key
  const clock = type?.playback === 'clock';
  return `# Flapper — Agent Guide

Instructions for driving this Flapper split-flap board over its REST API.${
    type
      ? `

**This board's type is \`${type.id}\` (${type.name}).** ${type.tagline} How
playback works below is specific to this type.`
      : ''
  }

Flapper renders a grid of mechanical split-flap tiles — the kind on old airport
departure boards. The board is a web page (open it on any screen at
\`${display}\`); this API is how software drives it. You send text; the display
flips through the alphabet and settles on what you sent.

This guide is served live at \`GET ${api}/AGENTS.md\`; this copy describes the
board \`${slug}\` specifically.${
    isPrivate
      ? `

**This board is private.** Every call in this document — including reads —
needs the board's API key, either as \`authorization: Bearer <key>\` or as a
\`?key=<key>\` query parameter. The examples below assume you have it; if you
do not, ask the user for it (it lives in the board's manage page).`
      : ''
  }

---

## 1. Connecting

Start here:

\`\`\`bash
curl -s --max-time 5 ${api}/health${isPrivate ? `?key=${KEY}` : ''}
\`\`\`

A healthy board answers:

\`\`\`json
{ "ok": true, "version": "${version}", "boardReady": true, "uptimeMs": 12345 }
\`\`\`

**\`boardReady\` means a display is connected right now** — some browser tab or
wall screen has the board open and has reported in within the last few seconds.
When it is \`false\` your messages are still accepted and queued, but nothing is
showing them. Tell the user:

> Nothing is currently displaying this board. Open ${display}
> on the screen that should show it, and it will pick up queued messages.

A \`404\` means the slug is wrong, or the board was renamed or deleted — slugs
are editable by the owner, and **renaming a board moves its API base**. Ask the
user for the current board URL rather than guessing slugs.

### MCP

This deployment also speaks the Model Context Protocol at
\`${base}/api/mcp\` — one endpoint for every board (Streamable HTTP). Two
ways to connect; the tools mirror the endpoints below either way, so prefer
MCP over hand-rolled HTTP when your client can hold a connection:

- **Sign in (OAuth)** — just add \`${base}/api/mcp\` as a connector and
  authorize when prompted; no key needed. Claude and ChatGPT drive the flow
  themselves (DCR/CIMD). Connected this way you act as your account: every
  board tool takes a \`slug\` argument, and \`list_boards\`,
  \`create_board\`, and \`get_board_key\` manage your boards. Creating a
  board does not hand you its key; ask \`get_board_key\` only when a display
  or script genuinely needs one.
- **Board API key** — present this board's key as the bearer token and every
  tool drives this board (omit \`slug\`). The headless/automation mode:
  - Claude Code: \`claude mcp add --transport http ${slug} ${base}/api/mcp --header "authorization: Bearer ${KEY}"\`
  - claude.ai custom connectors: the key as an \`authorization\` request
    header (\`Bearer ${KEY}\`); ChatGPT: auth = bearer token.

Everything in this document about the charset, the queue, and status codes
applies to the tools identically. Board management beyond the account tools
(rename, privacy, deletion) stays on the manage page; a connector signed
in as the owner may read or rotate a board's key (\`get_board_key\`).

## 2. Access

Boards are owned by signed-in users, and every board has one **API key**,
visible to its owner on the board's manage page (\`${display}/manage\`).

- **Writes** — \`message\`, \`clear\`, the queue, \`config\` — always need the
  key: \`authorization: Bearer <key>\`. Without it you get a \`401\`.
- **Reads** — status, capabilities, events, preview, this document — are open
  on public boards. On a **private** board they need the key too (\`401\`/\`403\`
  otherwise); the \`?key=\` query form exists for wall displays and tools that
  cannot send headers.

Two things to honour:

- **Treat everything you send as public.** It is a screen on a wall. Never send
  credentials, personal data, or anything confidential — not even as a test.
- **You are not the only writer.** Other clients with the key, and the person
  at the display, can send messages too. Do not assume the board still shows
  what you last sent; read \`${api}/status\` if it matters.

## 3. The character set — read this before sending anything

**A Flapper board can only display the characters the designer drew.** By
default that is:

\`\`\`
A-Z   0-9   .   ,   !   (   )   and blank
\`\`\`

There is **no lowercase, no hyphen, no apostrophe, no question mark, no colon,
no \`%\`, \`#\`, \`&\`, \`+\`, \`=\`, \`/\`, \`*\` or \`?\`.**

You do not have to sanitise text yourself — the board does it, and it tells you
what it did. Lowercase is uppercased, accents are folded (\`café\` → \`CAFE\`),
and some punctuation is mapped onto glyphs that do exist:

| You send | Board shows | |
| --- | --- | --- |
| \`?\` or \`:\` | \`.\` | sentence termination survives |
| \`;\` | \`,\` | |
| \`-\` \`–\` \`—\` \`/\` \`\\\` \`_\` \`|\` | space | no hyphen glyph exists |
| \`'\` \`"\` \`‘ ’ “ ”\` | *removed* | no quote glyph at all |
| \`…\` | \`...\` | |
| \`[\` \`]\` \`{\` \`}\` \`<\` \`>\` | \`(\` \`)\` | |
| \`&\` | \` AND \` | so \`R&D\` reads \`R AND D\` |
| \`@\` | \` AT \` | |
| \`%\` \`#\` \`~\` \`+\` \`=\` \`*\` | *dropped* | nothing sensible to map to |

Always confirm the real charset for the board you are talking to:

\`\`\`bash
curl -s ${api}/capabilities${isPrivate ? `?key=${KEY}` : ''}
\`\`\`

**Prefer \`POST ${api}/preview\` before \`message\`** when the text contains
anything unusual. Preview returns exactly what would appear plus a
\`diagnostics\` block listing every substitution and every dropped character,
without touching the board — and it works even when no display is connected.
Use it to check the result reads correctly, and tell the user if something
important was lost — for example a percentage sign in a figure.

## 4. The grid

The board is a grid of tiles. **The default is 8 rows × 20 columns.** Read the
current geometry from \`${api}/status\` or \`${api}/capabilities\`:

\`\`\`json
"grid": { "cols": 20, "rows": 8, "mainRows": 8, "footerRows": 0,
          "align": "center", "valign": "middle", "wrap": "word" }
\`\`\`

You can change it (with the key), and so can the person at the display:

\`\`\`bash
curl -X PATCH ${api}/config \\
  -H 'authorization: Bearer ${KEY}' -H 'content-type: application/json' \\
  -d '{"cols":20,"rows":8,"align":"center","valign":"middle"}'
\`\`\`

Supported ranges are 1–80 columns and 1–40 rows. Changing the grid re-lays out
whatever is showing and everything still queued, so it is safe to do
mid-message. Be considerate: if a user asked you to display something, do not
silently reshape their board to make your text fit. Fit the text to the board,
or ask.

The same call sets the theme: \`{"theme":"canary"}\` repaints every display of
the board in Norwich green; \`"classic"\` is the charcoal original. Always take
the list from \`/capabilities\` (\`themes\`); a deployment may ship more, and an
unknown id is a 422. Do not change a board's theme unless asked to.

### A board's own look

A board can go beyond the presets: \`themePack\` in the same config is the
board's own overrides on top of its \`theme\`. Read \`GET ${api}/theme\` first
- it returns the preset (\`theme\`), the stored overrides (\`themePack\`, \`null\`
if none), the fully resolved \`pack\` the displays draw, and a \`rev\`.

\`\`\`bash
curl -X PATCH ${api}/config \\
  -H 'authorization: Bearer ${KEY}' -H 'content-type: application/json' \\
  -d '{"themePack":{"card":{"fill":"#f4efe6","edge":"#d8cfbf"},"glyph":{"fill":"#1f2a44","font":"400 0.9em Georgia, serif"},"states":{"!":{"glyph":{"fill":"#d9381e"}}}}}'
\`\`\`

- \`card\`, \`hinge\`, \`glyph\`, \`motion\` merge a level deep over the preset;
  \`states\` (per-character overrides), \`art\` (inline images by key) and
  \`fonts\` replace whole when present.
- The server stores only what differs from the preset, so sending the
  whole \`pack\` back with one change is the same as sending the change.
  \`{"themePack": null}\` resets to the preset.
- Art is \`data:image/png;base64,…\` or \`data:image/webp;base64,…\` (or a path
  the app ships) - never a remote URL. Limits and every field's range are in
  \`/capabilities\` under \`themePack\`; an oversize pack is a \`413\`, a bad
  value a \`422\` naming the field.
- \`/queue\` carries \`themeRev\`, not the pack: a display refetches \`/theme\`
  when the revision changes, and \`/theme\` honours \`If-None-Match\`.

Changing a board's look is a visible act on someone's wall. Do it only when
asked, and prefer the smallest change that does what was asked.

### Bands are paused

Flapper 1.x/2.x could split the board into a main band and a footer.
**Multi-band boards return in a future release**: for now every board is one
band (\`main\`), \`footerRows\` must stay \`0\`, and a \`region\` other
than \`main\` is refused with a \`422\` rather than misplayed. Do not design
around footers until they come back.

## 5. Two ways to send content

### Prose — let the board lay it out

\`\`\`bash
curl -X POST ${api}/message \\
  -H 'authorization: Bearer ${KEY}' -H 'content-type: application/json' \\
  -d '{"text":"Flight 447 now boarding at gate 14."}'
\`\`\`

- Words wrap on boundaries; a word longer than one row is hard-broken
- \`\\n\` is an explicit line break; a blank line is a paragraph gap
- Text too long for the grid **paginates**: several pages shown in sequence

Optional fields: \`align\` (\`left\`/\`center\`/\`right\`), \`valign\`
(\`top\`/\`middle\`/\`bottom\`), \`wrap\` (\`word\`/\`char\`/\`none\`),
\`dwellMs\`, \`collapseSpaces\`, \`substitutions\`, \`label\` (a name for the
item itself, shown wherever it's picked out of a list - the control room's
queue tab rail - never on the display).

### Explicit rows — place every character yourself

Send \`rows\` instead: one string per board row, **one character per tile**.
Nothing is wrapped, aligned, or paginated — the mode for composed frames and
tables.

\`\`\`bash
curl -X POST ${api}/message \\
  -H 'authorization: Bearer ${KEY}' -H 'content-type: application/json' \\
  -d '{"rows":[". DEPARTURES  0900 .",". GATE 14  ON TIME ."]}'
\`\`\`

- Short rows pad right; missing rows pad at the bottom; over-long rows are
  clipped and reported
- Characters are still folded onto the displayable set, but **only in
  width-preserving ways** — cell *i* of your string is always cell *i* of the
  board. A rule that would change width (\`&\` → \` AND \`) blanks that cell
  instead
- \`align\`, \`valign\`, \`wrap\` and \`collapseSpaces\` are **rejected** with
  \`422\` when \`rows\` is given
- \`rows\` addresses the band you send to, not the whole board

## 6. How playback works

**The queue lives on the server.** \`POST ${api}/message\` adds to it${
    clock ? '' : `; the
display plays it strictly in order and reports each completion`
  }. You can stack
messages while no display is connected — they play when one opens. A \`202\`
means **validated and queued**; \`${api}/status\`'s \`boardReady\`/\`stale\`
say whether a display is connected and \`frozen\` whether it can actually
animate (a background browser tab heartbeats but cannot draw - tell the
user to bring it to the front). Its \`lines\` are the rows the display was
last told to show; while \`animating\` is true the glass is still turning.
\`showing\` is what is on the glass in every state - the message playing,
or the finished one still standing (\`held: true\`); \`phase\` is
\`playing\`, \`holding\`, or \`blank\`. A \`202\` carries \`position\`
(1-based place in the queue) and \`ahead\`.
\`POST ${api}/preview\` gives page counts and \`estimatedMs\` up front if
you need them before sending.

One board, one band, for now: **multi-band boards (footers) return in a
future release** — any \`region\` other than \`main\`, and any
\`footerRows > 0\`, is a \`422\`.
${
    clock
      ? `
### The clock owns playback

This board is **scheduled**: every item carries a \`schedule\` spec and the
board shows whichever item the clock says is active — the board's
**fallback message** stands in the gaps. There is no play order and nothing
to advance; every screen showing this board evaluates the same schedule
against the same server clock, so they agree without coordinating.

Send a message with a schedule:

\`\`\`bash
curl -X POST ${api}/message \\
  -H 'authorization: Bearer ${KEY}' -H 'content-type: application/json' \\
  -d '{"text": "LUNCH IS SERVED", "schedule": {"kind": "daily", "at": "12:00", "durationMs": 60000}}'
\`\`\`

| \`schedule.kind\` | Fields | Fires |
| --- | --- | --- |
| \`interval\` | \`everyMs\` (≥5000) | every N ms, anchored when the item was created |
| \`everyN\` | \`minutes\`, \`offsetSec?\` | every N minutes from local midnight (board tz) |
| \`hourly\` | \`minute\`, \`second?\` | at :MM every hour |
| \`daily\` | \`at: "HH:MM[:SS]"\` | every day at that wall time (board tz) |
| \`weekly\` | \`dow\` (0=Sun), \`at\` | weekly on that day |
| \`once\` | \`atMs\` | once, at that server-time instant |

Every kind takes an optional \`durationMs\`: how long the item holds the
glass from each trigger. Omit it for one read-through of the text; \`null\`
means **until the item's own next trigger** (a standing sign that timed
overlays interrupt and hand back to). The latest trigger wins; exact ties
alternate. A \`once\` item that has played out is deleted automatically.

A message **without** a schedule becomes \`{"kind": "once"}\` at this
instant — it plays through once over whatever is scheduled, then the
schedule resumes. \`priority: next\` delays that to the next slot change;
there is no other use for priorities here. \`loop\` is meaningless on a
clock and is ignored.

\`GET ${api}/queue\` reports the clock's view: \`activeItemId\`,
\`onFallback\`, \`nextChangeAtMs\`, and \`serverNowMs\`. The board's
timezone and fallback message live in its config
(\`PATCH ${api}/config\` with \`{"timezone": …, "fallback": …}\`).
`
      : `
### Jumping the queue

| \`priority\` | Where it lands |
| --- | --- |
| \`normal\` *(default)* | the back of the queue |
| \`next\` | the head of the queue — plays when the current message finishes |
| \`now\` | displayed immediately, pre-empting whatever is playing |

**Nothing is discarded by a jump.** A \`now\` message pre-empts the current
one, but the displaced message returns to the head of the queue and plays
again from the top once its turn comes back round - not from the page it
was on when it was pre-empted. Use the lightest thing that works: \`next\`
is almost always enough; save \`now\` for things that are actually urgent.

Add \`"interrupt": true\` alongside \`priority: "now"\` for a message that is
an event rather than a slide in the rotation - a live announcement, not a
standing part of what cycles. It changes nothing about playback, and no
ranking exists between interrupters: firing one follows the same rule as
any \`now\` message above - it plays immediately, and whatever it displaced
(another interrupter included) simply gets its own turn once this one's is
over. The control room's own UI reads \`interrupt\` to keep the message out
of the tab rail and list it separately instead, ordered however you leave
it there.

\`interrupt\` and \`loop\` are independent fields - the control room's own
compose form never offers Loop for an interrupter (firing one is meant to be
one-shot), but that is a UI choice, not an API rule: \`{"priority": "now",
"interrupt": true, "loop": true}\` is accepted and gives you a message that
cuts to the front immediately, on every occasion it's due, forever, same as
any other looping item.${
    clock
      ? ''
      : `

### Expiring a message

\`"expiresInMs": 180000\` removes the item outright once that many
milliseconds have passed - not just its turn ending, gone from the queue
entirely, whether or not it ever played. Nothing sets this by default: a
message left off it stands until dismissed (removed, or its own turn
ending if it does not loop). Give an automated interrupter one whenever
you are not certain something will clean it up later - an alert your own
process fired and might crash before clearing.

\`PATCH ${api}/queue/items/{id}\` with \`{"expiresInMs": 180000}\` re-bases
the countdown from now; \`{"expiresInMs": null}\` clears it back to "until
dismissed". Checked lazily, on the next \`GET ${api}/queue\` after it's
due - if the expired item was the one on the glass, the board moves on to
whatever's next.

### Saved interrupters - name it once, fire it by name

Posting \`{"priority": "now", "interrupt": true, ...}\` straight to
\`/message\` (above) fires an interrupter on the spot, but means resending
its text every single time. For one you expect to fire more than once,
save it instead:

\`\`\`bash
curl -X POST ${api}/interrupters \\
  -H 'authorization: Bearer ${KEY}' -H 'content-type: application/json' \\
  -d '{"name": "fire-evacuate", "text": "FIRE - EVACUATE NOW", "durationMs": 600000}'
\`\`\`

Then fire it, whenever, with nothing but its name:

\`\`\`bash
curl -X POST ${api}/interrupters/fire-evacuate/fire -H 'authorization: Bearer ${KEY}'
\`\`\`

\`durationMs\` is one or the other, never both: a number is a hard limit -
shown, then gone outright the instant it's up, whichever comes first
between that and its own turn ending. Omit it for the switch instead: it
blocks the rotation entirely, full stop, until dismissed (removed) or
broken by a higher-ranked interrupter firing - there is no unbounded
"forever" the engine can promise, so this materializes as the longest
dwell it supports (currently 24 hours) with no expiry, which is the same
thing in practice.

This is the one door from a saved interrupter to the glass - it posts
exactly the saved text with \`priority: "now"\`, \`interrupt: true\`, and
that preset's own Duration translated to \`dwellMs\`/\`expiresInMs\`, the
same as composing it by hand would. \`GET ${api}/interrupters\` lists
what's saved; \`POST ${api}/interrupters\` with a name that already exists
replaces it outright (editing is re-saving, not a separate PATCH);
\`DELETE ${api}/interrupters/{name}\` removes one. A board keeps at most 20.

Saving one is unrelated to firing it - saving never touches the glass, and
nothing here is ever queued until \`.../fire\` is called on it by name.

An interrupter fired with no \`durationMs\` blocks the rotation until
something ends it - that something is \`POST ${api}/interrupters/{name}/dismiss\`:

\`\`\`bash
curl -X POST ${api}/interrupters/fire-evacuate/dismiss -H 'authorization: Bearer ${KEY}'
\`\`\`

It removes every queued instance of that name, not just whichever one is
on the glass - firing the same preset again while it is already live
queues a second copy behind the first rather than replacing it, so
dismissing only the head would just promote an identical clone into its
place. No \`404\` for "nothing to dismiss" - a name with no live instance
is a no-op, not an error, so it is always safe to call. A timed
interrupter (one with \`durationMs\`) needs none of this - it clears
itself.

Saved order is the only ranking a saved interrupter has - there is no
rank field. \`POST ${api}/interrupters/reorder\` with \`{"names": [...]}\`
(every saved name, once) sets it, and it *is* enforced: firing one is
refused with a \`409\` if what's currently showing is itself a saved
interrupter ranked ahead of it (earlier in the saved order) - move the
one you're firing above it first, or wait for its own turn to end. Two
saved interrupters can never break each other out of order; a raw
\`{"interrupt": true, "priority": "now"}\` straight to \`/message\`, bypassing
the saved system entirely, still pre-empts unconditionally as it always
has - this rule only applies between two *named* interrupters.`
  }

### Looping

\`loop: true\` (alias: \`repeat\`) sends a played message to the back of the
queue instead of removing it, so a few looping messages rotate indefinitely. A
looping item keeps its id, and — new since the queue moved server-side — you
can **switch a loop off**: \`PATCH ${api}/queue/items/{id}\` with
\`{"loop": false}\`, or remove the item.

**\`DELETE ${api}/queue\` will not stop a loop.** It drops what is *pending*,
and the playing message is not pending — it finishes and rejoins. Use
\`POST ${api}/clear\` to stop everything, or edit the item.

- When the queue drains, **the last page stays on the board**, across display
  reloads. No automatic blanking; \`clear\` is the deliberate blank
- Poll \`GET ${api}/status\` (its \`queue\` block is server truth even with
  no display), or subscribe to \`GET ${api}/events\` for a server-sent-events
  stream of board state
- The queue holds at most 500 items; a full queue answers \`429\`
${
    type?.queuePolicy?.onFull === 'roll'
      ? `- **This board's type caps the queue well below 500 and rolls instead of
  rejecting.** Past its cap, adding a \`normal\` or \`next\` message quietly
  rolls the oldest *waiting* message off to make room; a ticker, not a
  form. The item on the glass is never rolled. \`now\` is exempt from this
  cap entirely - it is rare and deliberate by nature, not the thing the
  cap exists to defend against, and a board sitting exactly at its cap
  (a one-message "sign", most often) must still be interruptible. Check
  this board's actual limit in \`GET ${api}/queue\`'s \`config.queueCap\`
  (absent means the type's own default).
`
      : ''
  }`
  }
### Editing the queue

| Call | Does |
| --- | --- |
| \`GET ${api}/queue\` | the list, what is ${clock ? 'active' : 'current'}, and the board config |
| \`POST ${api}/queue/items\` | add — same body as \`/message\` |
| \`PATCH ${api}/queue/items/{id}\` | edit \`text\`/\`rows\`${clock ? ', change \`schedule\`' : ', toggle \`loop\`, set/clear \`expiresInMs\`'} |
| \`DELETE ${api}/queue/items/{id}\` | remove${clock ? '' : '; removing the playing item skips it'} |
${clock ? '' : `| \`POST ${api}/queue/reorder\` | \`{itemId, afterId}\` — \`afterId: null\` is the front |`}

## 7. Endpoints

Base: \`${api}\`

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| \`GET\` | \`/\` | read | discovery: points here and at health |
| \`GET\` | \`/AGENTS.md\` | read | this document |
| \`GET\` | \`/health\` | read | liveness, whether a display is connected; \`realtime: "ok" \\| "unavailable"\` |
| \`GET\` | \`/capabilities\` | read | charset, grid, accepted values, limits |
| \`GET\` | \`/status\` | read | last reported state + \`stale\`/\`frozen\`/\`updatedAt\` |
| \`GET\` | \`/events\` | read | SSE stream of board state |
| \`POST\` | \`/message\` | key | queue \`text\` or \`rows\` (+\`loop\`) → \`202\` |
| \`GET\` | \`/queue\` | read | the queue: items, what is current, config, \`themeRev\` |
| \`POST\` | \`/queue/items\` | key | add — same body as \`/message\` |
| \`PATCH\` | \`/queue/items/{id}\` | key | edit text/rows, toggle \`loop\` |
| \`DELETE\` | \`/queue/items/{id}\` | key | remove; removing the playing item skips |
| \`POST\` | \`/queue/reorder\` | key | \`{itemId, afterId}\`; \`null\` = front |
| \`POST\` | \`/preview\` | read | lay out and return pages **without displaying** |
| \`POST\` | \`/clear\` | key | stop everything and blank the glass |
| \`GET\` | \`/export\` | key | every queued item in a re-postable shape |
| \`DELETE\` | \`/queue\` | key | drop pending, leave the current message playing |
| \`GET\` | \`/interrupters\` | read | saved interrupters: name, text, Duration |
| \`POST\` | \`/interrupters\` | key | save one — a name that exists already is replaced outright |
| \`DELETE\` | \`/interrupters/{name}\` | key | remove a saved interrupter |
| \`POST\` | \`/interrupters/{name}/fire\` | key | fire a saved one now — the only door from saved to the glass |
| \`POST\` | \`/interrupters/{name}/dismiss\` | key | end it — every queued instance of that name, not just the current one |
| \`POST\` | \`/interrupters/reorder\` | key | \`{names: [...]}\`, every saved name once — rail order, the only ranking one has |
| \`GET\` | \`/theme\` | read | the board's theme: preset, overrides, resolved pack, \`rev\` |
| \`PATCH\` | \`/config\` | key | grid, \`theme\`, \`themePack\`, motion, dwell (\`footerRows\` must stay 0) |
| \`GET\` / \`POST\` | \`/key\` | owner | read / rotate the API key - the owner's session only, never the key itself |

MCP is served deployment-wide at \`${base}/api/mcp\` (key = this board; see
section 1).

"read" is open on a public board and needs the key on a private one;
"owner" is the signed-in owner (the manage page, or a connector signed in
as them). Board management — rename, slug, privacy, deletion — happens on
the owner's manage page, not this API. Three further routes belong to the
display itself and are not for API clients: \`GET /commands/stream\`,
\`POST /state\`, and \`POST /queue/advance\` (the last two take a display
credential the board page holds).

### Status codes

| Code | Meaning | What to do |
| --- | --- | --- |
| \`202\` | validated and queued; body carries \`id\`, \`position\` (1-based place in the queue) and \`ahead\` (how many play first) | check \`/status\` if delivery matters |
| \`400\` | malformed JSON | fix the body |
| \`401\` | missing or wrong API key | ask the user for the board's key (in its manage page) |
| \`403\` | private board, no valid credential | ask the user for the key |
| \`404\` | unknown board — wrong, renamed, or deleted slug | ask the user for the board URL |
| \`413\` | body or text too large | send less; limits are in \`/capabilities\` |
| \`422\` | invalid value | the message says which field and why |
| \`429\` | queue full — the 500-item backstop, or this board's own (lower) cap with nothing left to roll off | flush, clear, remove an item, or wait |
| \`503\` | the realtime service is unavailable - the write you made is saved, displays catch up when it returns | retry reads later; do not retry writes, they succeeded |

## 8. Recommended workflow

1. \`GET ${api}/health\`. \`404\` → ask the user for the board URL.
   \`boardReady: false\` → tell the user no display is connected.
2. \`GET ${api}/capabilities\` to learn the real charset, grid and bands.
3. If the text contains punctuation, digits with symbols, or anything
   non-English, \`POST ${api}/preview\` first and read the \`diagnostics\`.
4. If something meaningful was dropped, tell the user before displaying it.
5. \`POST ${api}/message\` with the API key.
6. \`GET ${api}/status\` to confirm, if it matters.

Things not to do:

- Do not guess slugs or keys. Ask.
- Do not \`clear\` to make room for your own message unless asked — \`priority\`
  gets you in front of the queue without discarding anything.
- Do not reach for \`priority: "now"\` because your message feels important;
  \`next\` is the right default when something should not wait.
- Do not send a \`region\` — bands are paused and anything but \`main\` is a
  \`422\`; \`clear\` blanks the whole board.
- Do not set \`loop\` unless the user wants something to cycle; switch it off
  with \`PATCH /queue/items/{id}\` \`{"loop": false}\` or remove the item.
- Do not reshape the grid to fit your text without saying so.
- Do not send secrets, credentials, or personal data. It is a display on a
  wall; treat everything you send as public.
`;
}
