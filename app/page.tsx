import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionFromHeaders } from '@/lib/auth';
import { getDb } from '@/lib/db/client.mjs';
import { listPublic } from '@/lib/db/boards.mjs';
import { Flapper } from '@/components/flapper/Flapper';
import { SiteFooter } from '@/components/SiteFooter';
import { LinkButton } from '@/components/ui/Button';
import { PublicGallery } from '@/components/PublicGallery';

export const dynamic = 'force-dynamic';

export default async function LandingPage() {
  const session = await sessionFromHeaders(await headers());
  if (session) redirect('/dashboard');

  // A gallery that fails to load is not a reason to fail the homepage - it
  // just doesn't show, same as having nothing public yet.
  let publicBoards: Array<{ id: string; slug: string; name: string }> = [];
  try {
    const db = await getDb();
    publicBoards = await listPublic(db, { limit: 12 });
  } catch (error) {
    console.error('landing: loading public boards failed', error);
  }

  return (
    <div className="app-shell">
      <main className="landing landing-long">
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
      <PublicGallery boards={publicBoards} />
      </main>
      <SiteFooter />
    </div>
  );
}
