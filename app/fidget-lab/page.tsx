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
  classic: 'What every board does today. A tile misfires anywhere in the set, then travels the long way home.',
  tick: "Dan's: one card ticks over to its neighbour and hurries back. No sweeps.",
  twitchy: 'Three tiles at once, most ticks, and a sweep now and then. For a busy space.',
  sweeping: 'Never a flicker - only the whole board turning over. For something being watched.',
  calm: 'Almost never, and it lingers when it does. For a quiet room.',
};

export default function FidgetLab() {
  const [everyMs, setEveryMs] = useState(5000);
  const pack = (THEMES as any).classic.pack ?? (THEMES as any).classic;
  const ids = Object.keys(FIDGET_STYLES);

  return (
    <main style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <h1>Fidget lab</h1>
      <p className="ui-hint" style={{ maxWidth: 640 }}>
        The same board and the same words, five times. The only difference is
        which fidget each one is doing. Watch them for a minute rather than
        reading the numbers — that is the whole point of the page.
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
                rows={3}
                tilePx={40}
                bar={false}
                ambientMs={everyMs}
                fidget={id}
              />
              <p className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                sweepEvery {style.sweepEvery} · restOdds {style.restOdds} · flickerCount{' '}
                {style.flickerCount} · stepDistance {style.stepDistance} · holdMs {style.holdMs}
                {style.returnStepMs !== null ? ` · returnStepMs ${style.returnStepMs}` : ''}
              </p>
            </section>
          );
        })}
      </div>
    </main>
  );
}
