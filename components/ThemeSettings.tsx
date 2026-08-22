'use client';

/**
 * The board's look, edited in place: start from a preset, change what you
 * like - palette, type, hinge, motion, a colour or an image for one
 * character - watch it on a live board, and save. What is saved is the
 * difference from the preset (lib/board/theme-editor.mjs, board-theme.mjs),
 * so every display of the board draws it and nothing else changes.
 *
 * The draft lives above this component (SettingsClient owns it) because
 * the settings tabs remount their panel: an uploaded logo must survive a
 * look at the queue. Nothing here is saved until Save; the preset switch
 * and reset are draft operations like any other.
 */

import { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, Select, RangeSlider } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/bits';
import { ColorInput } from '@/components/ui/ColorInput';
import { ThemePreview } from '@/components/flapper/ThemePreview';
import { fileToArt } from '@/components/flapper/rasterize';
import { THEMES, THEME_IDS } from '@/lib/board/themes.mjs';
import { RANGES, type ThemePack } from '@/lib/board/theme-pack.mjs';
import { THEME_LIMITS, stableStringify } from '@/lib/board/board-theme.mjs';
import { RING } from '@/lib/board/ring.mjs';
import {
  presetDraft,
  setDraftField,
  setStateField,
  attachArt,
  detachArt,
  clearState,
  parseFont,
  buildFont,
  draftToPatch,
  savedPatch,
  FONT_CHOICES,
  FONT_WEIGHTS,
} from '@/lib/board/theme-editor.mjs';

import type { ThemeDraft } from '@/lib/board/theme-editor.mjs';
export type { ThemeDraft };

const SAMPLE = 'FLAPPER 2026!\nTHE QUICK BROWN\nFOX .,!()';

const themes: Record<string, any> = THEMES;
const ranges: Readonly<Record<string, readonly number[]>> = RANGES;

