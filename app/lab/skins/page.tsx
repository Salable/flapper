import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionFromHeaders } from '@/lib/auth';
import { AppBar } from '@/components/AppBar';
import { SkinLab } from '@/components/lab/SkinLab';

export const metadata = { title: 'Skin lab — Flapper', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * The fidelity bench: the same message on a preset and on the pack being
 * edited, one above the other, with the pack JSON editable live. "It looks
 * right" is the acceptance test for a renderer (CLAUDE.md), and this is
 * where it is judged. Also the seed of the theme builder.
 *
 * Signed-in only: it evaluates whatever pack is pasted in, fetching the
 * art and fonts that pack names, and has no business being a public page.
 */
export default async function SkinLabPage() {
  const session = await sessionFromHeaders(await headers());
  if (!session) redirect('/login?next=/lab/skins');

  return (
    <div className="app-shell">
      <AppBar right={<a className="button" href="/dashboard">Dashboard</a>} />
      <main className="dash">
        <h2 className="dash-title">Skin lab</h2>
        <SkinLab />
      </main>
    </div>
  );
}
