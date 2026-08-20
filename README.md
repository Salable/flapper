# Flapper

A **split-flap board** for any screen — the kind on old airport departure
gates. It flips from whatever it's currently showing, scrolls forward through
the character set, and lands on the text you ask for, using real
per-transition frame art rather than a simulation of it.

![Flapper flipping through a sequence of messages: a wordmark, prose wrapping
across the grid, the board splitting into two independently-driven bands, a
paginated message, a departures frame placed cell by cell, and an urgent message
pre-empting the queue before the displaced one resumes](docs/flapper.gif)

*Everything above is driven over HTTP. The bottom strip is a second band running
its own queue on its own clock — note it changes out of step with the rows above
it. Near the end, `FIRE DRILL` jumps the queue and what it displaced comes back
where it left off.*

Flapper is a **multi-user web app for Vercel**: sign in, provision boards from
a dashboard, open a board's URL on whatever should display it — a browser tab,
a TV, the desktop kiosk shell — and drive it from the on-page panel or over a
REST API from anywhere.

- **Sign in** (email + password, [Better Auth](https://better-auth.com)) and
  manage boards from **/dashboard**: create, rename, delete
- **Boards live at `/b/{slug}`** — a slug you choose and can edit, a
  `/settings` screen for the owner, and an agent guide at
  `/api/b/{slug}/AGENTS.md` with the board's URLs baked in
- **One API key per board** — shown and regenerable in settings; every write
  needs it
- **Public or private** — public boards can be watched by anyone with the URL;
  private boards need the key (`?key=` works for wall displays) or the
  owner's login, even to read
- **Split the board into bands** — a rotating queue up top, a standing strip
  below, each with its own queue and clock
- **A thin desktop shell** (`desktop/`) for kiosk installs: fullscreen, keeps
  the display awake, remembers its board

| I want to… | Read |
| --- | --- |
| run it and put text on it | this file |
| build my own version | [AGENTS.md](AGENTS.md) |
| drive a board over HTTP | [docs/BOARD-API.md](docs/BOARD-API.md) |
| know why the engine is built this way | [SPEC.md](SPEC.md) |

## Run it locally

```bash
npm install && npm run dev
```

Open http://localhost:3000, create an account, and provision a board — with
**zero configuration**. Without env vars the app runs on an in-process PGlite
database (`./.pglite`, gitignored) and an in-memory realtime broker: perfect
for development, single-process only.

The generated tile art is committed, so there's no build step before your
first run. You only need `npm run build:assets` (Python 3 + Pillow) when you
change the art — see [Making it your own](AGENTS.md#making-it-your-own).

```bash
npm test             # ~190 tests, a few seconds, no browser needed
npm run db:generate  # after editing lib/db/schema.mjs: new SQL migration
```

## Deploy it

1. Push the repo to GitHub and import it into [Vercel](https://vercel.com/new).
2. From the Vercel Marketplace add:
   - **Neon** (Postgres) → injects `DATABASE_URL`
   - **Upstash Redis** → injects `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
3. Set `BETTER_AUTH_SECRET` (any long random string) and `BETTER_AUTH_URL`
   (the deployment's public URL).
4. Deploy. The build runs the drizzle migrations against Neon
   (`tools/migrate-if-db.mjs`) before `next build`.

| Env var | Purpose | Without it |
| --- | --- | --- |
| `DATABASE_URL` | Neon Postgres (users, boards) | local PGlite at `./.pglite` |
| `UPSTASH_REDIS_REST_URL/TOKEN` | realtime command/state channel | in-memory broker |
| `BETTER_AUTH_SECRET` | session signing | dev-only fallback, warns |
| `BETTER_AUTH_URL` | auth callbacks base URL | inferred per-request |

## Using a board

The board page is chrome-free — just the tiles. Press <kbd>C</kbd> for the
control panel: one card per band, a compose row, board/motion settings, and an
Access section pointing at the API and (for the owner) the settings page.

**Settings** (`/b/{slug}/settings`, owner-only) holds the rest: rename the
board or its slug, toggle privacy, reveal/copy/regenerate the API key, the
copy-pasteable curl, and the AGENTS.md link. For a private board it also
builds the `?key=` display URL a wall screen can open without logging in.

Keys: <kbd>C</kbd> controls · <kbd>Space</kbd> add saved lines ·
<kbd>Esc</kbd> clear every band · <kbd>F</kbd> fullscreen.

Driving it over HTTP:

```bash
curl -X POST https://YOUR-APP.vercel.app/api/b/YOUR-SLUG/message \
  -H 'authorization: Bearer YOUR_API_KEY' \
  -H 'content-type: application/json' \
  -d '{"text":"NOW BOARDING GATE 14"}'
```

`GET /api/b/{slug}/AGENTS.md` returns the full contract — endpoints, the
character set and its substitutions, bands, priorities, `rows` mode.
`GET /api/b/{slug}/status` returns `lines`, the literal rows on the glass,
which is the cheapest way to assert what a board is actually showing.

## The desktop shell

```bash
cd desktop && npm install && npm start
```

A kiosk window on the deployed web app: single instance, keeps the display
awake, remembers the last board it showed (including a private board's `?key=`
URL). `--url=` or `FLAPPER_URL` points it at a specific board; `--kiosk` locks
it to the wall. `npm run pack` builds a universal macOS .app.

## How it works

The engine is framework-free and unchanged since Flapper 1: one canvas, one
integer per tile, strips of per-transition frame art, and an animation loop
that stops completely when every tile has landed. Around it:

- `lib/board/` — the engine and its pure logic (layout, timing, regions,
  queues), all unit-tested under `node --test`
- `lib/db/` — drizzle schema and queries: users (Better Auth) and boards
  (slug, owner, privacy, API key, config). Neon in production, PGlite locally
- `lib/broker/` — the realtime channel: commands in a Redis stream per board,
  state snapshots posted back by the display. Upstash in production, in-memory
  locally
- `app/` — Next.js pages and the REST API as one-line route wrappers over
  testable handlers
- A display tab consumes its command stream over SSE and posts state back;
  `preview` and `capabilities` run the same layout code server-side, so they
  answer even when no display is connected

[AGENTS.md](AGENTS.md) is the guide to working on the code.

## License

[MIT](LICENSE). The tile art in `public/assets/` is generated from source GIFs
not included in the repo; the committed strips are part of the worked example.
