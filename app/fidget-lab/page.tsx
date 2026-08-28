'use client';

/**
 * The fidget lab: every style that ships, side by side, on real boards.
 *
 * Motion cannot be judged from a table of numbers, and a fidget is nothing
 * but motion - so this page exists to be *watched*, not read. Each board is
 * the same words and the same design; the only thing that differs is which
 * style it is doing. Whatever gets picked here is what the styles in the box
 * should be.
 *
 * Deliberately not linked from anywhere. It is a bench, not a screen.
 */

import { useState } from 'react';
import { ThemePreview } from '@/components/flapper/ThemePreview';
import { FIDGET_STYLES } from '@/lib/board/idle.mjs';
import { THEMES } from '@/lib/board/themes.mjs';

const TEXT = 'GATE 12 BOARDING';

/** What each style is trying to be, in a sentence you can check by looking. */
const NOTES: Record<string, string> = {
  classic: 'What every board does today. A card misfires anywhere in the set, then travels the long way home.',
  tick: 'One card moves one position and comes back. Just one - which on a mostly-blank board mostly means an A, exactly as a real board would.',
  rainbow: 'A tick that flies a full spectrum on the way over and back.',
  'pina-colada': 'Pineapple, coconut, a slice of lime. The same tick, drinking.',
  scatter: 'A character surfaces somewhere and goes again - the whole set, not a step.',
  twitchy: 'Three cards at once, most ticks, and a sweep now and then. For a busy space.',
  sweeping: 'Never a flicker - only the whole board turning over. For something being watched.',
  sherbet: "Colour only - five or six flips of pastel and no readable change. It never sits still long enough to show you a letter.",
  calm: 'Almost never, and it lingers when it does. For a quiet room.',
  snake: 'A different animal: a creature that walks the edge, once round, and puts the board back behind it - in a few flips per cell, so it no longer smears.',
  'pac-man': 'The same, with three ghosts behind him. ( is the mouth and ) a ghost - the ring has no sprites, and both sit near blank so a cell costs four flips, not thirty.',
};

export default function FidgetLab() {
  const [everyMs, setEveryMs] = useState(5000);
  const pack = (THEMES as any).classic.pack ?? (THEMES as any).classic;
  const ids = Object.keys(FIDGET_STYLES);

  return (
    <main style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <h1>Fidget lab</h1>
      <p className="ui-hint" style={{ maxWidth: 680 }}>
        The same board and the same words, once per style. The only difference
        is which fidget each one is doing. Watch them for a minute rather than
        reading the numbers — that is the whole point of the page. Note that a
        fidget lands on <b>any</b> card now, blank ones included, so watch the
        empty space as much as the words.
      </p>

      <label style={{ display: 'block', margin: '16px 0' }}>
        How often: <b>{(everyMs / 1000).toFixed(0)}s</b>{' '}
        <input
          type="range"
          min={5000}
          max={30000}
          step={1000}
          value={everyMs}
          onChange={(e) => setEveryMs(Number(e.target.value))}
          style={{ verticalAlign: 'middle', width: 240 }}
        />
        <span className="muted"> — the rate is separate from the style; that is the point.</span>
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 24 }}>
        {ids.map((id) => {
          const style: any = (FIDGET_STYLES as any)[id];
          return (
            <section key={id}>
              <h2 style={{ marginBottom: 4 }}>{id}</h2>
              <p className="muted" style={{ minHeight: 40, marginTop: 0 }}>{NOTES[id] ?? ''}</p>
              <ThemePreview
                pack={pack}
                text={TEXT}
                cols={16}
                rows={4}
                tilePx={40}
                bar={false}
                ambientMs={everyMs}
                fidget={id}
              />
              <p className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                sweepEvery {style.sweepEvery} · restOdds {style.restOdds} · flickerCount{' '}
                {style.flickerCount} · stepDistance {style.stepDistance} · holdMs {style.holdMs}
                {style.returnStepMs !== null ? ` · returnStepMs ${style.returnStepMs}` : ''}
                {style.flight ? ` · flight ${style.flight.length} colours @ ${style.flightStrength}` : ''}
                {style.traveller ? ` · traveller "${style.traveller}" - walks the edge on its own clock` : ''}
              </p>
            </section>
          );
        })}
      </div>
    </main>
  );
}
