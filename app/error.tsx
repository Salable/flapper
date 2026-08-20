'use client';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="landing">
      <h1>FLAPPER</h1>
      <p>Something jammed mid-flip.</p>
      <p className="muted">The error is on our side. Try again; if it persists, reload the page.</p>
      <div className="actions">
        <button className="primary" onClick={reset}>Try again</button>
        <a className="button" href="/dashboard">Your dashboard</a>
      </div>
    </main>
  );
}
