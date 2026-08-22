import { headers } from 'next/headers';
import { LinkButton } from '@/components/ui/Button';
import { notFound, redirect } from 'next/navigation';
import { sessionFromHeaders } from '@/lib/auth';
import { getDb } from '@/lib/db/client.mjs';
import { getBySlug } from '@/lib/db/boards.mjs';
import { getBoardType } from '@/lib/board-types/index.mjs';
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
          <LinkButton href={`/b/${slug}`}>
            View the board
          </LinkButton>
          <LinkButton href="/dashboard">
            Your dashboard
          </LinkButton>
        </div>
      </main>
    );
  }

  return (
    <SettingsClient
      board={{
        id: board.id,
        slug: board.slug,
        name: board.name,
        type: board.type,
        typeName: getBoardType(board.type)?.name ?? board.type,
        status: board.status as 'active' | 'deactivated',
        private: board.private,
        apiKey: board.apiKey,
        config: (board.config ?? {}) as Record<string, unknown>,
        typeParams: (getBoardType(board.type)?.createParams ?? []) as any,
        createdAt: board.createdAt.getTime(),
      }}
    />
  );
}
