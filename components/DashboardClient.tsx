'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from '@/lib/auth-client';

type BoardRow = {
  id: string;
  slug: string;
  name: string;
  private: boolean;
  createdAt: number;
};

export function DashboardClient({ userName, boards }: { userName: string; boards: BoardRow[] }) {
  const router = useRouter();
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
    if (!confirm(`Delete "${board.name || board.slug}"? Its URL, key, and queue are gone for good.`)) {
      return;
    }
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
    <main className="landing dashboard">
      <div className="dash-head">
        <h1>FLAPPER</h1>
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
      </div>

      <div className="actions">
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
        <p className="muted">No boards yet. Create one — it takes a second.</p>
      ) : (
        <div className="boards">
          {boards.map((board) => (
            <div className="board-row" key={board.id}>
              <a className="board-open" href={`/b/${board.slug}`}>
                <span>{board.name || board.slug}</span>
                <span className="muted">
                  /b/{board.slug}
                  {board.private ? ' · private' : ''}
                </span>
              </a>
              <div className="board-actions">
                <a className="button" href={`/b/${board.slug}/settings`}>
                  Settings
                </a>
                <button onClick={() => remove(board)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
