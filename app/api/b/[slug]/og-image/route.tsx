import { ImageResponse } from 'next/og';
import { getDb } from '@/lib/db/client.mjs';
import { getBySlugWithCurrent } from '@/lib/db/boards.mjs';
import { ogCardData } from '@/lib/board/og-card.mjs';

export const dynamic = 'force-dynamic';

const WIDTH = 1200;
const HEIGHT = 630;
// Room for the wordmark strip below the grid, and margins around it.
const PAD = 48;
const FOOTER = 56;

/**
 * The share-card image for a board's own link - what Slack, LinkedIn and
 * anything else that reads Open Graph tags shows when the URL is pasted in.
 * Always what the board actually says, never a generic mock: this is one of
 * two callers of `ogCardData` (the other is `/b/[slug]`'s own metadata,
 * which points its `og:image` at this route).
 *
 * A private board gets the same fallback a board with nothing on it yet
 * gets - never its live text. Both crawlers and Slack's own unfurl bot
 * fetch this server-to-server with no session and no board key, so there
 * is no way to check "is this viewer allowed to see it" here at all - the
 * only safe answer is to never draw private text into a public image.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await getDb();
  const board = await getBySlugWithCurrent(db, slug);

  const { cols, rows, grid, pack } =
    board && !board.private
      ? ogCardData(board)
      : ogCardData({ name: 'FLAPPER', config: {}, currentPayload: null });

  const gap = Math.max(2, Math.round(Math.min((WIDTH - PAD * 2) / cols, (HEIGHT - PAD * 2 - FOOTER) / rows) * 0.12));
  const tile = Math.floor(
    Math.min((WIDTH - PAD * 2 - gap * (cols - 1)) / cols, (HEIGHT - PAD * 2 - FOOTER - gap * (rows - 1)) / rows),
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: WIDTH,
          height: HEIGHT,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: pack.background,
          fontFamily: '"IBM Plex Mono", monospace',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap }}>
          {grid.map((line, r) => (
            <div key={r} style={{ display: 'flex', gap }}>
              {[...line].map((char, c) => (
                <div
                  key={c}
                  style={{
                    width: tile,
                    height: tile,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: pack.card.fill,
                    borderRadius: Math.max(2, Math.round(tile * pack.card.radius)),
                    color: pack.glyph.fill,
                    fontSize: Math.round(tile * 0.62),
                    fontWeight: 700,
                  }}
                >
                  {char === ' ' ? '' : char}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 28,
            color: pack.glyph.fill,
            opacity: 0.5,
            fontSize: 22,
            letterSpacing: 4,
          }}
        >
          FLAPPER
        </div>
      </div>
    ),
    { width: WIDTH, height: HEIGHT },
  );
}
