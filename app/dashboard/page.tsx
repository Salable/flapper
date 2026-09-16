import { headers } from 'next/headers';
import { screenOf, cardSizeOf } from '@/lib/board/geometry.mjs';
import { redirect } from 'next/navigation';
import { sessionFromHeaders } from '@/lib/auth';
import { getDb } from '@/lib/db/client.mjs';
import { listByOwner } from '@/lib/db/boards.mjs';
import { listQueue } from '@/lib/db/queue.mjs';
import { resolveBoardTheme } from '@/lib/board/board-theme.mjs';
import { BOARD_TYPES } from '@/lib/board-types/index.mjs';
import { accountAllowance, lockedTypeIds } from '@/lib/salable/licence.mjs';
import { DashboardClient } from '@/components/DashboardClient';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await sessionFromHeaders(await headers());
  if (!session) redirect('/login?next=/dashboard');

  const db = await getDb();
  // A failed load is its own state on the page ("we couldn't load your
  // boards", with a retry), never an empty list dressed as onboarding.
  let boards: any[] = [];
  let loadError = false;
  try {
    boards = await listByOwner(db, session.user.id);
  } catch (error) {
    console.error('dashboard: listing boards failed', error);
    loadError = true;
  }

  /*
   * Each card carries what its board looks like and what is on it, so the
   * dashboard shows the boards rather than a list of their names. The pack is
   * resolved here because resolveBoardTheme is pure and the config is already
   * in hand; the words come from the queue, which is one query per board -
   * acceptable for a page listing an account's own handful, and still no
   * question asked of the broker, whose business is the live display.
   */
  const rows = await Promise.all(
    boards.map(async (board: any) => {
      let lines: string[] = [];
      let slideCount = 0;
      try {
        const queue = await listQueue(db, board.id);
        const items = queue?.items ?? [];
        // Every item, not just the previewed three - "Static"/"Live queue"
        // used to stand in for this, but that was a guess from the same
        // capped, filtered `lines` the preview draws from (3 items, blanks
        // dropped), so it undercounted the moment a board held more than
        // that or kept a blank slide on purpose.
        slideCount = items.length;
        lines = items
          .map((item: any) => item.payload?.text)
          .filter((text: unknown): text is string => typeof text === 'string' && text.trim() !== '')
          .slice(0, 3);
      } catch (error) {
        // A card without its words is still a card. Never fail the page for it.
        console.error('dashboard: reading a queue failed', error);
      }
      const { pack } = resolveBoardTheme(board.config ?? {});
      return {
        id: board.id,
        slug: board.slug,
        name: board.name,
        type: board.type,
        status: board.status,
        private: board.private,
        createdAt: board.createdAt.getTime(),
        pack,
        lines,
        slideCount,
        // The two facts a board is shaped by. Not a grid: it does not have one
        // to send, and the card works it out the same way everything else does.
        screen: screenOf(board.config ?? {}),
        cardSize: cardSizeOf(board.config ?? {}),
      };
    }),
  );

  const locked = lockedTypeIds(await accountAllowance(session.user.id), BOARD_TYPES.values());
  const types = [...BOARD_TYPES.values()].map((type: any) => ({
    id: type.id,
    name: type.name,
    tagline: type.tagline,
    description: type.description,
    capabilities: type.capabilities,
    sample: type.sample,
    recommended: type.recommended,
    locked: locked.has(type.id),
    createParams: type.createParams,
  }));

  return (
    <DashboardClient
      userName={session.user.name || session.user.email}
      boards={rows}
      loadError={loadError}
      types={types}
    />
  );
}
