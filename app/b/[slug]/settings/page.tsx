import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { sessionFromHeaders } from '@/lib/auth';
import { getDb } from '@/lib/db/client.mjs';
import { getBySlug, listByOwner } from '@/lib/db/boards.mjs';
import { listQueue } from '@/lib/db/queue.mjs';
import { boardsOfQueue } from '@/lib/db/queues.mjs';
import { getUserTier } from '@/lib/db/entitlements.mjs';
import { SettingsClient } from '@/components/SettingsClient';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await getDb();
  const board = await getBySlug(db, slug);
  if (!board) notFound();

  const session = await sessionFromHeaders(await headers());
  if (!session) redirect(`/login?next=${encodeURIComponent(`/b/${slug}/settings`)}`);
  if (session.user.id !== board.ownerId) {
    return (
      <main className="landing">
        <h1>FLAPPER</h1>
        <p>Only this board&apos;s owner can open its settings.</p>
        <div className="actions">
          <a className="button" href={`/b/${slug}`}>
            View the board
          </a>
          <a className="button" href="/dashboard">
            Your dashboard
          </a>
        </div>
      </main>
    );
  }

  const [snapshot, attachedRows, myBoards, tier] = await Promise.all([
    listQueue(db, board.id),
    boardsOfQueue(db, board.queueId),
    listByOwner(db, board.ownerId),
    getUserTier(db, board.ownerId),
  ]);
  if (!snapshot) notFound();
  const attachedIds = new Set(attachedRows.map((row: any) => row.id));

  return (
    <SettingsClient
      board={{
        id: board.id,
        slug: board.slug,
        name: board.name,
        private: board.private,
        apiKey: board.apiKey,
        config: (board.config ?? {}) as Record<string, unknown>,
        createdAt: board.createdAt.getTime(),
      }}
      queue={{
        mode: snapshot.mode as 'live' | 'timed',
        dormancyDisplay: snapshot.dormancyDisplay as 'card' | 'blank',
        tier: tier as 'standard' | 'plus',
        attached: attachedRows.map((row: any) => ({ slug: row.slug, name: row.name })),
        attachable: myBoards
          .filter((row: any) => !attachedIds.has(row.id))
          .map((row: any) => ({ slug: row.slug, name: row.name })),
      }}
    />
  );
}
