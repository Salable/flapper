'use client';

/**
 * The type's `advanced` params - what creation deliberately did not ask -
 * as a settings block. Generic over the registry metadata, like the create
 * form: a type that marks a param advanced gets it here with no UI work.
 * Values are held as raw strings while typing; PATCH /config validates by
 * the param's own schema and echoes the stored (coerced, clamped) value.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, TextInput, Select, Checkbox } from '@/components/ui/Field';
import type { TypeMeta } from '@/components/CreateBoardModal';

type Param = TypeMeta['createParams'][number];

export function TypeSettings({
  slug,
  params,
  config,
  onSaved,
}: {
  slug: string;
  params: Param[];
  config: Record<string, unknown>;
  onSaved?: (config: Record<string, unknown>) => void;
}) {
  const advanced = params.filter((param) => param.advanced);
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(advanced.map((param) => [param.key, config[param.key] ?? param.default ?? ''])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  if (advanced.length === 0) return null;

  const dirty = advanced.some(
    (param) => String(values[param.key] ?? '') !== String(config[param.key] ?? param.default ?? ''),
  );
  const set = (key: string, value: unknown) => {
    setSaved(false);
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  async function save() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/b/${slug}/config`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setValues((prev) => ({ ...prev, ...body.config }));
      setSaved(true);
      onSaved?.(body.config);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-block">
      <h2>Type settings</h2>
      {advanced.map((param) => (
        <Field key={param.key} label={param.label} hint={param.hint} htmlFor={`ts-${param.key}`}>
          {param.kind === 'number' ? (
            <TextInput
              id={`ts-${param.key}`}
              inputMode="numeric"
              value={String(values[param.key] ?? '')}
              onChange={(e) => set(param.key, e.target.value)}
            />
          ) : param.kind === 'select' ? (
            <Select id={`ts-${param.key}`} value={String(values[param.key] ?? '')} onChange={(e) => set(param.key, e.target.value)}>
              {(param.options ?? []).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          ) : param.kind === 'checkbox' ? (
            <Checkbox
              id={`ts-${param.key}`}
              label={param.label}
              checked={Boolean(values[param.key])}
              onChange={(e) => set(param.key, e.target.checked)}
            />
          ) : (
            <TextInput id={`ts-${param.key}`} value={String(values[param.key] ?? '')} onChange={(e) => set(param.key, e.target.value)} />
          )}
        </Field>
      ))}
      {error !== '' && <p className="error">{error}</p>}
      <div className="ui-modal-actions" style={{ justifyContent: 'flex-start' }}>
        <Button variant="primary" onClick={save} disabled={busy || !dirty}>
          Save
        </Button>
        {saved && <span className="muted">Saved.</span>}
      </div>
    </section>
  );
}
