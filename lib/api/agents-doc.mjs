/**
 * The agent guide served at GET /api/b/{slug}/AGENTS.md, generated with the
 * asking board's live base URL and slug baked into every example so the whole
 * document is copy-pasteable against the board being asked.
 *
 * docs/BOARD-API.md in the repo is the human-readable companion; change the
 * contract and both must move together.
 */

export function boardDoc({ base, slug, isPrivate = false, version }) {
  const api = `${base}/api/b/${slug}`;
  const display = `${base}/b/${slug}`;
  const KEY = 'KEY'; // placeholder the reader replaces with the board's API key
  return `# Flapper — Agent Guide

Instructions for driving this Flapper split-flap board over its REST API.

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
do not, ask the user for it (it lives in the board's settings page).`
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

## 2. Access

Boards are owned by signed-in users, and every board has one **API key**,
visible to its owner on the board's settings page (\`${display}/settings\`).

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
\`dwellMs\`, \`collapseSpaces\`, \`substitutions\`.

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

**The queue lives on the server.** \`POST ${api}/message\` adds to it; the
display plays it strictly in order and reports each completion. You can stack
messages while no display is connected — they play when one opens. A \`202\`
means **validated and queued**; \`${api}/status\`'s \`boardReady\`/\`stale\`
say whether a display is showing it. \`POST ${api}/preview\` gives page
counts and \`estimatedMs\` up front if you need them before sending.

One board, one band, for now: **multi-band boards (footers) return in a
future release** — any \`region\` other than \`main\`, and any
\`footerRows > 0\`, is a \`422\`.

### Jumping the queue

| \`priority\` | Where it lands |
| --- | --- |
| \`normal\` *(default)* | the back of the queue |
| \`next\` | the head of the queue — plays when the current message finishes |
| \`now\` | displayed immediately, pre-empting whatever is playing |

**Nothing is discarded by a jump.** A \`now\` message pre-empts the current
one, but the displaced message returns to the head of the queue and resumes on
the page it was showing. Use the lightest thing that works: \`next\` is almost
always enough; save \`now\` for things that are actually urgent.

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

### Time-based queues (Plus)

A queue can be switched to **time-based** in the board's settings: loop
messages compile into a repeating cycle driven by the clock (several boards
can share one such queue and stay in step). What changes for you as an API
client: a one-off \`message\` plays **once at the next slot boundary**
(\`priority: now\` starts immediately) and then disappears; loop messages
join the cycle; \`/queue\` reports \`mode\`, slot durations, and the cycle
timing; and there is nothing to advance - completions are derived from time.
Everything else - validation, the charset, editing - is identical.

### Editing the queue

| Call | Does |
| --- | --- |
| \`GET ${api}/queue\` | the list, what is current, and the board config |
| \`POST ${api}/queue/items\` | add — same body as \`/message\` |
| \`PATCH ${api}/queue/items/{id}\` | edit \`text\`/\`rows\`, toggle \`loop\` |
| \`DELETE ${api}/queue/items/{id}\` | remove; removing the playing item skips it |
| \`POST ${api}/queue/reorder\` | \`{itemId, afterId}\` — \`afterId: null\` is the front |

## 7. Endpoints

Base: \`${api}\`

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| \`GET\` | \`/\` | read | discovery: points here and at health |
| \`GET\` | \`/AGENTS.md\` | read | this document |
| \`GET\` | \`/health\` | read | liveness, whether a display is connected |
| \`GET\` | \`/capabilities\` | read | charset, grid, accepted values, limits |
| \`GET\` | \`/status\` | read | last reported state + \`stale\`/\`updatedAt\` |
| \`GET\` | \`/events\` | read | SSE stream of board state |
| \`POST\` | \`/message\` | key | queue \`text\` or \`rows\` (+\`loop\`) → \`202\` |
| \`GET\` | \`/queue\` | read | the queue: items, what is current, config |
| \`POST\` | \`/queue/items\` | key | add — same body as \`/message\` |
| \`PATCH\` | \`/queue/items/{id}\` | key | edit text/rows, toggle \`loop\` |
| \`DELETE\` | \`/queue/items/{id}\` | key | remove; removing the playing item skips |
| \`POST\` | \`/queue/reorder\` | key | \`{itemId, afterId}\`; \`null\` = front |
| \`POST\` | \`/preview\` | read | lay out and return pages **without displaying** |
| \`POST\` | \`/clear\` | key | stop everything and blank the glass |
| \`DELETE\` | \`/queue\` | key | drop pending, leave the current message playing |
| \`PATCH\` | \`/config\` | key | grid, motion, dwell (\`footerRows\` must stay 0) |

"read" is open on a public board and needs the key on a private one. Board
management — rename, slug, privacy, key rotation, deletion — happens on the
owner's settings page, not this API. Three further routes belong to the
display itself and are not for API clients: \`GET /commands/stream\`,
\`POST /state\`, and \`POST /queue/advance\` (the last two take a display
credential the board page holds).

### Status codes

| Code | Meaning | What to do |
| --- | --- | --- |
| \`202\` | validated and queued to the board's stream | check \`/status\` if delivery matters |
| \`400\` | malformed JSON | fix the body |
| \`401\` | missing or wrong API key | ask the user for the board's key (in its settings) |
| \`403\` | private board, no valid credential | ask the user for the key |
| \`404\` | unknown board — wrong, renamed, or deleted slug | ask the user for the board URL |
| \`413\` | body or text too large | send less; limits are in \`/capabilities\` |
| \`422\` | invalid value | the message says which field and why |
| \`429\` | queue full (500 items) | flush, clear, or wait |

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
- Do not write to a band you were not asked to write to, and name the band you
  mean on \`clear\` — with no \`region\` it wipes every band.
- Do not set \`repeat\` unless the user wants something to cycle; only clearing
  the band stops it.
- Do not reshape the grid to fit your text without saying so.
- Do not send secrets, credentials, or personal data. It is a display on a
  wall; treat everything you send as public.
`;
}