export function ThemeSettings({
  slug,
  draft,
  onDraft,
  config,
  onSaved,
}: {
  slug: string;
  draft: ThemeDraft;
  onDraft: (draft: ThemeDraft) => void;
  /** The board's saved config, for the dirty check and the saved state after a save. */
  config: Record<string, unknown>;
  onSaved: (config: Record<string, unknown>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [selected, setSelected] = useState<string>('A');
  const [json, setJson] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const patch = useMemo(() => draftToPatch(draft), [draft]);
  const dirty = useMemo(() => {
    if (!patch.ok) return true;
    const was = savedPatch(config);
    return stableStringify({ theme: patch.theme, themePack: patch.themePack }) !== stableStringify(was);
  }, [patch, config]);

  const update = (next: ThemeDraft) => {
    setSaved(false);
    onDraft(next);
  };
  const field = (path: string) => (value: unknown) => update(setDraftField(draft, path, value));
  const num = (path: string) => Number(path.split('.').reduce((o: any, k) => o?.[k], draft.pack));

  const font = parseFont(draft.pack.glyph.font);
  const setFont = (change: Partial<typeof font>) => field('glyph.font')(buildFont({ ...font, ...change }));

  const state = draft.pack.states?.[selected] || {};
  const artKey = state.art as string | undefined;

  async function upload(file: File | undefined) {
    if (!file) return;
    setError('');
    try {
      const { dataUri } = await fileToArt(file, { maxBytes: THEME_LIMITS.maxArtBytes });
      update(attachArt(draft, selected, dataUri));
    } catch (err: any) {
      setError(err.message);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function save() {
    if (!patch.ok) {
      setError(patch.errors.join('; '));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/b/${slug}/config`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ theme: patch.theme, themePack: patch.themePack }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setSaved(true);
      onSaved(body.config);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const slider = (label: string, path: string, step = 0.01) => {
    const [lo = 0, hi = 1] = ranges[path] ?? [];
    return (
      <Field key={path} label={<>{label} <span className="muted">{num(path).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}</span></>} htmlFor={`th-${path}`}>
        <RangeSlider id={`th-${path}`} min={lo} max={hi} step={step} value={num(path)} onChange={(e) => field(path)(Number(e.target.value))} />
      </Field>
    );
  };
  const colour = (label: string, path: string, allowNone = false) => (
    <Field key={path} label={label} htmlFor={`th-${path}`}>
      <ColorInput id={`th-${path}`} value={path.split('.').reduce((o: any, k) => o?.[k], draft.pack) ?? null} onChange={field(path)} allowNone={allowNone} />
    </Field>
  );

  return (
    <section className="settings-block theme-settings">
      <h2>Theme</h2>

      <Field label="Start from" hint="Switching presets replaces your edits with the preset.">
        <Segmented
          options={THEME_IDS.map((id) => ({ value: id, label: themes[id].name }))}
          value={draft.theme}
          onChange={(id) => {
            setJson(null);
            update(presetDraft(id));
          }}
        />
      </Field>

      <ThemePreview pack={draft.pack} text={SAMPLE} cols={14} rows={3} />

      <div className="theme-groups">
        <fieldset className="theme-group">
          <legend>Card</legend>
          {colour('Face', 'card.fill')}
          {colour('Edge', 'card.edge')}
          {slider('Corner radius', 'card.radius')}
          {slider('Sheen', 'card.sheen')}
        </fieldset>
        <fieldset className="theme-group">
          <legend>Glyph</legend>
          {colour('Ink', 'glyph.fill')}
          {colour('Outline', 'glyph.stroke', true)}
          {slider('Outline width', 'glyph.strokeWidth', 0.002)}
          <Field label="Face" htmlFor="th-font-family">
            <Select
              id="th-font-family"
              value={font.family ?? 'custom'}
              onChange={(e) => {
                if (e.target.value !== 'custom') setFont({ family: e.target.value });
              }}
            >
              {FONT_CHOICES.map((choice) => (
                <option key={choice.id} value={choice.id}>{choice.label}</option>
              ))}
              {font.family === null && <option value="custom">Custom: {font.stack}</option>}
            </Select>
          </Field>
          <Field label="Weight" htmlFor="th-font-weight">
            <Select id="th-font-weight" value={font.weight} onChange={(e) => setFont({ weight: e.target.value })}>
              {FONT_WEIGHTS.map((w) => (
                <option key={w} value={w}>{w}</option>
              ))}
            </Select>
          </Field>
          <Field label={<>Size <span className="muted">{font.size}em</span></>} htmlFor="th-font-size">
            <RangeSlider id="th-font-size" min={0.4} max={1.2} step={0.02} value={font.size} onChange={(e) => setFont({ size: Number(e.target.value) })} />
          </Field>
          {slider('Baseline', 'glyph.baseline', 0.005)}
        </fieldset>
        <fieldset className="theme-group">
          <legend>Hinge</legend>
          {colour('Band', 'hinge.fill')}
          {colour('Highlight', 'hinge.highlight', true)}
          {colour('Pins', 'hinge.pin')}
          {slider('Band height', 'hinge.thickness', 0.005)}
        </fieldset>
        <fieldset className="theme-group">
          <legend>Motion</legend>
          {slider('Shading', 'motion.shading')}
          {slider('Shadow', 'motion.shadow')}
          {slider('Highlight', 'motion.highlight')}
        </fieldset>
      </div>

      <fieldset className="theme-group theme-glyphs">
        <legend>One character</legend>
        <div className="theme-ring" role="listbox" aria-label="Characters">
          {RING.map((s) => {
            const touched = Boolean(draft.pack.states?.[s.char]);
            return (
              <button
                key={s.name}
                type="button"
                role="option"
                aria-selected={s.char === selected}
                className={`theme-ring-cell${s.char === selected ? ' is-on' : ''}${touched ? ' is-touched' : ''}`}
                onClick={() => setSelected(s.char)}
                title={s.name}
              >
                {s.char === ' ' ? '␣' : s.char}
              </button>
            );
          })}
        </div>
        <div className="theme-glyph-fields">
          <Field label={`Ink for ${selected === ' ' ? 'blank' : selected}`} htmlFor="th-state-ink">
            <ColorInput id="th-state-ink" value={state.glyph?.fill ?? null} allowNone noneLabel="Inherit" onChange={(v) => update(setStateField(draft, selected, 'glyph.fill', v))} />
          </Field>
          <Field label="Face" htmlFor="th-state-face">
            <ColorInput id="th-state-face" value={state.card?.fill ?? null} allowNone noneLabel="Inherit" onChange={(v) => update(setStateField(draft, selected, 'card.fill', v))} />
          </Field>
          <Field
            label="Image instead of the glyph"
            hint={`PNG, WebP, JPEG or SVG; resized to 128 px and kept under ${Math.round(THEME_LIMITS.maxArtBytes / 1024)} KB.`}
          >
            <div className="theme-art">
              {artKey && draft.pack.art?.[artKey] && <img className="theme-art-thumb" src={draft.pack.art[artKey]} alt="" />}
              <input ref={fileRef} type="file" accept="image/*" onChange={(e) => upload(e.target.files?.[0])} />
              {artKey && (
                <Button size="sm" variant="ghost" onClick={() => update(detachArt(draft, selected))}>
                  Remove image
                </Button>
              )}
            </div>
          </Field>
          {Boolean(draft.pack.states?.[selected]) && (
            <Button size="sm" variant="ghost" onClick={() => update(clearState(draft, selected))}>
              Clear overrides for {selected === ' ' ? 'blank' : selected}
            </Button>
          )}
        </div>
      </fieldset>

      <details className="theme-advanced">
        <summary>Advanced: the pack as JSON</summary>
        <textarea
          className="ui-input ui-textarea theme-json"
          spellCheck={false}
          rows={18}
          value={json ?? JSON.stringify(draft.pack, null, 2)}
          onChange={(e) => setJson(e.target.value)}
        />
        <div className="actions">
          <Button
            size="sm"
            onClick={() => {
              if (json === null) return;
              try {
                const parsed = JSON.parse(json);
                setError('');
                setJson(null);
                update({ theme: draft.theme, pack: { ...themes[draft.theme], ...parsed } });
              } catch (err: any) {
                setError(`JSON: ${err.message}`);
              }
            }}
            disabled={json === null}
          >
            Apply JSON
          </Button>
          {json !== null && (
            <Button size="sm" variant="ghost" onClick={() => setJson(null)}>
              Discard
            </Button>
          )}
        </div>
      </details>

      {!patch.ok && <p className="error">{patch.errors.join('; ')}</p>}
      {error !== '' && <p className="error">{error}</p>}
      <div className="actions">
        <Button variant="primary" onClick={save} disabled={busy || !dirty || !patch.ok}>
          Save theme
        </Button>
        <Button variant="ghost" onClick={() => update(presetDraft(draft.theme))} disabled={busy}>
          Reset to {themes[draft.theme].name}
        </Button>
        {saved && <span className="muted">Saved — every display of this board is drawing it.</span>}
        {!saved && dirty && patch.ok && <span className="muted">Unsaved changes.</span>}
      </div>
    </section>
  );
}
