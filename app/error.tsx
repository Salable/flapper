'use client';

import { Button, LinkButton } from '@/components/ui/Button';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="landing">
      <h1>FLAPPER</h1>
      <p>Something jammed mid-flip.</p>
      <p className="muted">The error is on our side. Try again; if it persists, reload the page.</p>
      <div className="actions">
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
        <LinkButton href="/dashboard">Your dashboard</LinkButton>
      </div>
    </main>
  );
}
