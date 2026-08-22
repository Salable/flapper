import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { notFound } from 'next/navigation';
import { marked } from 'marked';
import { AppBar } from '@/components/AppBar';
import { LinkButton } from '@/components/ui/Button';
import { SiteFooter } from '@/components/SiteFooter';
import { LEGAL_DOCUMENTS, legalDocument } from '@/lib/legal/documents.mjs';

export const dynamic = 'force-dynamic';

export function generateStaticParams() {
  return LEGAL_DOCUMENTS.map((doc) => ({ doc: doc.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const entry = legalDocument(doc);
  return { title: entry ? `${entry.title} — Flapper` : 'Flapper' };
}

/**
 * A legal document, public, rendered from docs/legal/*.md. While its status
 * in lib/legal/documents.mjs is `placeholder` the page says so at the top -
 * a reader must never mistake the skeleton for the terms.
 */
export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const entry = legalDocument(doc);
  if (!entry) notFound();

  const markdown = await readFile(path.join(process.cwd(), 'docs', 'legal', entry.file), 'utf8');
  const html = await marked.parse(markdown);

  return (
    <div className="app-shell">
      <AppBar
        right={
          <>
            <LinkButton href="/legal">All legal</LinkButton>
            <LinkButton href="/">Home</LinkButton>
          </>
        }
      />
      <main className="dash docs">
        {entry.status === 'placeholder' && (
          <p className="legal-placeholder" role="status">
            <strong>Placeholder.</strong> This {entry.title.toLowerCase()} has not been written or reviewed yet.
            Text marked <code>[[PLACEHOLDER]]</code> is what is still to come.
          </p>
        )}
        {/* Our own repo markdown, not user content. */}
        <article className="doc-body" dangerouslySetInnerHTML={{ __html: html }} />
      </main>
      <SiteFooter />
    </div>
  );
}
