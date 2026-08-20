'use client';

import { MiniBoard } from '@/components/ui/MiniBoard';

/** The signed-in chrome: brand on the left, whatever the page needs on the right. */
export function AppBar({ right }: { right?: React.ReactNode }) {
  return (
    <header className="app-bar">
      <a className="brand" href="/dashboard" aria-label="Flapper dashboard">
        <MiniBoard text="FLAPPER" size="sm" />
      </a>
      <div className="app-bar-right">{right}</div>
    </header>
  );
}
