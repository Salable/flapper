'use client';

/**
 * The panel's Access section: where this board lives and where its controls
 * are. The API key itself lives on the settings page, behind the owner's
 * login - this panel is visible to anyone who can see the board.
 */

export function AccessPanel({ slug, isOwner }: { slug: string; isOwner: boolean }) {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const apiBase = `${origin}/api/b/${slug}`;

  return (
    <div className="row access">
      <div className="field grow">
        <label>
          API <span className="muted">{apiBase}</span>
        </label>
        <span className="muted">
          Drive this board over REST with its API key. Agents can read {apiBase}/AGENTS.md.
          {isOwner
            ? ' Your key, privacy, and renaming live in Settings.'
            : ' The key lives on the settings page, which only the board’s owner can open.'}
        </span>
      </div>
      {isOwner && (
        <div className="stack">
          <a className="button" href={`/b/${slug}/settings`}>
            Settings
          </a>
        </div>
      )}
    </div>
  );
}
