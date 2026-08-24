'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Field, TextInput } from '@/components/ui/Field';
import { authClient, signIn, signUp } from '@/lib/auth-client';
import { TERMS_VERSION } from '@/lib/legal/documents.mjs';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
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
  // Two boxes, both unticked, both separate: agreeing to the terms is the
  // price of an account; marketing is a choice, named for what it is, and
  // never bundled with the first (PECR / UK GDPR consent).
  const [agreed, setAgreed] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    if (mode === 'signup' && !agreed) {
      setError('Please agree to the Terms of Service and Privacy Notice to create an account.');
      setBusy(false);
      return;
    }
    const result =
      mode === 'signup'
        ? await signUp.email({
            name: name || email.split('@')[0],
            email,
            password,
            // Recorded on the user with server-set timestamps (lib/auth.ts).
            termsVersion: TERMS_VERSION,
            marketingConsent: marketing,
          } as any)
        : await signIn.email({ email, password });
    if (result.error) {
      setError(result.error.message ?? 'Something went wrong.');
      setBusy(false);
      return;
    }
    // When an OAuth authorization is in flight, the provider's after-sign-in
    // hook answers with `{ redirect: true, url }` instead of a session, and
    // better-auth's redirect fetch plugin has already set window.location to
    // it. Pushing `next` on top would race that full-page navigation (and
    // flash the dashboard), so the form stays busy and lets the browser leave.
    const data = result.data as { redirect?: boolean; url?: string } | null;
    if (data?.redirect && data.url) {
      window.location.assign(data.url);
      return;
    }
    // A full navigation, not router.push: the client router cache may hold a
    // /dashboard payload from before this sign-in - another account's, or
    // boards since deleted - and push paints it first, refresh second. A
    // session change deserves a clean slate.
    window.location.assign(next);
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
        <Field label="Name" htmlFor="name">
          <TextInput id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </Field>
      )}
      <Field label="Email" htmlFor="email">
        <TextInput
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      </Field>
      <Field label="Password" htmlFor="password" hint={mode === 'signup' ? 'At least 8 characters.' : undefined}>
        <TextInput
          id="password"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        />
      </Field>
      {mode === 'signup' && (
        <>
          <label className="consent">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} required />
            <span>
              I agree to the{' '}
              <a href="/legal/terms" target="_blank" rel="noopener">
                Terms of Service
              </a>{' '}
              and{' '}
              <a href="/legal/privacy" target="_blank" rel="noopener">
                Privacy Notice
              </a>
              .
            </span>
          </label>
          <label className="consent">
            <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
            <span>Email me about new Flapper features and tips. Optional — you can unsubscribe any time.</span>
          </label>
        </>
      )}
      {error !== '' && <p className="error">{error}</p>}
      <Button variant="primary" className="ui-btn-block" disabled={busy}>
        {busy ? '…' : mode === 'signup' ? 'Create account' : 'Sign in'}
      </Button>
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
