'use client';

/**
 * The display's configuration - grid, timing, motion - edited here and
 * applied live to every connected display via the sync nudge. This used to
 * live in an on-board panel; the server config is now the only source of
 * truth, so a fresh display always looks like the last one.
 */

import { useState } from 'react';
import { DEFAULTS } from '@/lib/board/flipboard.js';
import { CONTROLLER_DEFAULTS } from '@/lib/board/controller.mjs';
import { DEFAULT_THEME, THEMES, resolveTheme } from '@/lib/board/themes.mjs';

type Config = Record<string, unknown>;

const ms = (value: number) => `${value}ms`;

export function DisplayConfig({ slug, initial }: { slug: string; initial: Config }) {
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
    theme: DEFAULT_THEME,
  };
  const [config, setConfig] = useState<Config>({ ...defaults, ...initial });
  const [error, setError] = useState('');

  async function patch(key: string, value: unknown) {
    setConfig((prev) => ({ ...prev, [key]: value }));
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
    <div className="field">
      <label htmlFor={id}>
        {labelText} <span className="muted">{format(Number(config[key]))}</span>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number(config[key])}
        onChange={(event) => patch(key, Number(event.target.value))}
      />
    </div>
  );

  const select = (id: string, labelText: string, key: string, options: [string, string][], help?: string) => (
    <div className="field">
      <label htmlFor={id}>{labelText}</label>
      <select id={id} value={String(config[key])} onChange={(event) => patch(key, event.target.value)}>
        {options.map(([value, name]) => (
          <option key={value} value={value}>
            {name}
          </option>
        ))}
      </select>
      {help && <span className="muted">{help}</span>}
    </div>
  );

  return (
    <section className="settings-block">
      <h2>Display</h2>
      {error !== '' && <p className="error">{error}</p>}
      <div className="config-grid">
        {select(
          'cfg-theme',
          'Tiles',
          'theme',
          Object.values(THEMES).map((theme) => [theme.id, theme.name] as [string, string]),
          resolveTheme(String(config.theme)).description,
        )}
        {range('cfg-cols', 'Columns', 'cols', 1, 80, 1, String)}
        {range('cfg-rows', 'Rows', 'rows', 1, 40, 1, String)}
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
        <div className="field checkbox">
          <label htmlFor="cfg-always">
            <input
              id="cfg-always"
              type="checkbox"
              checked={Boolean(config.alwaysFlip)}
              onChange={(event) => patch('alwaysFlip', event.target.checked)}
            />{' '}
            Always flip
          </label>
        </div>
      </div>
      <span className="muted">Changes apply live to every open display.</span>
    </section>
  );
}
