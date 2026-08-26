import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { LinkButton } from '@/components/ui/Button';
import { notFound, redirect } from 'next/navigation';
import { sessionFromHeaders } from '@/lib/auth';
import { getDb } from '@/lib/db/client.mjs';
import { getBySlug } from '@/lib/db/boards.mjs';
import { getBoardType } from '@/lib/board-types/index.mjs';
import { SettingsClient } from '@/components/SettingsClient';

export const dynamic = 'force-dynamic';

// Without this the tab just says "Flapper" - the same for every board, on
// every open settings tab, telling them apart only by which one you last
// clicked. The slug in the URL (auto-generated, never the point) is no
// help either; the board's own name is the one fact that actually
// distinguishes it.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const board = await getBySlug(await getDb(), (await params).slug);
  return { title: board ? `${board.name} — Flapper` : 'Flapper' };
}

export default async function ManagePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await getDb();
  const board = await getBySlug(db, slug);
  if (!board) notFound();

  const session = await sessionFromHeaders(await headers());
  if (!session) redirect(`/login?next=${encodeURIComponent(`/b/${slug}/manage`)}`);
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
      userName={session.user.name || session.user.email}
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
