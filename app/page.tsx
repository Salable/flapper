import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionFromHeaders } from '@/lib/auth';
import { Flapper } from '@/components/flapper/Flapper';
import { LinkButton } from '@/components/ui/Button';

export default async function LandingPage() {
  const session = await sessionFromHeaders(await headers());
  if (session) redirect('/dashboard');

  return (
    <main className="landing">
      <div className="landing-hero">
        <Flapper text="FLAPPER" tilePx={48} />
      </div>
      <p>
        A split-flap departure board for any screen. Create a board, open it on the display, and
        drive it from your control room, from Claude or ChatGPT, or over a REST API from anything
        that can speak HTTP.
      </p>
      <div className="actions">
        <LinkButton variant="primary" href="/signup">
          Create account
        </LinkButton>
        <LinkButton href="/login">Sign in</LinkButton>
        <LinkButton variant="ghost" href="/docs">
          Docs
        </LinkButton>
      </div>
      <p className="muted">
        Boards come in types — a rolling live queue, a clock-driven schedule, a synchronized
        multi-screen sign — each with its own URL, API key, and agent guide at{' '}
        <code>/AGENTS.md</code>. Connect an AI once and it can drive all of them.
      </p>
    </main>
  );
}
