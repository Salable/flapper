import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { sessionFromHeaders } from '@/lib/auth';
import { getDb } from '@/lib/db/client.mjs';
import { getDesign } from '@/lib/db/designs.mjs';
import { AppBar } from '@/components/AppBar';
import { UserMenu } from '@/components/UserMenu';
import { LinkButton } from '@/components/ui/Button';
import { SiteFooter } from '@/components/SiteFooter';
import { DesignEditor } from '@/components/DesignEditor';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const session = await sessionFromHeaders(await headers());
  if (!session) return { title: 'Design — Flapper' };
  const design = await getDesign(await getDb(), session.user.id, (await params).id);
  return { title: design ? `${design.name} — Flapper` : 'Design — Flapper' };
}

/**
 * One design, open for editing.
 *
 * Only ever your own: getDesign takes the owner as part of the lookup, so a
 * stranger's id is simply not found rather than found and then refused.
 */
export default async function DesignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await sessionFromHeaders(await headers());
  if (!session) redirect(`/login?next=/designs/${id}`);

  const design = await getDesign(await getDb(), session.user.id, id);
  if (!design) notFound();

  return (
    <div className="app-shell">
      <AppBar
        right={
          <>
            <LinkButton href="/designs">Designs</LinkButton>
            <UserMenu userName={session.user.name || session.user.email} current="dashboard" />
          </>
        }
      />
      <main className="dash settings">
        <h2 className="dash-title">{design.name}</h2>
        <DesignEditor
          design={{ id: design.id, name: design.name, pack: design.pack, basedOn: design.basedOn }}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
