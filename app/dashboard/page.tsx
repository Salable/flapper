import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionFromHeaders } from '@/lib/auth';
import { getDb } from '@/lib/db/client.mjs';
import { listByOwner } from '@/lib/db/boards.mjs';
import { getBroker } from '@/lib/broker/index.mjs';
import { BOARD_TYPES } from '@/lib/board-types/index.mjs';
import { displayHealth } from '@/lib/api/liveness.mjs';
import { DashboardClient } from '@/components/DashboardClient';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await sessionFromHeaders(await headers());
  if (!session) redirect('/login?next=/dashboard');

  const db = await getDb();
  const broker = getBroker();
  const boards = await listByOwner(db, session.user.id);

  // The live signal per card: is a display connected, and what is on the glass.
  const rows = await Promise.all(
    boards.map(async (board: any) => {
      const state = await broker.getState(board.id);
      // The same rule /status applies, so the card and the API never disagree.
      const { boardReady: connected, frozen } = displayHealth(state);
      const line =
        state?.snapshot?.lines?.find((entry: string) => entry.trim() !== '')?.trim() ?? null;
      return {
        id: board.id,
        slug: board.slug,
        name: board.name,
        type: board.type,
        status: board.status,
        private: board.private,
        createdAt: board.createdAt.getTime(),
        connected,
        frozen,
        showing: connected ? line : null,
      };
    }),
  );

  const types = [...BOARD_TYPES.values()].map((type: any) => ({
    id: type.id,
    name: type.name,
    tagline: type.tagline,
    description: type.description,
    capabilities: type.capabilities,
    createParams: type.createParams,
  }));

  return (
    <DashboardClient
      userName={session.user.name || session.user.email}
      boards={rows}
      types={types}
    />
  );
}
