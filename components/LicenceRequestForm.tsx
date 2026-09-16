'use client';

import { useState } from 'react';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';

/**
 * The other end of a 402.
 *
 * Three questions, because three is what a bespoke plan needs: what you hit,
 * what you need it for, and where to reach you. `need` arrives already
 * chosen - from the refusal that sent you here - so the common case is one
 * box and a button.
 *
 * Thin on purpose (AGENTS.md: keep the components thin). The closed list of
 * things that can be asked for is lib/salable/licence.mjs REQUESTABLE, handed
 * down from the server; the validation that matters is in requestLicence.
 */
export function LicenceRequestForm({
  requestable,
  need: initialNeed,
  accountEmail,
  onSent,
}: {
  requestable: Record<string, string>;
  need?: string;
  accountEmail: string;
  onSent?: () => void;
}) {
  const options = Object.entries(requestable);
  const [need, setNeed] = useState(initialNeed && isRequestable(requestable, initialNeed) ? initialNeed : options[0][0]);
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/licence-requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ need, message: message.trim(), ...(contact.trim() !== '' ? { contact: contact.trim() } : {}) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setSent(body.message);
      setMessage('');
      onSent?.();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (sent !== '') {
    return (
      <p className="ui-hint" role="status">
        {sent}
      </p>
    );
  }

  return (
    <form className="licence-ask" onSubmit={submit}>
      <Field label="What do you need?" htmlFor="ask-need">
        <Select id="ask-need" value={need} onChange={(e) => setNeed(e.target.value)}>
          {options.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="What for?"
        hint="What you are putting on the wall, and roughly how much of it. This is what we price against, so plain and specific beats formal."
        htmlFor="ask-message"
      >
        <TextArea
          id="ask-message"
          rows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={2000}
        />
      </Field>
      <Field label="Reply to" hint={`Blank and we use ${accountEmail}.`} htmlFor="ask-contact">
        <TextInput
          id="ask-contact"
          value={contact}
          spellCheck={false}
          maxLength={200}
          onChange={(e) => setContact(e.target.value)}
        />
      </Field>
      {error !== '' && <p className="error">{error}</p>}
      <Button type="submit" variant="primary" disabled={busy || message.trim() === ''}>
        {busy ? 'Sending…' : 'Send it'}
      </Button>
    </form>
  );
}

/** A `need` from a URL is a stranger's string until the list says otherwise. */
function isRequestable(requestable: Record<string, string>, need: string) {
  return Object.hasOwn(requestable, need);
}
