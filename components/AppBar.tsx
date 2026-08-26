'use client';

import { Flapper } from '@/components/flapper/Flapper';

/** The signed-in chrome: brand and Docs on the left, always there - whatever
 * the page needs (the account menu, a Dashboard link) on the right. */
export function AppBar({ right }: { right?: React.ReactNode }) {
  return (
    <header className="app-bar">
      <div className="app-bar-left">
        <a className="brand" href="/dashboard" aria-label="Flapper dashboard">
          <Flapper text="FLAPPER" tilePx={22} />
        </a>
        <a className="app-bar-docs" href="/docs">
          Docs
        </a>
      </div>
      <div className="app-bar-right">{right}</div>
    </header>
  );
}
