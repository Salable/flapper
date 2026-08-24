'use client';

/**
 * The designs, as boards that actually work.
 *
 * These were CSS tiles at first, which was wrong: a MiniBoard is a
 * server-renderable stand-in that cannot flap, so it showed a design's colours
 * and none of its behaviour - and the hinge, the shading through a flip and the
 * motion feel are most of what a design is. Each card is the real engine on a
 * real canvas now, drawing from that design's own pack, and it flips on arrival
 * so you see the thing you are actually choosing.
 *
 * Editing still happens inside a board, because a design has nowhere of its own
 * to be saved to yet - see TODO.md, "designs on the account or on the board".
 */

import { useState } from 'react';
import { ThemePreview } from '@/components/flapper/ThemePreview';
import { LinkButton } from '@/components/ui/Button';
import { Chip } from '@/components/ui/bits';
import { THEMES, THEME_IDS, DEFAULT_THEME } from '@/lib/board/themes.mjs';
import { DEFAULTS } from '@/lib/board/flipboard.js';

const themes: Record<string, any> = THEMES;

/**
 * Two messages, not one. Flip again alternates between them, because sending
 * every tile the same distance every time shows none of what makes a
 * split-flap board worth watching - a tile only moves forward round the ring,
 * so O to P is one step and P back round to O is forty-one. Between these two,
 * some tiles barely twitch and others riffle the whole way round.
 */
const SAMPLE = ['NOW BOARDING\nGATE 12 .,!()', 'DELAYED 15 MIN\nPLATFORM 4 (B)'];

/**
 * The mock is the system's own geometry, not a shape chosen to suit a card.
 * DEFAULTS is what a new board actually gets, so a design seen here is a design
 * seen at the proportions it will be used at - and if that default ever
 * changes, this follows it rather than drifting away from it.
 */
const { cols: COLS, rows: ROWS } = DEFAULTS;

export function DesignGallery() {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="design-gallery">
      {THEME_IDS.map((id: string) => {
        const pack = themes[id];
        const showing = open === id;
        return (
          <article key={id} className="design-card">
            <div className="design-card-board">
              <ThemePreview pack={pack} text={SAMPLE} cols={COLS} rows={ROWS} tilePx={26} />
            </div>
            <div className="design-card-body">
              <h3 className="design-card-name">
                {pack.name}
                {id === DEFAULT_THEME && <Chip>default</Chip>}
                {pack.tint && <Chip tone="amber">wash</Chip>}
              </h3>
              <p className="muted">{pack.description}</p>
              <div className="design-card-actions">
                <LinkButton size="sm" variant="primary" href={`/new?theme=${id}`}>
                  Make a board in this
                </LinkButton>
                <button
                  type="button"
                  className="ui-btn ui-btn-default ui-btn-sm"
                  aria-expanded={showing}
                  onClick={() => setOpen(showing ? null : id)}
                >
                  {showing ? 'Hide the pack' : 'The pack'}
                </button>
              </div>
              {showing && (
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
