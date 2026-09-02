'use client';

/**
 * The fidget lab: every fidget that ships, side by side, on real boards.
 *
 * Motion cannot be judged from a table of numbers, and a fidget is nothing
 * but motion - so this page exists to be *watched*, not read. Each board is
 * the same words and the same design; the only thing that differs is which
 * fidget it is doing.
 *
 * It is also the proof for the model itself. Every board below is four
 * numbers and a list of beats, and the caption under each says which - if a
 * fidget on this page cannot be described by its own caption, the model is
 * wrong rather than the fidget.
 *
 * Deliberately not linked from anywhere. It is a bench, not a screen.
 */

import { useState } from 'react';
import { ThemePreview } from '@/components/flapper/ThemePreview';
import { FIDGETS, runMs } from '@/lib/board/fidgets.mjs';
import { THEMES } from '@/lib/board/themes.mjs';

const TEXT = 'GATE 12 BOARDING';

/** What each one is trying to be, in a sentence you can check by looking. */
const NOTES: Record<string, string> = {
  tick: 'One card turns over and is back. The quietest thing the board does.',
  twitchy: 'Three cards at once, more often. For a room with people in it.',
  calm: 'Hardly ever, and unhurried when it does.',
  riffle: 'A card riffling through a few characters, the way a real one settles.',
  'pina-colada': 'Pineapple, coconut, a slice of lime, and gone. Real cards baked in the colour, no letters.',
  rainbow: 'The same shape, hotter and quicker.',
  sherbet: 'Three pastels, barely caught.',
  'ping-pong': 'Out, back, out - a card that cannot settle. Nothing but a list that says as-it-was in the middle.',
};

/** A beat as a word, so the caption reads as the gesture. */
const beatLabel = (beat: any) =>
  beat.kind === 'colour' ? beat.colour : beat.kind === 'house' ? 'house' : 'as-it-was';

export default function FidgetLab() {
  const [on, setOn] = useState(true);
  const pack = (THEMES as any).classic.pack ?? (THEMES as any).classic;
  const ids = Object.keys(FIDGETS);

  return (
    <main style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <h1>Fidget lab</h1>
      <p className="ui-hint" style={{ maxWidth: 700 }}>
        The same board and the same words, once per fidget. Watch them for a
        minute rather than reading the numbers — that is the whole point of the
        page. A fidget lands on <b>any</b> card, blank ones included, so watch
        the empty space as much as the words.
      </p>

      <label style={{ display: 'block', margin: '16px 0' }}>
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />{' '}
        Fidgets on
        <span className="muted">
          {' '}
          — how often is part of each fidget now, not a separate control.
        </span>
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 24 }}>
        {ids.map((id) => {
          const spec: any = (FIDGETS as any)[id];
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
                ambientMs={on ? 1 : 0}
                fidget={id}
              />
              <p className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                {spec.cards} card{spec.cards === 1 ? '' : 's'} · every ~
                {Math.round(spec.everyMs / 1000)}s ±{Math.round(spec.varyMs / 1000)}s ·{' '}
                {spec.beatMs}ms a beat
                <br />
                {spec.beats.map(beatLabel).join(' → ')} ({runMs(spec)}ms in all)
              </p>
            </section>
          );
        })}
      </div>
    </main>
  );
}
