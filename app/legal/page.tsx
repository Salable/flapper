import { AppBar } from '@/components/AppBar';
import { SiteFooter } from '@/components/SiteFooter';
import { LEGAL_DOCUMENTS } from '@/lib/legal/documents.mjs';

export const metadata = { title: 'Legal — Flapper' };

export default function LegalIndex() {
  return (
    <div className="app-shell">
      <AppBar right={<a className="button" href="/">Home</a>} />
      <main className="dash docs">
        <h2 className="dash-title">Legal</h2>
        <div className="boards">
          {LEGAL_DOCUMENTS.map((doc) => (
            <a key={doc.slug} className="board-card-open doc-link" href={`/legal/${doc.slug}`}>
              <span className="board-card-name">
                {doc.title}
                {doc.status === 'placeholder' && <span className="legal-tag"> placeholder</span>}
              </span>
              <span className="muted">{doc.blurb}</span>
            </a>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
