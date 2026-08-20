'use client';

/**
 * Board creation as a choice of type: pick a card, fill that type's params,
 * land in the new board's control room. Everything here is driven by the
 * registry metadata the dashboard's server component serialized - adding a
 * board type adds a card with zero changes to this file.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, TextInput, Select, Checkbox } from '@/components/ui/Field';
import { Chip } from '@/components/ui/bits';

export type TypeMeta = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  capabilities: string[];
  createParams: {
    key: string;
    kind: 'text' | 'number' | 'select' | 'checkbox' | 'message';
    label: string;
    hint?: string;
    default?: unknown;
    min?: number;
    max?: number;
    options?: { value: string; label: string }[];
  }[];
};

export function CreateBoardModal({
  open,
  types,
  onClose,
}: {
  open: boolean;
  types: TypeMeta[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<TypeMeta | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function reset() {
    setPicked(null);
    setValues({});
    setSlug('');
    setError('');
  }

  async function create() {
    if (!picked) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/boards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: picked.id,
          ...(slug.trim() !== '' ? { slug: slug.trim() } : {}),
          ...values,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      router.push(`/b/${body.slug}/settings`);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  const set = (key: string, value: unknown) => setValues((prev) => ({ ...prev, [key]: value }));

  return (
    <Modal
      open={open}
      wide
      title={picked ? `New ${picked.name.toLowerCase()}` : 'What kind of board?'}
      onClose={() => {
        reset();
        onClose();
      }}
    >
      {picked === null ? (
        <div className="type-grid">
          {types.map((type, index) => (
            <button
              key={type.id}
              className="type-card flap-in"
              style={{ '--flap-i': index } as React.CSSProperties}
              onClick={() => setPicked(type)}
            >
              <span className="type-card-name">{type.name}</span>
              <span className="type-card-tagline">{type.tagline}</span>
              <span className="type-card-caps">
                {type.capabilities.map((capability) => (
                  <Chip key={capability}>{capability}</Chip>
                ))}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <p className="ui-hint">{picked.description}</p>
          {picked.createParams.map((param) => (
            <Field key={param.key} label={param.label} hint={param.hint} htmlFor={`cp-${param.key}`}>
              {param.kind === 'number' ? (
                <TextInput
                  id={`cp-${param.key}`}
                  inputMode="numeric"
                  value={String(values[param.key] ?? param.default ?? '')}
                  onChange={(e) => set(param.key, Number(e.target.value))}
                />
              ) : param.kind === 'select' ? (
                <Select
                  id={`cp-${param.key}`}
                  value={String(values[param.key] ?? param.default ?? '')}
                  onChange={(e) => set(param.key, e.target.value)}
                >
                  {(param.options ?? []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              ) : param.kind === 'checkbox' ? (
                <Checkbox
                  id={`cp-${param.key}`}
                  label={param.label}
                  checked={Boolean(values[param.key] ?? param.default ?? false)}
                  onChange={(e) => set(param.key, e.target.checked)}
                />
              ) : (
                <TextInput
                  id={`cp-${param.key}`}
                  value={String(values[param.key] ?? param.default ?? '')}
                  onChange={(e) => set(param.key, e.target.value)}
                />
              )}
            </Field>
          ))}
          <Field
            label="URL slug"
            hint="Optional - leave blank for a generated one like amber-falcon-42."
            htmlFor="cp-slug"
          >
            <TextInput
              id="cp-slug"
              value={slug}
              spellCheck={false}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
            />
          </Field>
          {error !== '' && <p className="error">{error}</p>}
          <div className="ui-modal-actions">
            <Button onClick={reset}>Back</Button>
            <Button variant="primary" onClick={create} disabled={busy}>
              {busy ? 'Creating…' : 'Create board'}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
