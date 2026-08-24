'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppBar } from '@/components/AppBar';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Button, LinkButton } from '@/components/ui/Button';
import { Chip, CopyButton, EmptyState } from '@/components/ui/bits';
import type { TypeMeta } from '@/components/board-types/type-meta';
import { UserMenu } from '@/components/UserMenu';
import { ConnectedApps, useConnections } from '@/components/ConnectedApps';
import { SiteFooter } from '@/components/SiteFooter';

type BoardRow = {
  id: string;
  slug: string;
  name: string;
  type: string;
  status: string;
  private: boolean;
  createdAt: number;
};

export function DashboardClient({
  userName,
  boards,
  loadError = false,
  types,
}: {
  userName: string;
  boards: BoardRow[];
  /** The server could not list boards; `boards` is empty by default, not by fact. */
  loadError?: boolean;
  types: TypeMeta[];
}) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();

  // Restored from the back/forward cache, this page is a photograph of the
  // account as it was; ask the server again rather than trust it.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) router.refresh();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [router]);

  // An empty list means different things to someone who has never had a
  // board and someone whose boards vanished under them (deleted elsewhere -
  // by an agent, say). Remember whether this page has ever shown boards.
  const [hadBoards, setHadBoards] = useState(false);
  useEffect(() => {
    if (boards.length > 0) setHadBoards(true);
  }, [boards.length]);
  // Resolved after mount: the server does not know the public origin.
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  const [error, setError] = useState('');

  // The OAuth clients this account has let in; managed on /account.
  const [connections] = useConnections();

  const typeName = (id: string) => types.find((type) => type.id === id)?.name ?? id;

  async function remove(board: BoardRow) {
    const ok = await confirm({
      title: `Delete ${board.name || board.slug}?`,
      body: 'Its URL, key, and queue are gone for good.',
      confirmLabel: 'Delete board',
      danger: true,
    });
    if (!ok) return;
    setError('');
    const response = await fetch(`/api/b/${board.slug}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error || `Delete failed: HTTP ${response.status}`);
      return;
    }
    router.refresh();
  }

  return (
    <div className="app-shell">
      {dialog}
      <AppBar right={<UserMenu userName={userName} current="dashboard" />} />
      <main className="dash">
        {/* The page's heading and its one primary action share a row. */}
        <header className="dash-head">
          <h1 className="dash-title">
            Boards{boards.length > 0 && <span className="dash-count">{boards.length}</span>}
          </h1>
          <LinkButton variant="primary" href="/new">
            New board
          </LinkButton>
        </header>
        {error !== '' && <p className="error">{error}</p>}

        {loadError ? (
          <EmptyState title="We couldn't load your boards.">
            Nothing has been changed — this page just could not reach them.{' '}
            <Button size="sm" onClick={() => router.refresh()}>
              Try again
            </Button>
          </EmptyState>
        ) : boards.length === 0 && hadBoards ? (
          <EmptyState title="Your boards were removed.">
            Every board on this account has been deleted since this page last loaded — by you
            in another tab, or by an agent connected to your account. Create a new one, or check
            the connected apps below.
          </EmptyState>
        ) : boards.length === 0 ? (
          <EmptyState title="No boards yet.">
            A board is a split-flap display with its own URL and its own API — put it on a wall,
            drive it from anywhere. Make one with New board above, or connect Claude below and ask
            it to.
          </EmptyState>
        ) : (
          <>
            <div className="board-grid">
              {boards.map((board) => (
                <article className="board-card" key={board.id}>
                  {/* A card is a name, a type, and three doors. Everything else
                      about a board lives in its settings. */}
                  <div className="board-card-open">
                    <span className="board-card-name">{board.name || board.slug}</span>
                    <span className="board-card-meta">
                      <Chip>{typeName(board.type)}</Chip>
                    </span>
                  </div>
                  <div className="board-card-actions">
                    <LinkButton size="sm" href={`/b/${board.slug}/settings`}>
                      Edit
                    </LinkButton>
                    <LinkButton size="sm" href={`/b/${board.slug}`} target="_blank" rel="noopener">
                      Open display
                    </LinkButton>
                    <Button size="sm" variant="ghost" onClick={() => remove(board)}>
                      Delete
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}

        {/* Below the boards: how to drive them. Three equal columns - the
            assistant (stateful: the URL to connect, or who is connected),
            the REST contract, and the docs. */}
        <header className="dash-head dash-head-secondary">
          <h2 className="dash-title">Connections</h2>
        </header>
        <section className="dash-more" aria-label="Ways to drive your boards">
          <article className="dash-col">
            <h2>Connect an assistant</h2>
            {connections && connections.length > 0 ? (
              <>
                <p className="ui-hint">Connected to your account - they can list, create, and drive every board.</p>
                <ConnectedApps connections={connections} compact />
                <LinkButton size="sm" href="/account">
                  Manage connections
                </LinkButton>
              </>
            ) : (
              <>
                <p className="ui-hint">
                  Add this URL as a connector in Claude or ChatGPT and sign in when it asks. It can
                  then list, create, and drive every board on your account - no keys to paste.
                </p>
                {origin !== '' && (
                  <>
                    <code className="curl">{origin}/api/mcp</code>
                    <CopyButton value={`${origin}/api/mcp`} label="Copy MCP URL" />
                  </>
                )}
              </>
            )}
          </article>
          <article className="dash-col">
            <h2>Drive it over REST</h2>
            <p className="ui-hint">
              Every board has its own HTTP API - post a message with one curl, read what the glass
              shows, edit the queue. Each board also serves its own agent guide with its URLs baked
              in.
            </p>
            <LinkButton size="sm" href="/docs/board-api">
              Board API reference
            </LinkButton>
          </article>
          <article className="dash-col">
            <h2>Learn more</h2>
            <p className="ui-hint">
              Board types and what a queue means, keys and privacy, keeping a wall display in the
              foreground, and the design system behind the glass.
            </p>
            <LinkButton size="sm" href="/docs">
              Documentation
            </LinkButton>
          </article>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
