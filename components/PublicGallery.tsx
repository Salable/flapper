'use client';

/**
 * The homepage's "what people are making" section. Pulls real public boards
 * (lib/db/boards.mjs `listPublic`) - free boards carry no `board_private`
 * entitlement, so this is genuine content, never fabricated. Nothing renders
 * if there is nothing public yet: an empty gallery pretending otherwise would
 * be the fabrication this exists to avoid.
 *
 * Each card is the real board - its own theme pack, its own screen shape and
 * card size, drawn by the same ThemePreview engine the dashboard uses for a
 * signed-in account's boards (components/DashboardClient.tsx) - not a
 * generic strip standing in for it. `previewTilePx` matches that file: same
 * card height regardless of grid, so a short board never reads as bigger
 * than a wide one just because its tiles are drawn larger.
 */

import { ThemePreview } from '@/components/flapper/ThemePreview';
import { gridForConfig } from '@/lib/board/geometry.mjs';
import type { ThemePack } from '@/lib/board/theme-pack.mjs';

const AVATAR_EMOJI = ['🐦', '🦊', '🐢', '🐝', '🦋', '🐙', '🐨', '🦉', '🐳', '🦔', '🐧', '🦀'];

function avatarFor(ownerId: string): string {
  let hash = 0;
  for (let i = 0; i < ownerId.length; i += 1) hash = (hash * 31 + ownerId.charCodeAt(i)) >>> 0;
  return AVATAR_EMOJI[hash % AVATAR_EMOJI.length];
}

const previewTilePx = (rows: number) => Math.min(20, Math.max(6, Math.round(99 / Math.max(1, rows))));

export type PublicGalleryBoard = {
  id: string;
  slug: string;
  ownerId: string;
  ownerName: string;
  text: string;
  pack: ThemePack;
  screen: { w: number; h: number };
  cardSize: string;
};

export function PublicGallery({ boards }: { boards: PublicGalleryBoard[] }) {
  if (boards.length === 0) return null;

  return (
    <section className="gallery" aria-labelledby="gallery-heading">
      <h2 id="gallery-heading">What people are making</h2>
      <p className="muted">Every board here is public - open on someone's own display right now.</p>
      <ul className="gallery-grid">
        {boards.map((board) => {
          const grid = gridForConfig(board);
          return (
            <li key={board.id} className="gallery-card">
              <div className="gallery-card-board">
                <ThemePreview
                  pack={board.pack}
                  text={board.text}
                  cols={grid.cols}
                  rows={grid.rows}
                  tilePx={previewTilePx(grid.rows)}
                  screenAspect={board.screen.w / board.screen.h}
                  bar={false}
                  fixed
                />
              </div>
              <p className="gallery-card-by">
                <span aria-hidden="true">{avatarFor(board.ownerId)}</span> {board.ownerName}
              </p>
              <a href={`/b/${board.slug}`} target="_blank" rel="noopener" className="gallery-card-preview">
                Preview live →
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
