'use client';

/**
 * The OAuth clients this account has let in, with Disconnect. Lives on the
 * account page; the dashboard shows the same list compact (names only,
 * "manage" pointing here) so the near-term connect column stays stateful
 * without growing a second disconnect flow.
 */

import { useEffect, useState } from 'react';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/Button';

export type Connection = { clientId: string; name: string; uri: string | null; grantedAt: number | null };

export function useConnections() {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  useEffect(() => {
    fetch('/api/account/connections')
      .then((response) => (response.ok ? response.json() : { connections: [] }))
      .then((body) => setConnections(body.connections ?? []))
      .catch(() => setConnections([]));
  }, []);
  return [connections, setConnections] as const;
}

export function ConnectedApps({
  connections,
  onChange,
  compact = false,
}: {
  connections: Connection[];
  onChange?: (next: Connection[]) => void;
  /** Names only, no Disconnect - the dashboard's glance. */
  compact?: boolean;
}) {
  const { confirm, dialog } = useConfirm();
  const [error, setError] = useState('');

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
    onChange?.(connections.filter((entry) => entry.clientId !== connection.clientId));
  }

  return (
    <>
      {dialog}
      {error !== '' && <p className="error">{error}</p>}
      <ul className="dash-connections">
        {connections.map((connection) => (
          <li key={connection.clientId}>
            <span>
              <strong>{connection.name}</strong>
              {!compact && connection.uri && <span className="muted"> · {connection.uri}</span>}
              {connection.grantedAt && (
                <span className="muted"> · since {new Date(connection.grantedAt).toLocaleDateString()}</span>
              )}
            </span>
            {!compact && (
              <Button size="sm" variant="ghost" onClick={() => disconnectApp(connection)}>
                Disconnect
              </Button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
