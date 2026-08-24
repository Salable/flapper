import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionFromHeaders } from '@/lib/auth';
import { AppBar } from '@/components/AppBar';
import { UserMenu } from '@/components/UserMenu';
import { LinkButton } from '@/components/ui/Button';
import { SiteFooter } from '@/components/SiteFooter';
import { DesignGallery } from '@/components/DesignGallery';

export const metadata: Metadata = { title: 'Designs — Flapper' };

/**
 * Every design a board can wear, in one place.
 *
 * The designer used to live only inside one board's Display tab, which meant
 * there was no way to see what a design looked like without first owning a
 * board and switching that board to it. A design is a thing in its own right,
 * so it gets a page of its own.
 *
 * The cards are real boards - the engine on a canvas, drawing from each
 * design's own pack - so this page is also the check that nothing about a
 * design is hard-coded anywhere. If a design ever comes out looking like
 * Classic here, something is keyed on an id again.
 */
export default async function DesignsPage() {
  const session = await sessionFromHeaders(await headers());
  if (!session) redirect('/login?next=/designs');

  return (
    <div className="app-shell">
      <AppBar
        right={
          <>
            <LinkButton href="/dashboard">Dashboard</LinkButton>
            <UserMenu userName={session.user.name || session.user.email} current="dashboard" />
          </>
        }
      />
      <main className="dash">
        <h2 className="dash-title">Designs</h2>
        <p className="muted">
          What a board can be dressed in. Every card below is drawn from that design&rsquo;s own
          pack, so this is what your tiles will actually look like.
        </p>
        <DesignGallery />
      </main>
      <SiteFooter />
    </div>
  );
}
