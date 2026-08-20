import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { notFound } from 'next/navigation';
import { marked } from 'marked';
import { AppBar } from '@/components/AppBar';
import { DOCS } from '../registry';

export const dynamic = 'force-dynamic';

export default async function DocPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const entry = DOCS.find((candidate) => candidate.slug === doc);
  if (!entry) notFound();

  const markdown = await readFile(path.join(process.cwd(), 'docs', entry.file), 'utf8');
  const html = await marked.parse(markdown);

  return (
    <div className="app-shell">
      <AppBar
        right={
          <>
            <a className="button" href="/docs">All docs</a>
            <a className="button" href="/dashboard">Dashboard</a>
          </>
        }
      />
      <main className="dash docs">
        {/* Our own repo markdown, not user content. */}
        <article className="doc-body" dangerouslySetInnerHTML={{ __html: html }} />
      </main>
    </div>
  );
}
