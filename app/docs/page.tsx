import { AppBar } from '@/components/AppBar';
import { DOCS } from './registry';
import { SiteFooter } from '@/components/SiteFooter';

export const metadata = { title: 'Docs — Flapper' };

export default function DocsIndex() {
  return (
    <div className="app-shell">
      <AppBar right={<a className="button" href="/dashboard">Dashboard</a>} />
      <main className="dash docs">
        <h2 className="dash-title">Documentation</h2>
        <div className="boards">
          {DOCS.map((doc) => (
            <a key={doc.slug} className="board-card-open doc-link" href={`/docs/${doc.slug}`}>
              <span className="board-card-name">{doc.title}</span>
              <span className="muted">{doc.blurb}</span>
            </a>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
