import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionFromHeaders } from '@/lib/auth';
import { getDb } from '@/lib/db/client.mjs';
import { listByOwner } from '@/lib/db/boards.mjs';
import { getBroker } from '@/lib/broker/index.mjs';
import { getUserTier } from '@/lib/db/entitlements.mjs';
import { DashboardClient } from '@/components/DashboardClient';

export const dynamic = 'force-dynamic';

const STALE_MS = 10_000;

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
      const connected = Boolean(state && Date.now() - state.updatedAt <= STALE_MS);
      const line =
        state?.snapshot?.lines?.find((entry: string) => entry.trim() !== '')?.trim() ?? null;
      return {
        id: board.id,
        slug: board.slug,
        name: board.name,
        private: board.private,
        createdAt: board.createdAt.getTime(),
        connected,
        showing: connected ? line : null,
      };
    }),
  );

  const tier = (await getUserTier(db, session.user.id)) as 'standard' | 'plus';
  return (
    <DashboardClient userName={session.user.name || session.user.email} tier={tier} boards={rows} />
  );
}
