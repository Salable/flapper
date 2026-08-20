import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionFromHeaders } from '@/lib/auth';

export default async function LandingPage() {
  const session = await sessionFromHeaders(await headers());
  if (session) redirect('/dashboard');

  return (
    <main className="landing">
      <h1>FLAPPER</h1>
      <p>
        A split-flap departure board for any screen. Create a board, open it on the display, and
        drive it from the panel — or over a REST API from anything that can speak HTTP.
      </p>
      <div className="actions">
        <a className="button primary" href="/signup">
          Create account
        </a>
        <a className="button" href="/login">
          Sign in
        </a>
      </div>
      <p className="muted">
        Every board gets its own URL, its own API key, and its own agent guide at{' '}
        <code>/AGENTS.md</code>. Boards can be public to watch or private to a key.
      </p>
    </main>
  );
}
