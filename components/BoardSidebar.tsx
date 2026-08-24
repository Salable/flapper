'use client';

import { Chip, CopyButton } from '@/components/ui/bits';
import { LinkButton } from '@/components/ui/Button';
import { formatDay } from '@/lib/format';

/**
 * The board itself, beside whatever screen is working on it: name, slug and
 * URL, type and status, when it was made, and the two things you always
 * want to hand (open the display, copy its URL). One shell for every
 * per-board screen, so a board's identity is never something you have to
 * go and find - on settings it was nowhere at all.
 */
export function BoardSidebar({
  name,
  slug,
  typeName,
  status,
  isPrivate,
  createdAt,
  boardUrl,
}: {
  name: string;
  slug: string;
  typeName: string;
  status: 'active' | 'deactivated';
  isPrivate: boolean;
  createdAt: number;
  /** Resolved client-side (the server does not know the public origin); '' until then. */
  boardUrl: string;
}) {
  return (
    <aside className="board-side" aria-label="This board">
      <h1 className="board-side-name">{name || slug}</h1>
      <div className="board-side-slug">
        <code>/b/{slug}</code>
        {boardUrl !== '' && <CopyButton value={boardUrl} label="Copy URL" />}
      </div>
      <div className="board-side-chips">
        <Chip>{typeName}</Chip>
        {status !== 'active' ? <Chip tone="danger">paused</Chip> : <Chip tone="live">active</Chip>}
        {isPrivate && <Chip>private</Chip>}
      </div>
      <dl className="board-side-facts">
        <dt>Created</dt>
        <dd>{formatDay(createdAt)}</dd>
      </dl>
      <div className="board-side-actions">
        {boardUrl !== '' && (
          <LinkButton size="sm" href={boardUrl} target="_blank" rel="noopener">
            Open display
          </LinkButton>
        )}
      </div>
    </aside>
  );
}
