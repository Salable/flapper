'use client';

/**
 * The fidget designer.
 *
 * Four controls and a list, which is the whole model - if this page needs a
 * fifth control, the model has grown a field and should be argued with first.
 *
 * The board beside it is the real engine running the real fidget, not a
 * drawing of one. That is the point of the page: a fidget is nothing but
 * motion, so the only way to design one is to watch it. Every edit takes
 * effect on the next run.
 */

import { useMemo, useState } from 'react';
import { ThemePreview } from '@/components/flapper/ThemePreview';
import { Field, TextInput } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/bits';
import { FIDGETS, runMs, validateFidget } from '@/lib/board/fidgets.mjs';
import { THEMES } from '@/lib/board/themes.mjs';

type Beat = { kind: 'colour'; colour: string } | { kind: 'house' } | { kind: 'origin' };

const TEXT = 'GATE 12 BOARDING';

/** Somewhere to start that is not a blank page. */
const START = FIDGETS['pina-colada'];

/** A colour to reach for when a beat is added - the board's own amber. */
const NEW_COLOUR = '#d8b25a';

const label = (beat: Beat) =>
  beat.kind === 'colour' ? beat.colour : beat.kind === 'house' ? 'house' : 'as it was';

export default function FidgetDesigner() {
  const [everyMs, setEveryMs] = useState<number>(START.everyMs);
  const [varyMs, setVaryMs] = useState<number>(START.varyMs);
  const [cards, setCards] = useState<number>(START.cards);
  const [beatMs, setBeatMs] = useState<number>(START.beatMs);
  const [beats, setBeats] = useState<Beat[]>([...START.beats] as Beat[]);
  const [running, setRunning] = useState(true);

  const spec = useMemo(
    () => ({ everyMs, varyMs, cards, beatMs, beats }),
    [everyMs, varyMs, cards, beatMs, beats],
  );
  const faults = useMemo(() => validateFidget(spec), [spec]);
  const ok = faults.length === 0;

  /*
   * A broken spec is not handed to the board. `resolveFidget` would fall back
   * to the quiet one, which looks like the preview ignoring you rather than
   * like an error - so the board keeps doing the last good thing and the
   * faults are shown instead.
   */
  const [lastGood, setLastGood] = useState(spec);
  if (ok && lastGood !== spec) setLastGood(spec);

  const edit = (index: number, beat: Beat) =>
    setBeats((list) => list.map((b, i) => (i === index ? beat : b)));
  const remove = (index: number) => setBeats((list) => list.filter((_, i) => i !== index));
  const move = (index: number, by: number) =>
    setBeats((list) => {
      const to = index + by;
      if (to < 0 || to >= list.length) return list;
      const next = [...list];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  const add = (beat: Beat) => setBeats((list) => [...list, beat]);

  const json = JSON.stringify(spec, null, 2);

  return (
    <main style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <h1>Fidget designer</h1>
      <p className="ui-hint" style={{ maxWidth: 680 }}>
        A fidget is four numbers and a list of beats. The list is the gesture:
        its length is how long the gesture lasts, so adding a colour makes it a
        beat longer. Watch the board rather than reading the numbers.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 420px) 1fr', gap: 32, alignItems: 'start' }}>
        <div>
          <section className="settings-block">
            <h2>How it runs</h2>
            <Field label="How often (seconds)" htmlFor="fd-every">
              <TextInput
                id="fd-every"
                value={String(Math.round(everyMs / 1000))}
                onChange={(e) => setEveryMs(Math.max(1, Number(e.target.value) || 0) * 1000)}
              />
            </Field>
            <Field
              label="Give or take (seconds)"
              htmlFor="fd-vary"
              hint="A fidget on an exact interval reads as a clock, which is the one thing it must not be."
            >
              <TextInput
                id="fd-vary"
                value={String(Math.round(varyMs / 1000))}
                onChange={(e) => setVaryMs(Math.max(0, Number(e.target.value) || 0) * 1000)}
              />
            </Field>
            <Field label="Cards at once" htmlFor="fd-cards">
              <TextInput
                id="fd-cards"
                value={String(cards)}
                onChange={(e) => setCards(Math.max(1, Math.round(Number(e.target.value) || 1)))}
              />
            </Field>
            <Field label="How long each beat (ms)" htmlFor="fd-beat">
              <TextInput
                id="fd-beat"
                value={String(beatMs)}
                onChange={(e) => setBeatMs(Math.max(1, Math.round(Number(e.target.value) || 1)))}
              />
            </Field>
          </section>

          <section className="settings-block">
            <h2>The beats</h2>
            <p className="ui-hint">
              Each one is a card face and one beat long. <b>As it was</b> is what
              makes ping pong a thing you write rather than a feature: a colour,
              as it was, a colour, and the card is blinking.
            </p>
            <ol className="queue-list">
              {beats.map((beat, index) => (
                <li key={index}>
                  <span className="queue-text">
                    {beat.kind === 'colour' ? (
                      <>
                        <input
                          type="color"
                          value={beat.colour}
                          aria-label={`Colour of beat ${index + 1}`}
                          onChange={(e) => edit(index, { kind: 'colour', colour: e.target.value })}
                          style={{ verticalAlign: 'middle', marginRight: 8 }}
                        />
                        {beat.colour}
                      </>
                    ) : (
                      label(beat)
                    )}
                  </span>
                  <span className="queue-meta muted">beat {index + 1}</span>
                  <span className="queue-actions">
                    <button title="Earlier" aria-label={`Move beat ${index + 1} earlier`} onClick={() => move(index, -1)}>
                      ↑
                    </button>
                    <button title="Later" aria-label={`Move beat ${index + 1} later`} onClick={() => move(index, 1)}>
                      ↓
                    </button>
                    <button title="Remove" aria-label={`Remove beat ${index + 1}`} onClick={() => remove(index)}>
                      ✕
                    </button>
                  </span>
                </li>
              ))}
            </ol>
            <div className="ui-modal-actions" style={{ justifyContent: 'flex-start' }}>
              <Button onClick={() => add({ kind: 'colour', colour: NEW_COLOUR })}>+ Colour</Button>
              <Button onClick={() => add({ kind: 'house' })}>+ House</Button>
              <Button onClick={() => add({ kind: 'origin' })}>+ As it was</Button>
            </div>
          </section>
        </div>

        <div>
          <div className="board-preview">
            <ThemePreview
              pack={(THEMES as any).classic.pack ?? (THEMES as any).classic}
              text={TEXT}
              cols={16}
              rows={4}
              tilePx={44}
              bar={false}
              ambientMs={running ? 1 : 0}
              fidget={lastGood}
            />
            <div className="design-preview-bar">
              <p className="design-preview-caption">
                {beats.length} beat{beats.length === 1 ? '' : 's'} ·{' '}
                {ok ? `${runMs(spec)}ms in all` : 'not a valid fidget yet'} ·{' '}
                {beats.map(label).join(' → ') || 'nothing'}
              </p>
            </div>
          </div>

          <label style={{ display: 'block', margin: '12px 0' }}>
            <input type="checkbox" checked={running} onChange={(e) => setRunning(e.target.checked)} />{' '}
            Running
          </label>

          {!ok && (
            /* Every fault at once, never just the first - the same contract the
               validator gives an agent, for the same reason. */
            <ul className="error" style={{ margin: '12px 0', paddingLeft: 18 }}>
              {faults.map((fault) => (
                <li key={fault}>{fault}</li>
              ))}
            </ul>
          )}

          <section className="settings-block">
            <h2>Put it on a board</h2>
            <p className="ui-hint">
              A board takes this whole thing, not just a name - so a fidget you
              made here works on any board without shipping it in the app.
            </p>
            <code className="curl" style={{ display: 'block', whiteSpace: 'pre-wrap' }}>
              {`curl -X PATCH {apiBase}/config \\
  -H "authorization: Bearer $KEY" -H 'content-type: application/json' \\
  -d '${JSON.stringify({ ambientMs: 30000, fidget: spec })}'`}
            </code>
            <div className="ui-modal-actions" style={{ justifyContent: 'flex-start' }}>
              <CopyButton value={json} label="Copy the fidget" />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
