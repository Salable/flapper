/**
 * The line every UK company website has to carry - who we are, how to reach
 * us - and the way to every legal document. On the product pages, never on
 * the display: a wall screen is glass, not a website.
 */

import { LEGAL_DOCUMENTS, COMPANY_LINE } from '@/lib/legal/documents.mjs';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <span className="site-footer-company">{COMPANY_LINE}</span>
      <nav className="site-footer-links" aria-label="Legal">
        {LEGAL_DOCUMENTS.map((doc) => (
          <a key={doc.slug} href={`/legal/${doc.slug}`}>
            {doc.title}
          </a>
        ))}
      </nav>
    </footer>
  );
}
