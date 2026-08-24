'use client';

/**
 * The display's configuration - grid, timing, motion - edited here and
 * applied live to every connected display via the sync nudge. This used to
 * live in an on-board panel; the server config is now the only source of
 * truth, so a fresh display always looks like the last one.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, RangeSlider, Select, TextInput } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/bits';
import { MAX_COLS, MAX_ROWS, rowsThatFit } from '@/lib/board/geometry.mjs';
import { DEFAULTS } from '@/lib/board/flipboard.js';
import { CONTROLLER_DEFAULTS } from '@/lib/board/controller.mjs';

type Config = Record<string, unknown>;

const ms = (value: number) => `${value}ms`;

/**
 * The screens a board actually gets put on. A shape is what turns a column
 * count into a row count: with square cards, a board that fills the screen has
 * rows = cols / (screen width / screen height). So the designer picks the
 * screen and how big a card should be, and the grid follows - rather than
 * choosing 20x8 and finding out on the wall that it letterboxes.
 */
const SCREENS = [
  { value: '16:9', label: 'Landscape', w: 16, h: 9 },
  { value: '9:16', label: 'Portrait', w: 9, h: 16 },
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
  };
  const [config, setConfig] = useState<Config>({ ...defaults, ...initial });
  const [error, setError] = useState('');
  const stored = (initial.screen ?? null) as { w: number; h: number } | null;
  const [screen, setScreenState] = useState<{ w: number; h: number }>(stored ?? { w: 16, h: 9 });
  const screenKey =
    SCREENS.find((s) => s.value !== 'custom' && s.w === screen.w && s.h === screen.h)?.value ?? 'custom';

  const cols = Number(config.cols) || 1;
  const suggestedRows = rowsThatFit(cols, screen.w, screen.h);
  const fitsExactly = Number(config.rows) === suggestedRows;
  const fitLine = fitsExactly
    ? `${cols} × ${suggestedRows} square cards fill a ${screen.w}:${screen.h} screen.`
    : `${cols} × ${config.rows} on a ${screen.w}:${screen.h} screen leaves a band ` +
      `${Number(config.rows) > suggestedRows ? 'left and right' : 'top and bottom'}.`;

  function setScreen(next: { w: number; h: number }) {
    setScreenState(next);
    patch('screen', next);
  }

  function pickScreen(value: string) {
    const found = SCREENS.find((s) => s.value === value);
    if (!found || found.value === 'custom') return;
    setScreen({ w: found.w, h: found.h });
  }

  async function patch(key: string, value: unknown) {
    setConfig((prev) => {
      const next = { ...prev, [key]: value };
      onChange?.(next);
      return next;
    });
    setError('');
    try {
      const response = await fetch(`/api/b/${slug}/config`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      // Mirror what the server stored - clamps included.
      setConfig((prev) => {
        const next = { ...prev, ...body.config };
        onChange?.(next);
        return next;
      });
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
        <Field
          label="Screen it goes on"
          hint="The shape of the wall or panel you are designing for. The display always fills its own window; this is what the row count is worked out against."
        >
          <Segmented
            options={SCREENS.map((s) => ({ value: s.value, label: s.label }))}
            value={screenKey}
            onChange={pickScreen}
          />
        </Field>
        {screenKey === 'custom' && (
          <div className="geometry-custom">
            <Field label="Screen width" htmlFor="cfg-screen-w">
              <TextInput
                id="cfg-screen-w"
                type="number"
                min={1}
                value={String(screen.w)}
                onChange={(event) => setScreen({ ...screen, w: Math.max(1, Number(event.target.value) || 1) })}
              />
            </Field>
            <Field label="Screen height" htmlFor="cfg-screen-h">
              <TextInput
                id="cfg-screen-h"
                type="number"
                min={1}
                value={String(screen.h)}
                onChange={(event) => setScreen({ ...screen, h: Math.max(1, Number(event.target.value) || 1) })}
              />
            </Field>
          </div>
        )}
        {range('cfg-cols', 'Cards across', 'cols', 1, MAX_COLS, 1, String)}
        <Field
          label={
            <>
              Cards down <span className="muted">{String(config.rows)}</span>
              <span className="field-range">{fitsExactly ? 'fills the screen' : 'set by hand'}</span>
            </>
          }
          hint={fitLine}
        >
          <div className="geometry-rows">
            <RangeSlider
              id="cfg-rows"
              min={1}
              max={MAX_ROWS}
              step={1}
              value={Number(config.rows)}
              onChange={(event) => patch('rows', Number(event.target.value))}
            />
            {!fitsExactly && (
              <Button size="sm" onClick={() => patch('rows', suggestedRows)}>
                Fit to screen ({suggestedRows})
              </Button>
            )}
          </div>
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
      </div>
      <span className="muted">Changes apply live to every open display.</span>
    </section>
  );
}
