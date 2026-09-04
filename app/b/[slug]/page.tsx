import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { sessionFromHeaders } from '@/lib/auth';
import { getDb } from '@/lib/db/client.mjs';
import { getBySlug } from '@/lib/db/boards.mjs';
import { secretsMatch } from '@/lib/broker/tokens.mjs';
import { mintDisplayToken } from '@/lib/api/display-token.mjs';
import { BoardPageClient } from '@/components/BoardPageClient';
import { LinkButton } from '@/components/ui/Button';
import { resolveBoardTheme, themeRevOf } from '@/lib/board/board-theme.mjs';
import { accountAllowance } from '@/lib/salable/licence.mjs';

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
          <LinkButton variant="primary" href={`/login?next=${encodeURIComponent(`/b/${slug}`)}`}>
            Sign in
          </LinkButton>
        </div>
      </main>
    );
  }

  // The display credential: scopes this page to its two write-backs (advance,
  // state) without handing it the API key. Key rotation revokes it.
  const displayToken = await mintDisplayToken(board);
  // Resolved here so the first paint is already the board's own look, and a
  // stored override that no longer validates falls back on the server with
  // a log line rather than on the wall.
  const theme = resolveBoardTheme(board.config);
  if (theme.warnings.length) {
    console.warn(`flapper: board ${slug} theme overrides ignored - ${theme.warnings.join('; ')}`);
  }
  const initialTheme = { rev: await themeRevOf(board.config), pack: theme.pack };
  // The watermark is the owner's licence, not the viewer's - a stranger
  // watching someone's public board sees whether *that account* paid to
  // drop it, same as they'd see any other fact about the board.
  const { watermark } = await accountAllowance(board.ownerId);

  return (
    <BoardPageClient
      slug={slug}
      apiBase={`/api/b/${slug}`}
      boardKey={keyValid ? key! : null}
      displayToken={displayToken}
      initialTheme={initialTheme}
      watermark={watermark}
    />
  );
}
