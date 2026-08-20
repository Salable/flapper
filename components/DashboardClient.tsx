'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from '@/lib/auth-client';
import { AppBar } from '@/components/AppBar';
import { useConfirm } from '@/components/ui/ConfirmDialog';

type BoardRow = {
  id: string;
  slug: string;
  name: string;
  private: boolean;
  createdAt: number;
  connected: boolean;
  showing: string | null;
};

export function DashboardClient({
  userName,
  boards,
}: {
  userName: string;
  boards: BoardRow[];
}) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/boards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(name.trim() === '' ? {} : { name: name.trim() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      router.push(`/b/${body.slug}/settings`);
    } catch (err: any) {
      setError(`Could not create a board: ${err.message}`);
      setBusy(false);
    }
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
      <AppBar
        right={
          <>
            <span className="muted">{userName}</span>
            <button
              onClick={async () => {
                await signOut();
                router.push('/');
                router.refresh();
              }}
            >
              Sign out
            </button>
          </>
        }
      />

      <main className="dash">
        <div className="dash-create">
          <input
            type="text"
            placeholder="Board name (optional)"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') create();
            }}
          />
          <button className="primary" onClick={create} disabled={busy}>
            {busy ? 'Creating…' : 'New board'}
          </button>
        </div>
        {error !== '' && <p className="error">{error}</p>}

        {boards.length === 0 ? (
          <div className="dash-empty">
            <p>No boards yet.</p>
            <p className="muted">
              A board is a split-flap display with its own URL and its own API — put it on a wall,
              drive it from anywhere. Create one; it takes a second.
            </p>
          </div>
        ) : (
          <>
            <h2 className="dash-title">
              Boards <span className="muted">{boards.length}</span>
            </h2>
            <div className="board-grid">
              {boards.map((board) => (
                <article className="board-card" key={board.id}>
                  <a className="board-card-open" href={`/b/${board.slug}`}>
                    <span className="board-card-name">
                      <i className={`live-dot${board.connected ? ' is-live' : ''}`} title={board.connected ? 'A display is connected' : 'No display connected'} />
                      {board.name || board.slug}
                    </span>
                    <span className="board-card-slug muted">/b/{board.slug}</span>
                    <span className="board-card-meta muted">
                      {board.connected
                        ? board.showing
                          ? `showing ${board.showing}`
                          : 'connected · blank'
                        : 'no display connected'}
                    </span>
                    <span className="board-card-meta muted">
                      {/* ISO, not toLocaleDateString: the server's locale and
                          the visitor's can disagree, and hydration notices. */}
                      {board.private ? 'private' : 'public'} · created{' '}
                      {new Date(board.createdAt).toISOString().slice(0, 10)}
                    </span>
                  </a>
                  <div className="board-card-actions">
                    <a className="button" href={`/b/${board.slug}`}>
                      Open
                    </a>
                    <a className="button" href={`/b/${board.slug}/settings`}>
                      Settings
                    </a>
                    <button className="ghost" onClick={() => remove(board)}>
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
