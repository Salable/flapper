'use client';

/**
 * The display's configuration - grid, timing, motion - edited here and
 * applied live to every connected display via the sync nudge. This used to
 * live in an on-board panel; the server config is now the only source of
 * truth, so a fresh display always looks like the last one.
 */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, RangeSlider, Select, TextInput } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/bits';
import {
  MAX_COLS,
  MAX_ROWS,
  gridFor,
  screenLabel,
  CARD_SIZE_IDS,
  DEFAULT_CARD_SIZE,
  DEFAULT_SCREEN as DEFAULT_SCREEN_SHAPE,
} from '@/lib/board/geometry.mjs';
import { DEFAULTS } from '@/lib/board/flipboard.js';
import { CONTROLLER_DEFAULTS } from '@/lib/board/controller.mjs';
import { TEMPLATES } from '@/lib/board-types/templates.mjs';

type Config = Record<string, unknown>;

const ms = (value: number) => `${value}ms`;

/** The human name of the template a board was made from, if it remembers one. */
function templateName(id: unknown) {
  if (typeof id !== 'string') return '';
  return TEMPLATES.get(id)?.name ?? '';
}

/**
 * The screens a board actually gets put on. A shape is what turns a column
 * count into a row count: with square cards, a board that fills the screen has
 * rows = cols / (screen width / screen height). So the designer picks the
 * screen and how big a card should be, and the grid follows - rather than
 * choosing 20x8 and finding out on the wall that it letterboxes.
 */
/** What each step on the scale is called on screen. */
const SIZE_LABELS: Record<string, string> = {
  huge: 'Huge',
  large: 'Large',
  medium: 'Medium',
  small: 'Small',
  tiny: 'Tiny',
};

