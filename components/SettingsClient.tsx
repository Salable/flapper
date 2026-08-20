'use client';

/**
 * The board's settings screen: identity (name/slug), privacy, and access (the
 * API key, the agent guide, copy-pasteable URLs). Owner-only - the server
 * component gates before this ever renders.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppBar } from '@/components/AppBar';

type Board = {
  id: string;
  slug: string;
  name: string;
  private: boolean;
  apiKey: string;
  createdAt: number;
};

export function SettingsClient({ board: initial }: { board: Board }) {
  const router = useRouter();
  const [board, setBoard] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [slug, setSlug] = useState(initial.slug);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  // Resolved after mount: the server does not know the public origin, and
  // rendering it there would make hydration disagree with the glass.
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  const boardUrl = `${origin}/b/${board.slug}`;
  const displayUrl = board.private ? `${boardUrl}?key=${board.apiKey}` : boardUrl;
  const apiBase = `${origin}/api/b/${board.slug}`;
  const curl = `curl -X POST ${apiBase}/message -H 'authorization: Bearer ${board.apiKey}' -H 'content-type: application/json' -d '{"text":"HELLO"}'`;

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(''), 1600);
    } catch {
      /* the text is selectable */
    }
  }

  async function patch(body: object, done?: (updated: any) => void) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/b/${board.slug}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setBoard((prev) => ({ ...prev, name: payload.name, slug: payload.slug, private: payload.private }));
      setName(payload.name);
      setSlug(payload.slug);
      done?.(payload);
      // The settings URL contains the slug, so a rename moves this page too.
      if (payload.slug !== board.slug) {
        router.replace(`/b/${payload.slug}/settings`);
      }
    } catch (err: any) {
      setError(err.message);
    }
    setBusy(false);
  }

  async function regenerate() {
    if (!confirm('Regenerate the API key? The current key stops working immediately - every script and display URL using it must be updated.')) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/b/${board.slug}/key`, { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setBoard((prev) => ({ ...prev, apiKey: payload.apiKey }));
      setShowKey(true);
      setNotice('New key minted. The old one no longer works.');
    } catch (err: any) {
      setError(err.message);
    }
    setBusy(false);
  }

  async function remove() {
    if (!confirm(`Delete "${board.name || board.slug}"? Its URL, key, and queue are gone for good.`)) {
      return;
    }
    const response = await fetch(`/api/b/${board.slug}`, { method: 'DELETE' });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.error || `Delete failed: HTTP ${response.status}`);
      return;
    }
    router.push('/dashboard');
  }

  const identityDirty = name !== board.name || slug !== board.slug;

  return (
    <div className="app-shell">
      <AppBar
        right={
          <>
            <span className="muted">/b/{board.slug} · settings</span>
            <a className="button" href={boardUrl}>
              Open board
            </a>
            <a className="button" href="/dashboard">
              Dashboard
            </a>
          </>
        }
      />
      <main className="dash settings">
        {error !== '' && <p className="error">{error}</p>}
        {notice !== '' && <p className="muted">{notice}</p>}

      <section className="settings-block">
        <h2>Identity</h2>
        <div className="field">
          <label htmlFor="board-name">Name</label>
          <input id="board-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="board-slug">Slug — the board&apos;s URL</label>
          <input
            id="board-slug"
            type="text"
            value={slug}
            spellCheck={false}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
          />
          <span className="muted">
            Renaming moves the board to /b/{slug || '…'} — old links and the API base stop working,
            and open displays must be reloaded.
          </span>
        </div>
        <button
          className="primary"
          disabled={busy || !identityDirty}
          onClick={() => patch({ name, slug })}
        >
          Save
        </button>
      </section>

      <section className="settings-block">
        <h2>Privacy</h2>
        <p className="muted">
          {board.private
            ? 'Private: viewing and API reads need the key (or your login).'
            : 'Public: anyone with the URL can watch. Writing always needs the key.'}
        </p>
        <button disabled={busy} onClick={() => patch({ private: !board.private })}>
          {board.private ? 'Make public' : 'Make private'}
        </button>
        {board.private && (
          <div className="field">
            <label>Display URL for wall screens</label>
            <code className="curl">{displayUrl}</code>
            <span className="muted">
              Carries the key in the URL so a kiosk can open it without logging in — anyone who sees
              this URL (logs, history, screenshots) can drive the board.
            </span>
            <button onClick={() => copy('display', displayUrl)}>
              {copied === 'display' ? 'Copied' : 'Copy display URL'}
            </button>
          </div>
        )}
      </section>

      <section className="settings-block">
        <h2>Access</h2>
        <div className="field">
          <label>API key</label>
          <code className="curl">{showKey ? board.apiKey : '•'.repeat(32)}</code>
          <div className="actions">
            <button onClick={() => setShowKey(!showKey)}>{showKey ? 'Hide' : 'Reveal'}</button>
            <button onClick={() => copy('key', board.apiKey)}>
              {copied === 'key' ? 'Copied' : 'Copy key'}
            </button>
            <button onClick={regenerate} disabled={busy}>
              Regenerate
            </button>
          </div>
        </div>
        <div className="field">
          <label>Send a message</label>
          <code className="curl">{curl}</code>
          <button onClick={() => copy('curl', curl)}>{copied === 'curl' ? 'Copied' : 'Copy curl'}</button>
        </div>
        <div className="field">
          <label>For agents</label>
          <span className="muted">
            Point an agent at <a href={`${apiBase}/AGENTS.md`}>{apiBase}/AGENTS.md</a> — the full
            contract for driving this board, with its URLs baked in.
          </span>
        </div>
      </section>

        <section className="settings-block danger">
          <h2>Danger</h2>
          <button onClick={remove} disabled={busy}>
            Delete this board
          </button>
        </section>
      </main>
    </div>
  );
}
