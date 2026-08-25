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

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, LinkButton } from '@/components/ui/Button';
import { Field, Select, RangeSlider, Checkbox } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/bits';
import { ColorInput } from '@/components/ui/ColorInput';
import { fileToArt } from '@/components/flapper/rasterize';
import { THEMES, THEME_IDS, DEFAULT_THEME } from '@/lib/board/themes.mjs';
import { RANGES, STAGGER_MODES, type ThemePack } from '@/lib/board/theme-pack.mjs';
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

/**
 * A whole wash per kind, because a half-built one is not a valid pack: a
 * gradient with one stop, or a runner with no colour, is refused by
 * validatePack - so there is no field-by-field way in. Switching kind replaces
 * the spec rather than adding to it, which also stops a `gradient` being
 * written onto a spec that already has `corners` and quietly doing nothing.
 */
const WASHES: Record<string, Record<string, unknown>> = {
  gradient: { gradient: { from: '#f7d6e3', to: '#cfe3f8', angle: 35 }, mode: 'overlay', strength: 0.85 },
  corners: {
    corners: { tl: '#7af0e0', tr: '#8ecff5', bl: '#f7ee79', br: '#f4738d' },
    mode: 'multiply',
    strength: 0.9,
  },
  runner: { runner: { colour: '#f2b134', length: 5, periodMs: 9000 }, mode: 'screen', strength: 0.9 },
};

/** Which kind of wash a pack has. The editor showed "Gradient" for all of them. */
function washKind(tint: Record<string, unknown> | null | undefined) {
  if (!tint) return 'none';
  if (tint.runner) return 'runner';
  if (tint.corners) return 'corners';
  if (tint.gradient) return 'gradient';
  return 'none';
}

const TINT_MODE_LABELS: [string, string][] = [
  ['overlay', 'Colour the face'],
  ['multiply', 'Darken'],
  ['screen', 'Lighten'],
  ['wash', 'Wash over everything'],
];

/** `Number(undefined)` is NaN, which is not nullish - so `?? 1` never fired. */
function strengthOf(tint: { strength?: number } | null | undefined) {
  const value = Number(tint?.strength);
  return Number.isFinite(value) ? value : 1;
}

const themes: Record<string, any> = THEMES;
const ranges: Readonly<Record<string, readonly number[]>> = RANGES;

