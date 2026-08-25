'use client';

/**
 * The display's configuration - grid, timing, motion - edited here and
 * applied live to every connected display via the sync nudge. This used to
 * live in an on-board panel; the server config is now the only source of
 * truth, so a fresh display always looks like the last one.
 */

import { useEffect, useRef, useState } from 'react';
import { Field, Select } from '@/components/ui/Field';
import { screenOf, cardSizeOf, gridForConfig, screenLabel } from '@/lib/board/geometry.mjs';
import { DEFAULTS } from '@/lib/board/flipboard.js';
import { TEMPLATES } from '@/lib/board-types/templates.mjs';

type Config = Record<string, unknown>;

/** The human name of the template a board was made from, if it remembers one. */
function templateName(id: unknown) {
  if (typeof id !== 'string') return '';
  return TEMPLATES.get(id)?.name ?? '';
}

/** What each step on the card-size scale is called on screen. */
const SIZE_LABELS: Record<string, string> = {
  huge: 'Huge',
  large: 'Large',
  medium: 'Medium',
  small: 'Small',
  tiny: 'Tiny',
};


export function DisplayConfig({
  slug,
  initial,
  onChange,
}: {
  slug: string;
  initial: Config;
  /** Every change, so a live preview beside the controls can follow the grid. */
  onChange?: (config: Config) => void;
}) {
  /*
   * Only what this panel actually edits: how content sits, and how often the
   * board fidgets. Screen and card size are read-only here - see "The board
   * this makes" below - because they are edited from the board's own panel
   * now (BoardSidebar). This state used to hold a mount-time snapshot of
   * them too, and reporting the whole thing on every unrelated change (an
   * Align edit, say) meant a stale copy could overwrite whatever the
   * sidebar had just set. Kept to the four fields it owns, that cannot
   * happen.
   */
  const defaults: Config = {
    align: DEFAULTS.align,
    valign: DEFAULTS.valign,
    wrap: DEFAULTS.wrap,
    ambientMs: 0,
  };
  const [config, setConfig] = useState<Config>({
    align: initial.align ?? defaults.align,
    valign: initial.valign ?? defaults.valign,
    wrap: initial.wrap ?? defaults.wrap,
    ambientMs: initial.ambientMs ?? defaults.ambientMs,
  });
  const [error, setError] = useState('');
  // Where this board's shape came from, so the numbers below can be accounted
  // for rather than just found.
  const fromTemplate = templateName(initial.template);

  // A ref so the effect below does not re-run every time the parent hands down
  // a fresh closure, which is every render.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  /*
   * The board's shape, read straight from `initial` on every render rather
   * than copied into state at mount. Editing it lives in BoardSidebar now -
   * this is purely a report, so it has to follow `initial` live or it goes
   * stale the moment the sidebar changes something this component never
   * hears about.
   */
  const screen = screenOf(initial);
  const cardSize = cardSizeOf(initial);
  const grid = gridForConfig(initial);
  const shape = screenLabel(screen);

  /**
   * Tell the parent what the config is now, after a commit rather than during
   * one. This used to be called from inside a setConfig updater, and an updater
   * runs in the render phase - so it was a setState on a different component
   * mid-render, which React warns about and StrictMode runs twice.
   */
  useEffect(() => {
    onChangeRef.current?.(config);
  }, [config]);

  /*
   * One field or several, but always one request.
   *
   * Picking a screen changes the shape and the row count that follows from it,
   * and sending those as two PATCHes raced: both read-modify-write the same
   * JSON column, the server merges them with no transaction, and whichever
   * response landed last dictated the panel. On a local PGlite the queries are
   * too fast to lose one; against a hosted database over a socket the earlier
   * change was dropped outright. Anything that changes two related fields
   * sends them together.
   */
  async function patch(fields: Record<string, unknown>): Promise<void>;
  async function patch(key: string, value: unknown): Promise<void>;
  async function patch(keyOrFields: string | Record<string, unknown>, value?: unknown) {
    const fields =
      typeof keyOrFields === 'string' ? { [keyOrFields]: value } : keyOrFields;
    setConfig((prev) => ({ ...prev, ...fields }));
    setError('');
    try {
      const response = await fetch(`/api/b/${slug}/config`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(fields),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      // Mirror what the server stored - clamps included.
      setConfig((prev) => ({ ...prev, ...body.config }));
    } catch (err: any) {
      setError(err.message);
    }
  }

  const select = (id: string, labelText: string, key: string, options: [string, string][], help?: string) => (
    <Field label={labelText} htmlFor={id} hint={help}>
      <Select id={id} value={String(config[key])} onChange={(event) => patch(key, event.target.value)}>
        {options.map(([value, name]) => (
          <option key={value} value={value}>
            {name}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <section className="settings-block">
      <h2>Shape &amp; size</h2>
      {error !== '' && <p className="error">{error}</p>}
      <div className="geometry">
        {fromTemplate !== '' && (
          <p className="ui-hint">
            This board was made from the <strong>{fromTemplate}</strong> template, which is where
            its card size came from. Nothing here is fixed - change any of it.
          </p>
        )}
        {/*
          The screen and card size themselves are edited in the board's own
          panel now (BoardSidebar), not here - this used to be a second,
          duplicate editor for the same two fields, in a different widget
          style, on the same page. What is left is the fact they come to.
        */}
        <Field label="The board this makes">
          <p className="geometry-derived">
            <strong>
              {grid.cols} × {grid.rows} cards
            </strong>{' '}
            — {SIZE_LABELS[cardSize].toLowerCase()} cards on a {shape} screen.
          </p>
        </Field>
      </div>
      {/*
        Hold, Scroll speed, Landing, Sweep, Sweep shape and Always flip lived
        here and are gone: they are how the board moves, which is the
        design's business, not this board's - see TODO.md, "Board motion
        belongs to the design". Align, Vertical and Wrap stay: they are how
        this content sits, per board, WYSIWYG.
      */}
      <div className="config-grid">
        {select('cfg-align', 'Align', 'align', [
          ['left', 'Left'],
          ['center', 'Center'],
          ['right', 'Right'],
        ])}
        {select('cfg-valign', 'Vertical', 'valign', [
          ['top', 'Top'],
          ['middle', 'Middle'],
          ['bottom', 'Bottom'],
        ])}
        {select('cfg-wrap', 'Wrap', 'wrap', [
          ['word', 'Word'],
          ['char', 'Char'],
          ['none', 'None'],
        ])}
        <Field
          label={
            <>
              Fidget{' '}
              <span className="muted">
                {Number(config.ambientMs) > 0 ? `every ${Math.round(Number(config.ambientMs) / 1000)}s` : 'off'}
              </span>
            </>
          }
          htmlFor="cfg-ambient"
          hint="A board holding one message sits perfectly still, which a real one never does. On, it twitches a tile now and then and corrects itself, and sweeps about once in twelve. Off by default - a wall should not clack all night unless you asked it to."
        >
          <Select
            id="cfg-ambient"
            value={String(Number(config.ambientMs) || 0)}
            onChange={(event) => patch('ambientMs', Number(event.target.value))}
          >
            <option value="0">Off - perfectly still</option>
            <option value="15000">Every 15 seconds</option>
            <option value="30000">Every 30 seconds</option>
            <option value="60000">Every minute</option>
            <option value="300000">Every 5 minutes</option>
          </Select>
        </Field>
      </div>
      <span className="muted">Changes apply live to every open display.</span>
    </section>
  );
}
