import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionFromHeaders } from '@/lib/auth';
import { getDb } from '@/lib/db/client.mjs';
import { listByOwner } from '@/lib/db/boards.mjs';
import { BOARD_TYPES } from '@/lib/board-types/index.mjs';
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

  // A card is a name, a type and three doors; the live state of a display is
  // the settings page's business, so the dashboard asks the broker nothing.
  const rows = boards.map((board: any) => ({
    id: board.id,
    slug: board.slug,
    name: board.name,
    type: board.type,
    status: board.status,
    private: board.private,
    createdAt: board.createdAt.getTime(),
  }));

  const types = [...BOARD_TYPES.values()].map((type: any) => ({
    id: type.id,
    name: type.name,
    tagline: type.tagline,
    description: type.description,
    capabilities: type.capabilities,
    sample: type.sample,
    recommended: type.recommended,
    tier: type.tier,
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
