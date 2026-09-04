import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionFromHeaders } from '@/lib/auth';
import { getDb } from '@/lib/db/client.mjs';
import { listPublic } from '@/lib/db/boards.mjs';
import { resolveBoardTheme } from '@/lib/board/board-theme.mjs';
import { screenOf, cardSizeOf } from '@/lib/board/geometry.mjs';
import { Flapper } from '@/components/flapper/Flapper';
import { SiteFooter } from '@/components/SiteFooter';
import { LinkButton } from '@/components/ui/Button';
import { PublicGallery, type PublicGalleryBoard } from '@/components/PublicGallery';

export const dynamic = 'force-dynamic';

export default async function LandingPage() {
  const session = await sessionFromHeaders(await headers());
  if (session) redirect('/dashboard');

  // A gallery that fails to load is not a reason to fail the homepage - it
  // just doesn't show, same as having nothing public yet. Each board is
  // resolved to its real pack/screen/card size here, the same way the
  // dashboard resolves its own boards - so a gallery card is that board's
  // actual shape and skin, not a generic stand-in for it.
  let publicBoards: PublicGalleryBoard[] = [];
  try {
    const db = await getDb();
    const rows = await listPublic(db, { limit: 12 });
    publicBoards = rows.map((board: any) => {
      const live = board.currentPayload?.text || board.currentPayload?.rows?.join(' ') || '';
      const { pack } = resolveBoardTheme(board.config ?? {});
      return {
        id: board.id,
        slug: board.slug,
        ownerName: board.ownerName,
        ownerId: board.ownerId,
        text: live.trim() || board.name?.trim() || board.slug,
        pack,
        screen: screenOf(board.config ?? {}),
        cardSize: cardSizeOf(board.config ?? {}),
      };
    });
  } catch (error) {
    console.error('landing: loading public boards failed', error);
  }

  return (
    <div className="app-shell">
      <main className="landing landing-long">
      <div className="landing-hero">
        <Flapper text="FLAPPER" tilePx={48} />
      </div>
      <p>
        A split-flap departure board for any screen. Create a board, open it on the display, and
        drive it from your control room, from Claude or ChatGPT, or over a REST API from anything
        that can speak HTTP.
      </p>
      <div className="actions">
        <LinkButton variant="primary" href="/signup">
          Create account
        </LinkButton>
        <LinkButton href="/login">Sign in</LinkButton>
        <LinkButton variant="ghost" href="/docs">
          Docs
        </LinkButton>
      </div>
      <p className="muted">
        Boards come in types — a rolling live queue, a clock-driven schedule, a synchronized
        multi-screen sign — each with its own URL, API key, and agent guide at{' '}
        <code>/AGENTS.md</code>. Connect an AI once and it can drive all of them.
      </p>
      <PublicGallery boards={publicBoards} />
      </main>
      <SiteFooter />
    </div>
  );
}
