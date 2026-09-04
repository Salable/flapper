'use client';

import { useEffect, useState } from 'react';
import { AppBar } from '@/components/AppBar';
import { UserMenu } from '@/components/UserMenu';
import { AccountNav } from '@/components/AccountNav';
import { ConnectedApps, useConnections } from '@/components/ConnectedApps';
import { EmptyState, CopyButton } from '@/components/ui/bits';
import { Checkbox } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { authClient } from '@/lib/auth-client';
import { PRIVACY_CONTACT } from '@/lib/legal/documents.mjs';
import { SiteFooter } from '@/components/SiteFooter';
import { formatDay } from '@/lib/format';

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

        <div className="account-shell">
          <AccountNav current="profile" />
          <div className="account-panel">
            <section className="settings-block">
              <h2>Profile</h2>
              <dl className="account-facts">
                <dt>Name</dt>
                <dd>{user.name || <span className="muted">—</span>}</dd>
                <dt>Email</dt>
                <dd>{user.email}</dd>
                <dt>Member since</dt>
                <dd>{formatDay(user.createdAt)}</dd>
              </dl>
            </section>

            <section className="settings-block">
              <h2>Connected apps</h2>
              <p className="ui-hint">
                Assistants you have signed in to Flapper with. Each can list, create, and drive every
                board on your account; Disconnect ends that on its next request.
              </p>
              {connections === null ? (
                <p className="muted">Loading…</p>
              ) : connections.length === 0 ? (
                <EmptyState title="Nothing connected.">
                  Add <code>{origin}/api/mcp</code> as a connector in Claude or ChatGPT and sign in
                  when it asks.
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
                What we hold and why is in the <a href="/legal/privacy">Privacy Notice</a>. You can
                ask for a copy of your data or have your account deleted; until those are buttons
                here, email <code>{PRIVACY_CONTACT}</code>.
              </p>
              <div className="actions">
                <Button size="sm" disabled title="Not built yet - email us and we will do it by hand">
                  Download your data
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled
                  title="Not built yet - email us and we will do it by hand"
                >
                  Delete your account
                </Button>
              </div>
              <p className="ui-hint">
                Both are still to build. Until they are here, the email above does the same job.
              </p>
            </section>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
