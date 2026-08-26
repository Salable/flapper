'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppBar } from '@/components/AppBar';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Button, LinkButton } from '@/components/ui/Button';
import { Chip, CopyButton, EmptyState } from '@/components/ui/bits';
import { ThemePreview } from '@/components/flapper/ThemePreview';
import { DEFAULTS } from '@/lib/board/flipboard.js';
import { gridForConfig, screenLabel, screenOf } from '@/lib/board/geometry.mjs';
import type { ThemePack } from '@/lib/board/theme-pack.mjs';
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
  /** The board's resolved design, so a card can be drawn in it. */
  pack: ThemePack;
  /** Up to three of the words on it. Empty means blank glass, which is honest. */
  lines: string[];
  /** The queue's real count - `lines` is capped at three and drops blanks,
   * so it undercounts the moment a board holds more than that. */
  slideCount: number;
  /** What the board is designed for; its grid follows from these two. */
  screen: { w: number; h: number };
  cardSize: string;
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

  /**
   * A sign and a cycle are the same board type - `live`, with looping items
   * (lib/board-types/templates.mjs) - so there is no real "Static" vs. "Live
   * queue" distinction to name; both are just how many slides are in the
   * rotation, which is the fact worth saying instead.
   */
  const statusLabel = (board: BoardRow) =>
    board.type === 'live' ? `${board.slideCount} slide${board.slideCount === 1 ? '' : 's'}` : typeName(board.type);

  /**
   * Every card at the same height, not the same tile size. True-to-scale
   * made an 8x6 board render a quarter the height of a 20x11 one - visibly
   * broken rather than "a true thing about it and worth seeing". Width still
   * follows the board's own aspect (more columns is still visibly wider),
   * just never so short it goes illegible. 99 is 11 rows at the previous
   * fixed 9px, so a board at that common height is unchanged.
   */
  const previewTilePx = (rows: number) => Math.min(20, Math.max(6, Math.round(99 / Math.max(1, rows))));

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
        {/* The page's heading and the two things you come here to make. */}
        <header className="dash-head">
          <h1 className="dash-title">
            Boards{boards.length > 0 && <span className="dash-count">{boards.length}</span>}
          </h1>
          <div className="dash-head-actions">
            <LinkButton href="/designs">Designs</LinkButton>
            <LinkButton variant="primary" href="/new">
              New board
            </LinkButton>
          </div>
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
                  {/* The board itself, in its own design, showing what is on
                      it - so telling two boards apart is looking at them
                      rather than reading their names. A board with nothing
                      queued shows the blank glass it actually is.

                      Each at its own grid, unlike the posters on /new. There a
                      card is an example and three widths in a row read as a
                      mistake; here it is a board that exists, so a 24-column
                      board being wider than a 20-column one is a true thing
                      about it and worth seeing - previewTilePx keeps every
                      card the same height rather than the same tile size, so
                      that stays true without a short board going illegible. */}
                  <div className="board-card-board">
                    <ThemePreview
                      pack={board.pack}
                      text={board.lines.length > 0 ? board.lines : ['']}
                      cols={gridForConfig(board).cols}
                      rows={gridForConfig(board).rows}
                      tilePx={previewTilePx(gridForConfig(board).rows)}
                      screenAspect={screenOf(board).w / screenOf(board).h}
                      bar={false}
                      fixed
                      loop={board.lines.length > 1 ? 4200 : 0}
                    />
                  </div>
                  <div className="board-card-open">
                    <span className="board-card-name">{board.name || board.slug}</span>
                    <span className="board-card-meta">
                      <Chip>{statusLabel(board)}</Chip>{' '}
                      {/* The screen it is for - the card itself is already
                          drawn at the grid that comes to, so saying the
                          count again here was the same fact twice. */}
                      <Chip>{screenLabel(screenOf(board))}</Chip>
                    </span>
                  </div>
                  <div className="board-card-actions">
                    <LinkButton size="sm" href={`/b/${board.slug}/manage`}>
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
