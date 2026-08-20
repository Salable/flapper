'use client';

import { Flapper } from '@/components/flapper/Flapper';

/** The signed-in chrome: brand on the left, whatever the page needs on the right. */
export function AppBar({ right }: { right?: React.ReactNode }) {
  return (
    <header className="app-bar">
      <a className="brand" href="/dashboard" aria-label="Flapper dashboard">
        <Flapper text="FLAPPER" tilePx={22} />
      </a>
      <div className="app-bar-right">{right}</div>
    </header>
  );
}
