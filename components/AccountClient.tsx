'use client';

import { useEffect, useState } from 'react';
import { AppBar } from '@/components/AppBar';
import { UserMenu } from '@/components/UserMenu';
import { ConnectedApps, useConnections } from '@/components/ConnectedApps';
import { EmptyState, CopyButton } from '@/components/ui/bits';

export function AccountClient({ user }: { user: { name: string; email: string; createdAt: number } }) {
  const [connections, setConnections] = useConnections();
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);

  return (
    <div className="app-shell">
      <AppBar right={<UserMenu userName={user.name || user.email} current="account" />} />
      <main className="dash settings">
        <header className="dash-head">
          <h1 className="dash-title">Account</h1>
        </header>

        <section className="settings-block">
          <h2>Profile</h2>
          <dl className="board-side-facts">
            <dt>Name</dt>
            <dd>{user.name || <span className="muted">—</span>}</dd>
            <dt>Email</dt>
            <dd>{user.email}</dd>
            <dt>Member since</dt>
            <dd>{new Date(user.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}</dd>
          </dl>
        </section>

        <section className="settings-block">
          <h2>Connected apps</h2>
          <p className="ui-hint">
            Assistants you have signed in to Flapper with. Each can list, create, and drive every board
            on your account; Disconnect ends that on its next request.
          </p>
          {connections === null ? (
            <p className="muted">Loading…</p>
          ) : connections.length === 0 ? (
            <EmptyState title="Nothing connected.">
              Add <code>{origin}/api/mcp</code> as a connector in Claude or ChatGPT and sign in when it
              asks.
              {origin !== '' && <CopyButton value={`${origin}/api/mcp`} label="Copy MCP URL" />}
            </EmptyState>
          ) : (
            <ConnectedApps connections={connections} onChange={setConnections} />
          )}
        </section>
      </main>
    </div>
  );
}
