'use client';

/** The signed-in chrome: brand on the left, whatever the page needs on the right. */
export function AppBar({ right }: { right?: React.ReactNode }) {
  return (
    <header className="app-bar">
      <a className="brand" href="/dashboard">
        FLAPPER
      </a>
      <div className="app-bar-right">{right}</div>
    </header>
  );
}
