import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionFromHeaders } from '@/lib/auth';
import { getDb } from '@/lib/db/client.mjs';
import { listByOwner } from '@/lib/db/boards.mjs';
import { DashboardClient } from '@/components/DashboardClient';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await sessionFromHeaders(await headers());
  if (!session) redirect('/login?next=/dashboard');

  const db = await getDb();
  const boards = await listByOwner(db, session.user.id);

  return (
    <DashboardClient
      userName={session.user.name || session.user.email}
      boards={boards.map((board: any) => ({
        id: board.id,
        slug: board.slug,
        name: board.name,
        private: board.private,
        createdAt: board.createdAt.getTime(),
      }))}
    />
  );
}
