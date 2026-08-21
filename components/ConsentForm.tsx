'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { authClient } from '@/lib/auth-client';

/** How long the "nothing was connected" note shows before the denial redirect follows. */
const DENY_REDIRECT_MS = 2500;

/**
 * The OAuth consent screen an MCP client's authorization lands on. The
 * provider redirects here with client_id + scope (and a signed oauth_query
 * covering the whole authorization request, which the auth client forwards
 * automatically); accept or deny answers with the redirect_uri to follow.
 */
export function ConsentForm() {
  const params = useSearchParams();
  const clientId = params.get('client_id') ?? '';
  const [clientName, setClientName] = useState('');
  const [clientUri, setClientUri] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Set once Deny has been answered: the client's redirect_uri carrying
  // error=access_denied. We say so here first, then follow it.
  const [deniedTo, setDeniedTo] = useState('');

  useEffect(() => {
    if (!clientId) return;
    authClient
      .$fetch('/oauth2/public-client', { query: { client_id: clientId } })
      .then((result) => {
        // OAuth metadata is snake_case on the wire: client_name, client_uri.
        const data = (result as { data?: { client_name?: string; client_uri?: string } | null }).data;
        setClientName(data?.client_name || '');
        setClientUri(data?.client_uri || '');
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
    const redirectUri = result.data?.redirect_uri;
    if (redirectUri) {
      if (accept) {
        window.location.href = redirectUri;
        return;
      }
      // A denial must still reach the app (OAuth's access_denied), or a
      // client waiting on a loopback listener never learns. But the app's
      // error page is an abrupt place to land with no word from us, so say
      // what happened here first and follow the redirect a moment later.
      setDeniedTo(redirectUri);
      window.setTimeout(() => window.location.assign(redirectUri), DENY_REDIRECT_MS);
      return;
    }
    setError('This authorization is no longer valid - close this page and reconnect from the app.');
    setBusy(false);
  }

  if (!clientId) {
    return <p className="error">Missing authorization request - reconnect from the app you were using.</p>;
  }

  if (deniedTo) {
    const app = clientName || 'the app';
    return (
      <div className="auth-form">
        <p>
          <strong>Nothing was connected.</strong> {app} was not given access to your Flapper account.
        </p>
        <p className="muted">
          Taking you back to {app} so it knows - or <a href={deniedTo}>go now</a>. You can reconnect
          from {app} any time.
        </p>
      </div>
    );
  }

  return (
    <div className="auth-form">
      <p>
        <strong>{clientName || clientId}</strong>
        {clientUri ? <span className="muted"> ({clientUri})</span> : null} wants to connect to
        your Flapper account.
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
