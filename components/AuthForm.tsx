'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn, signUp } from '@/lib/auth-client';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/dashboard';
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
            Already have an account? <a href={`/login?next=${encodeURIComponent(next)}`}>Sign in</a>
          </>
        ) : (
          <>
            No account yet? <a href={`/signup?next=${encodeURIComponent(next)}`}>Create one</a>
          </>
        )}
      </p>
    </form>
  );
}
