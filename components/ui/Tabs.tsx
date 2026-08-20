'use client';

import { useState } from 'react';

/** Settings-grade tabs: uncontrolled by default, URL-hash friendly. */
export function Tabs({
  tabs,
  initial,
}: {
  tabs: { id: string; label: React.ReactNode; content: React.ReactNode }[];
  initial?: string;
}) {
  const [active, setActive] = useState(initial ?? tabs[0]?.id);
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];
  return (
    <div className="ui-tabs">
      <div className="ui-tablist" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={tab.id === current.id}
            className={`ui-tab${tab.id === current.id ? ' is-on' : ''}`}
            onClick={() => setActive(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="ui-tabpanel flap-in" key={current.id} role="tabpanel">
        {current.content}
      </div>
    </div>
  );
}
