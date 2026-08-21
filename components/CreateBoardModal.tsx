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
import { Flapper } from '@/components/flapper/Flapper';

export type TypeMeta = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  /** Outcome labels - what you get, not how it works. */
  capabilities: string[];
  /** A line for the card's live preview. */
  sample?: string;
  /** The default for most walls; marked on the card. */
  recommended?: boolean;
  /** Named when the type is locked behind an account tier. */
  tier?: string;
  createParams: {
    key: string;
    kind: 'text' | 'number' | 'select' | 'checkbox' | 'message';
    label: string;
    hint?: string;
    default?: unknown;
    required?: boolean;
    /** Not asked at creation; the default applies and Settings → General edits it. */
    advanced?: boolean;
    min?: number;
    max?: number;
    options?: { value: string; label: string }[];
  }[];
};

/** Creation asks for the minimum: a name, and what the type genuinely needs. */
export function creationParams(type: TypeMeta) {
  return type.createParams.filter((param) => !param.advanced);
}

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

  const nameValue = String(values.name ?? '').trim();
  const nameMissing = Boolean(picked?.createParams.some((param) => param.key === 'name')) && nameValue === '';

  async function create() {
    if (!picked) return;
    if (nameMissing) {
      setError('Give the board a name - it is how you will tell it apart on the dashboard.');
      return;
    }
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
      title={picked ? `New ${picked.name.toLowerCase()}` : 'Choose a board'}
      onClose={() => {
        reset();
        onClose();
      }}
    >
      {picked === null ? (
        <>
          <p className="ui-hint">
            A live queue suits most walls. Pick a clock type for anything on a timetable - a live
            board cannot be given a schedule later.
          </p>
          <div className="type-grid">
            {types.map((type, index) => (
              <button
                key={type.id}
                className={`type-card flap-in${type.recommended ? ' is-recommended' : ''}`}
                style={{ '--flap-i': index } as React.CSSProperties}
                onClick={() => setPicked(type)}
                aria-label={`${type.name}${type.recommended ? ', recommended' : ''}. ${type.tagline}`}
              >
                {/* The real engine, small: every listing shows itself flipping. */}
                <span className="type-card-preview" aria-hidden="true">
                  <Flapper text={type.sample ?? type.name} tilePx={15} ambient={false} />
                </span>
                <span className="type-card-head">
                  <span className="type-card-name">{type.name}</span>
                  {type.recommended && <Chip tone="amber">Start here</Chip>}
                  {type.tier && <Chip>{type.tier}</Chip>}
                </span>
                <span className="type-card-tagline">{type.tagline}</span>
                <span className="type-card-caps">
                  {type.capabilities.map((capability) => (
                    <span key={capability} className="type-card-cap">
                      {capability}
                    </span>
                  ))}
                </span>
              </button>
            ))}
          </div>
          {/* Escape and the backdrop close this too, but a visible way out
              should not be something you have to know. */}
          <div className="ui-modal-actions">
            <Button
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="ui-hint">{picked.description}</p>
          {creationParams(picked).map((param) => (
            <Field
              key={param.key}
              label={param.key === 'name' ? `${param.label} (required)` : param.label}
              hint={param.hint}
              htmlFor={`cp-${param.key}`}
            >
              {param.kind === 'number' ? (
                // Raw string while typing - the server coerces and validates,
                // so a half-typed value never echoes back as NaN or 0.
                <TextInput
                  id={`cp-${param.key}`}
                  inputMode="numeric"
                  value={String(values[param.key] ?? param.default ?? '')}
                  onChange={(e) => set(param.key, e.target.value)}
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
                  {...(param.key === 'name'
                    ? { placeholder: 'Lobby, Departures, Build status…', required: true, autoFocus: true }
                    : {})}
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
            <Button variant="primary" onClick={create} disabled={busy || nameMissing}>
              {busy ? 'Creating…' : 'Create board'}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
