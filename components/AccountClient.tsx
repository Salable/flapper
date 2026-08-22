'use client';

import { useEffect, useState } from 'react';
import { AppBar } from '@/components/AppBar';
import { UserMenu } from '@/components/UserMenu';
import { ConnectedApps, useConnections } from '@/components/ConnectedApps';
import { EmptyState, CopyButton } from '@/components/ui/bits';
import { Checkbox } from '@/components/ui/Field';
import { LinkButton } from '@/components/ui/Button';
import { authClient } from '@/lib/auth-client';
import { PRIVACY_CONTACT } from '@/lib/legal/documents.mjs';
import { SiteFooter } from '@/components/SiteFooter';

export function AccountClient({
  user,
}: {
  user: { name: string; email: string; createdAt: number; marketingConsent: boolean };
}) {
  const [connections, setConnections] = useConnections();
  const [marketing, setMarketing] = useState(user.marketingConsent);
  const [marketingNote, setMarketingNote] = useState('');

  // Withdrawing consent must be as easy as giving it: one box, saved at once,
  // and the timestamp moves server-side (lib/auth.ts databaseHooks).
  async function setMarketingConsent(next: boolean) {
    setMarketing(next);
    setMarketingNote('');
    const result = await authClient.updateUser({ marketingConsent: next } as any);
    if (result.error) {
      setMarketing(!next);
      setMarketingNote(result.error.message ?? 'Could not save that - try again.');
    } else {
      setMarketingNote(next ? 'Saved - we may email you about Flapper.' : 'Saved - no marketing email.');
    }
  }
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

        <section className="settings-block">
          <h2>Privacy &amp; data</h2>
          <Checkbox
            label="Email me about new Flapper features and tips"
            checked={marketing}
            onChange={(e) => setMarketingConsent(e.target.checked)}
          />
          {marketingNote !== '' && <span className="muted">{marketingNote}</span>}
          <p className="ui-hint">
            What we hold and why is in the <a href="/legal/privacy">Privacy Notice</a>. You can ask
            for a copy of your data or have your account deleted; until those are buttons here, email{' '}
            <code>{PRIVACY_CONTACT}</code>.
          </p>
          <div className="actions">
            <LinkButton size="sm" href={`mailto:${PRIVACY_CONTACT}?subject=Data%20export%20request`}>
              Download your data [[placeholder]]
            </LinkButton>
            <LinkButton size="sm" variant="danger" href={`mailto:${PRIVACY_CONTACT}?subject=Delete%20my%20account`}>
              Delete your account [[placeholder]]
            </LinkButton>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
