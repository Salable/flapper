'use client';

import { useId, useState } from 'react';
import { Button } from './Button';

/** Small pieces that don't earn their own file. */

export function Card({
  className = '',
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`ui-card ${className}`.trim()} {...rest} />;
}

/**
 * `tip`, not `title`: a native title tooltip needs the browser's own hover
 * delay and does not reliably paint (a real hover in a real browser did not
 * show one at all in testing here) - CSS the page controls instead, shown
 * on hover or keyboard focus so it isn't mouse-only. `title` is still set
 * from the same string, as a redundant native fallback, never the only copy.
 */
export function Chip({
  tone = 'neutral',
  className = '',
  tip,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: 'neutral' | 'amber' | 'live' | 'danger'; tip?: string }) {
  const chip = <span className={`ui-chip ui-chip-${tone} ${className}`.trim()} title={tip} {...rest} />;
  const tipId = useId();
  if (!tip) return chip;
  return (
    // aria-describedby, not aria-label: the wrapper's accessible name still
    // has to be the chip's own text ("active", "Sign", ...) - a screen
    // reader user needs that as much as a sighted one does. The tip is a
    // description, so it's added via a real (visually hidden) node the CSS
    // ::after can't stand in for, since generated content is not reliably
    // announced.
    <span className="ui-chip-tip" data-tip={tip} tabIndex={0} aria-describedby={tipId}>
      {chip}
      <span id={tipId} className="sr-only">
        {tip}
      </span>
    </span>
  );
}

export function Segmented({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: { value: string; label: React.ReactNode }[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="ui-segmented" role="group">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          className={`ui-segment${option.value === value ? ' is-on' : ''}`}
          onClick={() => option.value !== value && onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="ui-empty">
      <p className="ui-empty-title">{title}</p>
      {children !== undefined && <p className="ui-hint">{children}</p>}
    </div>
  );
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* value is selectable elsewhere */
        }
      }}
    >
      {copied ? 'Copied' : label}
    </Button>
  );
}

/**
 * A secret behind Reveal / Copy. Uncontrolled by default; pass `shown` +
 * `onToggle` when other text on the page quotes the same secret and should
 * unmask in step (settings' curl and connector lines do).
 */
export function KeyReveal({
  value,
  shown: controlled,
  onToggle,
}: {
  value: string;
  shown?: boolean;
  onToggle?: (shown: boolean) => void;
}) {
  const [own, setOwn] = useState(false);
  const shown = controlled ?? own;
  const toggle = () => {
    setOwn(!shown);
    onToggle?.(!shown);
  };
  return (
    <div className="ui-keyreveal">
      <code className="curl">{shown ? value : '•'.repeat(32)}</code>
      <div className="ui-keyreveal-actions">
        <Button size="sm" onClick={toggle}>
          {shown ? 'Hide' : 'Reveal'}
        </Button>
        <CopyButton value={value} label="Copy key" />
      </div>
    </div>
  );
}
