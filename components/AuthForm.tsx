'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authClient, signIn, signUp } from '@/lib/auth-client';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/dashboard';
  // The login<->signup cross-links carry the whole query: an in-flight OAuth
  // authorization rides in it, and dropping it would strand a new user who
  // arrived from Claude and needs an account first.
  const carried = params.toString();
  const crossLink = (path: string) => (carried ? `${path}?${carried}` : `${path}?next=${encodeURIComponent(next)}`);
  // Arriving from an app's OAuth authorization: say so, by name. The
  // provider's pre-login lookup takes the signed oauth_query the auth client
  // forwards automatically, so it only answers for a real in-flight request.
  const oauthClientId = params.get('client_id');
  const [connecting, setConnecting] = useState<string | null>(null);
  useEffect(() => {
    if (!oauthClientId) return;
    authClient
      .$fetch('/oauth2/public-client-prelogin', { method: 'POST', body: { client_id: oauthClientId } })
      .then((result) => {
        const data = (result as { data?: { client_name?: string } | null }).data;
        setConnecting(data?.client_name || 'an app');
      })
      .catch(() => setConnecting('an app'));
  }, [oauthClientId]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const result =
      mode === 'signup'
        ? await signUp.email({ name: name || email.split('@')[0], email, password })
        : await signIn.email({ email, password });
    if (result.error) {
      setError(result.error.message ?? 'Something went wrong.');
      setBusy(false);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      {connecting && (
        <p className="auth-context">
          <strong>{connecting}</strong> wants to connect to your Flapper boards.{' '}
          {mode === 'signup' ? 'Create an account' : 'Sign in'} to continue.
        </p>
      )}
      {mode === 'signup' && (
        <div className="field">
          <label htmlFor="name">Name</label>
          <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </div>
      )}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        />
      </div>
      {error !== '' && <p className="error">{error}</p>}
      <button className="primary wide" disabled={busy}>
        {busy ? '…' : mode === 'signup' ? 'Create account' : 'Sign in'}
      </button>
      <p className="muted">
        {mode === 'signup' ? (
          <>
            Already have an account? <a href={crossLink('/login')}>Sign in</a>
          </>
        ) : (
          <>
            No account yet? <a href={crossLink('/signup')}>Create one</a>
          </>
        )}
      </p>
    </form>
  );
}
