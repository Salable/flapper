'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { authClient } from '@/lib/auth-client';

/**
 * The OAuth consent screen an MCP client's authorization lands on. The
 * provider redirects here with client_id + scope (and a signed oauth_query
 * covering the whole authorization request, which the auth client forwards
 * automatically); accept or deny answers with the redirect_uri to follow.
 */
export function ConsentForm() {
  const params = useSearchParams();
  const clientId = params.get('client_id') ?? '';
  const scopes = (params.get('scope') ?? '').split(' ').filter(Boolean);
  const [clientName, setClientName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!clientId) return;
    authClient
      .$fetch('/oauth2/public-client', { query: { client_id: clientId } })
      .then((result) => {
        const data = (result as { data?: { name?: string } | null }).data;
        setClientName(data?.name || '');
      })
      .catch(() => {
        /* the id itself still renders */
      });
  }, [clientId]);

  async function answer(accept: boolean) {
    setBusy(true);
    setError('');
    const result = (await authClient
      .$fetch('/oauth2/consent', { method: 'POST', body: { accept } })
      .catch((cause: unknown) => ({ error: cause, data: null }))) as {
      data?: { redirect_uri?: string } | null;
      error?: unknown;
    };
    if (result.data?.redirect_uri) {
      window.location.href = result.data.redirect_uri;
      return;
    }
    setError('This authorization is no longer valid - close this page and reconnect from the app.');
    setBusy(false);
  }

  if (!clientId) {
    return <p className="error">Missing authorization request - reconnect from the app you were using.</p>;
  }

  return (
    <div className="auth-form">
      <p>
        <strong>{clientName || clientId}</strong> wants to connect to your Flapper account
        {scopes.length > 0 ? <> with access to: {scopes.join(', ')}</> : null}.
      </p>
      <p className="muted">
        It will be able to see and drive your boards. Messages it sends appear on your displays.
      </p>
      {error !== '' && <p className="error">{error}</p>}
      <button className="primary wide" disabled={busy} onClick={() => answer(true)}>
        {busy ? '…' : 'Allow'}
      </button>
      <button className="wide" disabled={busy} onClick={() => answer(false)}>
        Deny
      </button>
    </div>
  );
}