const SCREENS = [
  { value: '16:9', label: '16:9', w: 16, h: 9 },
  { value: '4:3', label: '4:3', w: 4, h: 3 },
  { value: '9:16', label: '9:16', w: 9, h: 16 },
  { value: '1:1', label: 'Square', w: 1, h: 1 },
  { value: 'custom', label: 'Custom', w: 0, h: 0 },
] as const;


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
  const defaults: Config = {
    cols: DEFAULTS.cols,
    rows: DEFAULTS.rows,
    dwellMs: CONTROLLER_DEFAULTS.dwellMs,
    align: DEFAULTS.align,
    valign: DEFAULTS.valign,
    wrap: DEFAULTS.wrap,
    fastStepMs: DEFAULTS.fastStepMs,
    landStepMs: DEFAULTS.landStepMs,
    sweepMs: DEFAULTS.sweepMs,
    staggerMode: DEFAULTS.staggerMode,
    alwaysFlip: DEFAULTS.alwaysFlip,
    ambientMs: 0,
  };
  const [config, setConfig] = useState<Config>({ ...defaults, ...initial });
  const [error, setError] = useState('');
  type Screen = { w: number; h: number };
  const stored = (initial.screen ?? null) as Partial<Screen> | null;
  const [screen, setScreenState] = useState<Screen>({
    w: stored?.w ?? DEFAULT_SCREEN_SHAPE.w,
    h: stored?.h ?? DEFAULT_SCREEN_SHAPE.h,
  });
  // Where this board's shape came from, so the numbers below can be accounted
  // for rather than just found.
  const fromTemplate = templateName(initial.template);
  const [custom, setCustom] = useState(false);
  const preset = SCREENS.find((s) => s.value !== 'custom' && s.w === screen.w && s.h === screen.h);
  const screenKey = custom || !preset ? 'custom' : preset.value;

  // A ref so the effect below does not re-run every time the parent hands down
  // a fresh closure, which is every render.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  /*
   * The grid is an outcome, and this is the whole of the arithmetic.
   *
   * A board used to be authored as a column count and a row count, with the
   * screen as a hint. That has it backwards twice over: it asks somebody to do
   * the arithmetic the app already does, and it makes "how big is a card" mean
   * something different on every screen. Now the two real facts go in - how big
   * the glass is, and how big a card should be - and cols x rows falls out.
   * Nothing in the system authors a grid any more: not this editor, not a
   * template, not the API.
   */
  const cardSize = CARD_SIZE_IDS.includes(String(config.cardSize))
    ? String(config.cardSize)
    : DEFAULT_CARD_SIZE;
  const grid = gridFor(cardSize, screen);
  const shape = screenLabel(screen);

  /** A card size, and the grid it makes on this screen - one write. */
  function pickSize(size: string) {
    const next = gridFor(size, screen);
    patch({ cardSize: size, cols: next.cols, rows: next.rows });
  }

  /** A screen, and the grid it makes at this card size - one write. */
  function applyScreen(next: Screen) {
    setScreenState(next);
    const made = gridFor(cardSize, next);
    patch({ screen: next, cols: made.cols, rows: made.rows });
  }

  /**
   * Tell the parent what the config is now, after a commit rather than during
   * one. This used to be called from inside a setConfig updater, and an updater
   * runs in the render phase - so it was a setState on a different component
   * mid-render, which React warns about and StrictMode runs twice.
   */
  useEffect(() => {
    onChangeRef.current?.(config);
  }, [config]);

  function setScreen(next: { w: number; h: number }) {
    setCustom(false);
    applyScreen({ ...screen, w: next.w, h: next.h });
  }

  function pickScreen(value: string) {
    // Custom was unreachable: it returned early, and the width and height
    // fields only rendered when the stored shape happened not to match a
    // preset - which nothing could bring about. Choosing it is now a state of
    // its own, so the fields appear and you can type any shape you like.
    if (value === 'custom') {
      setCustom(true);
      return;
    }
    const found = SCREENS.find((s) => s.value === value);
    if (!found) return;
    setScreen({ w: found.w, h: found.h });
  }

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

  const range = (
    id: string,
    labelText: string,
    key: string,
    min: number,
    max: number,
    step: number,
    format: (value: number) => string,
  ) => (
    <Field
      label={
        <>
          {labelText} <span className="muted">{format(Number(config[key]))}</span>
          <span className="field-range">
            {format(min)}–{format(max)}
          </span>
        </>
      }
      htmlFor={id}
    >
      <RangeSlider
        id={id}
        min={min}
        max={max}
        step={step}
        value={Number(config[key])}
        onChange={(event) => patch(key, Number(event.target.value))}
      />
    </Field>
  );

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
        <Field
          label="Screen it goes on"
          hint="The shape of the wall or panel you are designing for. The display always fills its own window."
        >
          <Segmented
            options={SCREENS.map((s) => ({ value: s.value, label: s.label }))}
            value={screenKey}
            onChange={pickScreen}
          />
        </Field>
        {screenKey === 'custom' && (
          <div className="geometry-custom">
            <Field
              label="Screen width"
              htmlFor="cfg-screen-w"
              hint="Any units - centimetres, pixels, or just the proportions. Only the ratio matters."
            >
              <TextInput
                id="cfg-screen-w"
                type="number"
                min={1}
                value={String(screen.w)}
                onChange={(event) => {
                  const w = Math.max(1, Number(event.target.value) || 1);
                  applyScreen({ ...screen, w });
                }}
              />
            </Field>
            <Field label="Screen height" htmlFor="cfg-screen-h">
              <TextInput
                id="cfg-screen-h"
                type="number"
                min={1}
                value={String(screen.h)}
                onChange={(event) => {
                  const h = Math.max(1, Number(event.target.value) || 1);
                  applyScreen({ ...screen, h });
                }}
              />
            </Field>
          </div>
        )}
        <Field
          label={
            <>
              Card size{' '}
              <span className="muted">
                {SIZE_LABELS[cardSize]}
              </span>
            </>
          }
          hint="How big a card is on the glass. A real size, so it reads the same from the back of the room whatever screen it goes on - a bigger screen holds more of them rather than bigger ones."
        >
          <div className="geometry-sizes">
            {CARD_SIZE_IDS.map((id: string) => {
              const grid = gridFor(id, screen);
              return (
                <button
                  key={id}
                  type="button"
                  className={`geometry-size${cardSize === id ? ' is-on' : ''}`}
                  aria-pressed={cardSize === id}
                  onClick={() => pickSize(id)}
                >
                  <span className="geometry-size-name">{SIZE_LABELS[id]}</span>
                  <span className="geometry-size-grid">
                    {grid.cols} × {grid.rows}
                  </span>
                </button>
              );
            })}
          </div>
        </Field>
        {/* The grid, as an outcome. Never an input: a column count is what the
            screen and the card size come to, and typing one is doing arithmetic
            the app has already done. */}
        <Field label="The board this makes">
          <p className="geometry-derived">
            <strong>
              {grid.cols} × {grid.rows} cards
            </strong>{' '}
            — {SIZE_LABELS[cardSize].toLowerCase()} cards on a {shape} screen.
          </p>
        </Field>
      </div>
      <div className="config-grid">
        {range('cfg-dwell', 'Hold', 'dwellMs', 0, 8000, 100, ms)}
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
        {range('cfg-fast', 'Scroll speed', 'fastStepMs', 25, 200, 5, ms)}
        {range('cfg-land', 'Landing', 'landStepMs', 40, 500, 10, ms)}
        {range('cfg-sweep', 'Sweep', 'sweepMs', 0, 2000, 25, ms)}
        {select('cfg-stagger', 'Sweep shape', 'staggerMode', [
          ['diagonal', 'Diagonal'],
          ['column', 'Column'],
          ['row', 'Row'],
          ['random', 'Random'],
          ['none', 'None'],
        ])}
        <div className="ui-field">
          <Checkbox
            id="cfg-always"
            label="Always flip"
            checked={Boolean(config.alwaysFlip)}
            onChange={(event) => patch('alwaysFlip', event.target.checked)}
          />
        </div>
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
