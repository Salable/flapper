'use client';

import { useState } from 'react';
import { Button } from './Button';

/** Small pieces that don't earn their own file. */

export function Card({
  className = '',
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`ui-card ${className}`.trim()} {...rest} />;
}

export function Chip({
  tone = 'neutral',
  className = '',
  ...rest
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: 'neutral' | 'amber' | 'live' | 'danger' }) {
  return <span className={`ui-chip ui-chip-${tone} ${className}`.trim()} {...rest} />;
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
