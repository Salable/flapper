'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from '@/lib/auth-client';
import { AppBar } from '@/components/AppBar';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Button, LinkButton } from '@/components/ui/Button';
import { Chip, CopyButton, EmptyState } from '@/components/ui/bits';
import { CreateBoardModal, type TypeMeta } from '@/components/CreateBoardModal';

type BoardRow = {
  id: string;
  slug: string;
  name: string;
  type: string;
  status: string;
  private: boolean;
  createdAt: number;
  connected: boolean;
  /** Connected, but its tab is hidden or its renderer has stopped drawing. */
  frozen: boolean;
  showing: string | null;
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
  const [creating, setCreating] = useState(false);

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

  // The OAuth clients this account has let in. Loaded client-side so the
  // dashboard's server render stays a plain board list.
  type Connection = { clientId: string; name: string; uri: string | null; grantedAt: number | null };
  const [connections, setConnections] = useState<Connection[] | null>(null);
  useEffect(() => {
    fetch('/api/account/connections')
      .then((response) => (response.ok ? response.json() : { connections: [] }))
      .then((body) => setConnections(body.connections ?? []))
      .catch(() => setConnections([]));
  }, []);

  const typeName = (id: string) => types.find((type) => type.id === id)?.name ?? id;

  async function disconnectApp(connection: Connection) {
    const ok = await confirm({
      title: `Disconnect ${connection.name}?`,
      body: 'It loses access to your boards immediately - anything it already holds stops working on its next request. It can reconnect by signing in again.',
      confirmLabel: 'Disconnect',
      danger: true,
    });
    if (!ok) return;
    setError('');
    const response = await fetch(`/api/account/connections/${encodeURIComponent(connection.clientId)}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error || `Disconnect failed: HTTP ${response.status}`);
      return;
    }
    setConnections((prev) => (prev ?? []).filter((entry) => entry.clientId !== connection.clientId));
  }

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
      <CreateBoardModal open={creating} types={types} onClose={() => setCreating(false)} />
      <AppBar
        right={
          <>
            <span className="muted">{userName}</span>
            <LinkButton href="/docs">Docs</LinkButton>
            <Button
              onClick={async () => {
                await signOut();
                // Full navigation: nothing of this account's dashboard may
                // linger in the router cache for the next person to sign in.
                window.location.assign('/');
              }}
            >
              Sign out
            </Button>
          </>
        }
      />

      <main className="dash">
        <div className="dash-create">
          <Button variant="primary" onClick={() => setCreating(true)}>
            New board
          </Button>
        </div>
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
            drive it from anywhere. Create one; it takes a second. Or connect Claude below and
            ask it to.
          </EmptyState>
        ) : (
          <>
            <h2 className="dash-title">
              Boards <span className="muted">{boards.length}</span>
            </h2>
            <div className="board-grid">
              {boards.map((board) => (
                <article className="board-card" key={board.id}>
                  {/* The card opens the control room; the display is explicit. */}
                  <a className="board-card-open" href={`/b/${board.slug}/settings`}>
                    <span className="board-card-name">
                      <i
                        className={`live-dot${board.frozen ? ' is-frozen' : board.connected ? ' is-live' : ''}`}
                        title={
                          board.frozen
                            ? 'A display is connected but its tab is in the background - it is not animating'
                            : board.connected
                              ? 'A display is connected'
                              : 'No display connected'
                        }
                      />
                      {board.name || board.slug}
                    </span>
                    <span className="board-card-slug muted">/b/{board.slug}</span>
                    <span className="board-card-meta">
                      <Chip>{typeName(board.type)}</Chip>
                      {board.private && <Chip>private</Chip>}
                      {board.status !== 'active' && <Chip tone="danger">paused</Chip>}
                    </span>
                    <span className="board-card-meta muted">
                      {board.frozen
                        ? 'frozen · display tab is in the background'
                        : board.connected
                          ? board.showing
                            ? `showing ${board.showing}`
                            : 'connected · blank'
                          : 'no display connected'}
                    </span>
                  </a>
                  <div className="board-card-actions">
                    <LinkButton size="sm" href={`/b/${board.slug}`}>
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

        <section className="settings-block dash-connect">
          <h2>Connect Claude or ChatGPT</h2>
          <p className="ui-hint">
            Add this URL as a connector in claude.ai, Claude Desktop, ChatGPT (developer mode), or
            Claude Code, and sign in when it asks. It can then list, create, and drive every board
            on your account — no keys to paste. A single board can also be connected with its own
            key, from that board’s settings.
          </p>
          {origin !== '' && (
            <>
              <code className="curl">{origin}/api/mcp</code>
              <CopyButton value={`${origin}/api/mcp`} label="Copy MCP URL" />
            </>
          )}
          {connections && connections.length > 0 && (
            <div className="dash-connections">
              <h3>Connected</h3>
              <ul>
                {connections.map((connection) => (
                  <li key={connection.clientId}>
                    <span>
                      <strong>{connection.name}</strong>
                      {connection.uri && <span className="muted"> · {connection.uri}</span>}
                      {connection.grantedAt && (
                        <span className="muted">
                          {' '}
                          · since {new Date(connection.grantedAt).toLocaleDateString()}
                        </span>
                      )}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => disconnectApp(connection)}>
                      Disconnect
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
