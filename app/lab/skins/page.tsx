import { AppBar } from '@/components/AppBar';
import { SkinLab } from '@/components/lab/SkinLab';

export const metadata = { title: 'Skin lab — Flapper' };

/**
 * The fidelity bench: the same message on a sprite board and a procedural
 * board, side by side, with the pack JSON editable live. "It looks right"
 * is the acceptance test for a renderer (CLAUDE.md), and this is where it
 * is judged. Also the seed of the theme builder.
 */
export default function SkinLabPage() {
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
