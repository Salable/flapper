import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { sessionFromHeaders } from '@/lib/auth';
import { getDb } from '@/lib/db/client.mjs';
import { getBySlug } from '@/lib/db/boards.mjs';
import { secretsMatch } from '@/lib/broker/tokens.mjs';
import { BoardPageClient } from '@/components/BoardPageClient';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ key?: string }>;
};

export default async function BoardPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { key } = await searchParams;

  const db = await getDb();
  const board = await getBySlug(db, slug);
  if (!board) notFound();

  const session = await sessionFromHeaders(await headers());
  const isOwner = Boolean(session && session.user.id === board.ownerId);
  const keyValid = Boolean(key && (await secretsMatch(key, board.apiKey)));

  if (board.private && !isOwner && !keyValid) {
    return (
      <main className="landing">
        <h1>FLAPPER</h1>
        <p>This board is private.</p>
        <p className="muted">
          Open it with its key (<code>?key=…</code> on this URL — it lives in the board&apos;s
          settings), or sign in as its owner.
        </p>
        <div className="actions">
          <a className="button primary" href={`/login?next=${encodeURIComponent(`/b/${slug}`)}`}>
            Sign in
          </a>
        </div>
      </main>
    );
  }

  return (
    <BoardPageClient
      slug={slug}
      apiBase={`/api/b/${slug}`}
      // The key rides along only when access arrived through it; an owner's
      // session authenticates the display's own calls via cookies instead.
      boardKey={keyValid ? key! : null}
      isOwner={isOwner}
    />
  );
}
