'use client';

/**
 * The designs, as boards.
 *
 * Each card is real tiles wearing that design's own pack - faces, ink, and the
 * wash if it has one - so the gallery is the honest answer to "what would my
 * board look like in this". It is also the standing check that nothing about a
 * design is hard-coded: if a card here ever comes out looking like Classic,
 * something is keyed on a theme id again.
 *
 * Read-only for now. Editing a design still happens inside a board, because a
 * design has nowhere of its own to be saved to yet - see TODO.md, "designs on
 * the account or on the board".
 */

import { useState } from 'react';
import { MiniBoard } from '@/components/ui/MiniBoard';
import { LinkButton } from '@/components/ui/Button';
import { Chip } from '@/components/ui/bits';
import { THEMES, THEME_IDS, DEFAULT_THEME } from '@/lib/board/themes.mjs';

const themes: Record<string, any> = THEMES;

/** Two lines, so a card shows letters, digits and the punctuation with its own card. */
const SAMPLE = ['NOW BOARDING', 'GATE 12 .,!'];

export function DesignGallery() {
  const [chosen, setChosen] = useState<string | null>(null);
  const longest = Math.max(...SAMPLE.map((line) => line.length));

  return (
    <div className="design-gallery">
      {THEME_IDS.map((id: string) => {
        const pack = themes[id];
        const open = chosen === id;
        return (
          <article key={id} className={`design-card${open ? ' is-open' : ''}`}>
            <div className="design-card-board">
              {SAMPLE.map((line, row) => (
                <MiniBoard key={row} text={line} fit={22} pack={pack} cols={longest} row={row} />
              ))}
            </div>
            <div className="design-card-body">
              <h3 className="design-card-name">
                {pack.name}
                {id === DEFAULT_THEME && <Chip>default</Chip>}
                {pack.tint && <Chip tone="amber">wash</Chip>}
              </h3>
              <p className="muted">{pack.description}</p>
              <div className="design-card-actions">
                <button
                  type="button"
                  className="ui-btn ui-btn-default ui-btn-sm"
                  aria-expanded={open}
                  onClick={() => setChosen(open ? null : id)}
                >
                  {open ? 'Hide the pack' : 'The pack'}
                </button>
                <LinkButton size="sm" href={`/new?theme=${id}`}>
                  Make a board in this
                </LinkButton>
              </div>
              {open && (
                <pre className="design-card-pack">
                  <code>{JSON.stringify(strip(pack), null, 2)}</code>
                </pre>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

/** The pack without the parts that are the same for every design. */
function strip(pack: Record<string, unknown>) {
  const { id, name, description, fonts, states, art, ...rest } = pack;
  return rest;
}
