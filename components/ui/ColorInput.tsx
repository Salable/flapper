'use client';

/**
 * A colour as a theme pack holds it: any CSS colour string - hex, rgba(),
 * `transparent` - or, for fields that allow it, none. The text is the truth
 * (raw while typing, committed on blur or Enter once it parses); the native
 * picker is a second way to write a `#rrggbb`; the swatch shows whatever
 * the committed value really is.
 */

import { useEffect, useRef, useState } from 'react';
import { isColor } from '@/lib/board/theme-pack.mjs';

export function ColorInput({
  id,
  value,
  onChange,
  allowNone = false,
  noneLabel = 'None',
}: {
  id?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  /** Whether the field may be unset (a stroke, a highlight). */
  allowNone?: boolean;
  noneLabel?: string;
}) {
  const [text, setText] = useState(value ?? '');
  const [bad, setBad] = useState(false);
  // Callbacks live in a ref: identity is never behavioural (docs/DESIGN-SYSTEM.md).
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Follow the committed value when it changes from outside (a preset switch, a reset).
  useEffect(() => {
    setText(value ?? '');
    setBad(false);
  }, [value]);

  const commit = () => {
    const trimmed = text.trim();
    if (trimmed === '' && allowNone) {
      setBad(false);
      if (value !== null) onChangeRef.current(null);
      return;
    }
    if (!isColor(trimmed)) {
      setBad(true);
      return;
    }
    setBad(false);
    if (trimmed !== value) onChangeRef.current(trimmed);
  };

  const hex = /^#[0-9a-f]{6}$/i.test(value ?? '') ? (value as string) : '#000000';
  return (
    <span className={`ui-color${bad ? ' is-bad' : ''}`}>
      <span className="ui-color-swatch" style={{ background: value ?? 'transparent' }} aria-hidden />
      <input
        type="color"
        className="ui-color-picker"
        value={hex}
        aria-label="Pick a colour"
        onChange={(event) => {
          setText(event.target.value);
          setBad(false);
          onChangeRef.current(event.target.value);
        }}
      />
      <input
        id={id}
        type="text"
        className="ui-input ui-color-text"
        value={text}
        placeholder={allowNone ? noneLabel : '#rrggbb'}
        spellCheck={false}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
      />
      {allowNone && value !== null && (
        <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => onChangeRef.current(null)}>
          {noneLabel}
        </button>
      )}
    </span>
  );
}
