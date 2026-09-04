/**
 * The homepage's "what people are making" section. Pulls real public boards
 * (lib/db/boards.mjs `listPublic`) - free boards carry no `board_private`
 * entitlement, so this is genuine content, never fabricated. Nothing renders
 * if there is nothing public yet: an empty gallery pretending otherwise would
 * be the fabrication this exists to avoid.
 */

import { MiniBoard } from '@/components/ui/MiniBoard';

const MAX_LABEL = 14;

function labelFor(board: { name: string; slug: string }): string {
  const raw = board.name?.trim() || board.slug;
  return raw.length > MAX_LABEL ? `${raw.slice(0, MAX_LABEL - 1)}…` : raw;
}

export function PublicGallery({ boards }: { boards: Array<{ id: string; slug: string; name: string }> }) {
  if (boards.length === 0) return null;

  return (
    <section className="gallery" aria-labelledby="gallery-heading">
      <h2 id="gallery-heading">What people are making</h2>
      <p className="muted">Every board here is public - open on someone's own display right now.</p>
      <ul className="gallery-grid">
        {boards.map((board) => (
          <li key={board.id}>
            <a href={`/b/${board.slug}`} className="gallery-card">
              <MiniBoard text={labelFor(board)} size="sm" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