export function ThemeSettings({
  slug,
  draft,
  onDraft,
  config,
  onSaved,
  saveTo,
  pickOnly = false,
}: {
  slug: string;
  draft: ThemeDraft;
  onDraft: (draft: ThemeDraft) => void;
  /** The board's saved config, for the dirty check and the saved state after a save. */
  config: Record<string, unknown>;
  onSaved: (config: Record<string, unknown>) => void;
  /**
   * Where a save goes, if not to a board's config.
   *
   * The editor is the same whether you are dressing one board or authoring a
   * design; only the destination differs, and the dirty check with it. A board
   * saves a sparse diff against a preset, because that is what a board's
   * override is; a design saves its whole pack, because a design is a thing in
   * its own right.
   */
  saveTo?: {
    label: string;
    dirty: boolean;
    save: (draft: ThemeDraft) => Promise<void>;
  };
  /**
   * Pick a design, do not edit one. A board wears a design; making one - the
   * colours, the wash, a per-character override - is a Designs job, done
   * once, on a thing you can name and reuse, not redone from scratch on every
   * board that happens to want it. This board's Display tab used the whole
   * editor to do both, which meant customising a look here never reached
   * anywhere else, and any of ten boards wanting the same tweak paid for it
   * ten times.
   */
  pickOnly?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [selected, setSelected] = useState<string>('A');
  const [json, setJson] = useState<string | null>(null);
  /**
   * Your own designs, so a board you already have can wear one. Without this a
   * design was applicable exactly once, at the moment a board was created.
   * They are copied in, not linked: the board stores what it was given, so
   * editing the design later never reaches a wall.
   */
  const [own, setOwn] = useState<{ id: string; name: string; pack: any; basedOn: string | null }[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/designs')
      .then((response) => (response.ok ? response.json() : { designs: [] }))
      .then((body) => {
        if (!cancelled) setOwn(body.designs ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);

  const patch = useMemo(() => draftToPatch(draft), [draft]);
  const boardDirty = useMemo(() => {
    if (!patch.ok) return true;
    const was = savedPatch(config);
    return stableStringify({ theme: patch.theme, themePack: patch.themePack }) !== stableStringify(was);
  }, [patch, config]);
  const dirty = saveTo ? saveTo.dirty : boardDirty;

  const update = (next: ThemeDraft) => {
    setSaved(false);
    onDraft(next);
  };
  const field = (path: string) => (value: unknown) => update(setDraftField(draft, path, value));
  const num = (path: string) => Number(path.split('.').reduce((o: any, k) => o?.[k], draft.pack));

  const font = parseFont(draft.pack.glyph.font);
  const setFont = (change: Partial<typeof font>) => field('glyph.font')(buildFont({ ...font, ...change }));

  const tint = (draft.pack as any).tint as Record<string, any> | null | undefined;
  const kind = washKind(tint);
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
      if (saveTo) {
        await saveTo.save(draft);
        setSaved(true);
        return;
      }
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
      <Field
        key={path}
        label={
          <>
            {label} <span className="muted">{num(path).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}</span>
            <span className="field-range">
              {lo}–{hi}
            </span>
          </>
        }
        htmlFor={`th-${path}`}
      >
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
      <h2>{pickOnly ? 'Design' : 'Theme'}</h2>

      <Field
        label="Start from"
        hint={
          saveTo
            ? 'Replaces this design with the one you pick. A starting point, copied in - nothing stays linked.'
            : pickOnly
              ? "Replaces this board's look with the one you pick. To make your own, go to Designs."
              : "Replaces this board's look with the one you pick. Your own designs are copied in - editing here afterwards changes the board, never the design."
        }
      >
        <Select
          id="th-start-from"
          value={draft.theme}
          onChange={(event) => {
            const value = event.target.value;
            setJson(null);
            const chosen = own.find((design) => `design:${design.id}` === value);
            update(chosen ? { theme: chosen.basedOn ?? DEFAULT_THEME, pack: chosen.pack } : presetDraft(value));
          }}
        >
          <optgroup label="In the box">
            {THEME_IDS.map((id: string) => (
              <option key={id} value={id}>
                {themes[id].name}
              </option>
            ))}
          </optgroup>
          {own.length > 0 && (
            <optgroup label="Yours">
              {own.map((design) => (
                <option key={design.id} value={`design:${design.id}`}>
                  {design.name}
                </option>
              ))}
            </optgroup>
          )}
        </Select>
      </Field>

      {!pickOnly && (
        <>
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
                  <legend>Light</legend>
                  {slider('Shading', 'motion.shading')}
                  {slider('Shadow', 'motion.shadow')}
                  {slider('Highlight', 'motion.highlight')}
                </fieldset>
                <fieldset className="theme-group">
                  {/* How the physical board moves - the flip's mechanical
                      feel, and how long a message sits once landed. A
                      design's property now, not a per-board one: see
                      TODO.md, "Board motion belongs to the design". */}
                  <legend>Advanced</legend>
                  {slider('Hold', 'advanced.dwellMs', 25)}
                  {slider('Scroll speed', 'advanced.fastStepMs')}
                  {slider('Landing', 'advanced.landStepMs')}
                  {slider('Sweep', 'advanced.sweepMs', 5)}
                  <Field label="Sweep shape" htmlFor="th-stagger">
                    <Select
                      id="th-stagger"
                      value={draft.pack.advanced.staggerMode}
                      onChange={(e) => field('advanced.staggerMode')(e.target.value)}
                    >
                      {STAGGER_MODES.map((mode: string) => (
                        <option key={mode} value={mode}>
                          {mode === 'none' ? 'None' : mode[0].toUpperCase() + mode.slice(1)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Always flip" htmlFor="th-always-flip">
                    <Checkbox
                      id="th-always-flip"
                      label="Every tile does a full revolution, even unchanged"
                      checked={Boolean(draft.pack.advanced.alwaysFlip)}
                      onChange={(e) => field('advanced.alwaysFlip')(e.target.checked)}
                    />
                  </Field>
                </fieldset>
                <fieldset className="theme-group">
                  <legend>Wash</legend>
                  <Field
                    label="Across the grid"
                    hint="A colour per card, so the board carries a gradient. Real boards have identical tiles, so this is deliberately not one."
                  >
                    <Segmented
                      options={[
                        { value: 'none', label: 'None' },
                        { value: 'gradient', label: 'Gradient' },
                        { value: 'corners', label: 'Corners' },
                        { value: 'runner', label: 'Runner' },
                      ]}
                      value={kind}
                      onChange={(next) => field('tint')(next === 'none' ? null : { ...WASHES[next] })}
                    />
                  </Field>
                  {kind === 'gradient' && (
                    <>
                      {colour('From', 'tint.gradient.from')}
                      {colour('To', 'tint.gradient.to')}
                      <Field
                        label={
                          <>
                            Angle <span className="muted">{Math.round(Number(tint?.gradient?.angle) || 0)}°</span>
                            <span className="field-range">0–360</span>
                          </>
                        }
                        htmlFor="th-tint-angle"
                      >
                        <RangeSlider
                          id="th-tint-angle"
                          min={0}
                          max={360}
                          step={5}
                          value={Number(tint?.gradient?.angle) || 0}
                          onChange={(e) => field('tint.gradient.angle')(Number(e.target.value))}
                        />
                      </Field>
                    </>
                  )}
                  {kind === 'corners' && (
                    <>
                      {colour('Top left', 'tint.corners.tl')}
                      {colour('Top right', 'tint.corners.tr')}
                      {colour('Bottom left', 'tint.corners.bl')}
                      {colour('Bottom right', 'tint.corners.br')}
                    </>
                  )}
                  {kind === 'runner' && (
                    <>
                      {colour('The light', 'tint.runner.colour')}
                      <Field
                        label={
                          <>
                            Tail <span className="muted">{Number(tint?.runner?.length) || 1}</span>
                            <span className="field-range">1–20 cards</span>
                          </>
                        }
                        htmlFor="th-runner-length"
                      >
                        <RangeSlider
                          id="th-runner-length"
                          min={1}
                          max={20}
                          step={1}
                          value={Number(tint?.runner?.length) || 1}
                          onChange={(e) => field('tint.runner.length')(Number(e.target.value))}
                        />
                      </Field>
                      <Field
                        label={
                          <>
                            One lap <span className="muted">{Math.round((Number(tint?.runner?.periodMs) || 9000) / 1000)}s</span>
                            <span className="field-range">1–60s</span>
                          </>
                        }
                        htmlFor="th-runner-period"
                      >
                        <RangeSlider
                          id="th-runner-period"
                          min={1000}
                          max={60000}
                          step={500}
                          value={Number(tint?.runner?.periodMs) || 9000}
                          onChange={(e) => field('tint.runner.periodMs')(Number(e.target.value))}
                        />
                      </Field>
                    </>
                  )}
                  {kind !== 'none' && (
                    <>
                      <Field
                        label={
                          <>
                            Strength{' '}
                            <span className="muted">{strengthOf(tint).toFixed(2)}</span>
                            <span className="field-range">0–1</span>
                          </>
                        }
                        htmlFor="th-tint-strength"
                      >
                        <RangeSlider
                          id="th-tint-strength"
                          min={0}
                          max={1}
                          step={0.05}
                          value={strengthOf(tint)}
                          onChange={(e) => field('tint.strength')(Number(e.target.value))}
                        />
                      </Field>
                      <Field
                        label="How it applies"
                        htmlFor="th-tint-mode"
                        hint="Colour the face leaves a pure black or white glyph alone, so the letters stay readable."
                      >
                        <Select
                          id="th-tint-mode"
                          value={String(tint?.mode ?? 'overlay')}
                          onChange={(e) => field('tint.mode')(e.target.value)}
                        >
                          {TINT_MODE_LABELS.map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </>
                  )}
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
        </>
      )}
      {pickOnly && (
        <p className="theme-pickonly-hint muted">
          Colours, wash, type and per-character overrides live in{' '}
          <LinkButton size="sm" href="/designs">
            Designs
          </LinkButton>
          {' '}- make or edit one there, then start from it here.
        </p>
      )}

      {!patch.ok && <p className="error">{patch.errors.join('; ')}</p>}
      {error !== '' && <p className="error">{error}</p>}
      <div className="actions">
        <Button variant="primary" onClick={save} disabled={busy || !dirty || !patch.ok}>
          {saveTo ? saveTo.label : pickOnly ? 'Apply design' : 'Save theme'}
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
