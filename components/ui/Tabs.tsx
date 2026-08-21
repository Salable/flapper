'use client';

import { useRef, useState } from 'react';

/**
 * Settings-grade tabs: uncontrolled by default, URL-hash friendly.
 *
 * `orientation="vertical"` lays the tablist out as a left-hand menu beside
 * the panel, with `before` and `after` slots in the same column for things
 * that belong with the nav but are not tabs - a board's identity above, its
 * standing links below. Same roles either way (tablist / tab / tabpanel),
 * `aria-orientation` set, and the arrow keys that match the axis move focus
 * and selection together; Home/End jump. Per docs/DESIGN-SYSTEM.md nothing
 * here keys an effect on a callback prop.
 */
export function Tabs({
  tabs,
  initial,
  orientation = 'horizontal',
  before,
  after,
}: {
  tabs: { id: string; label: React.ReactNode; content: React.ReactNode }[];
  initial?: string;
  orientation?: 'horizontal' | 'vertical';
  before?: React.ReactNode;
  after?: React.ReactNode;
}) {
  const [active, setActive] = useState(initial ?? tabs[0]?.id);
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const vertical = orientation === 'vertical';

  const focusAndSelect = (index: number) => {
    const wrapped = (index + tabs.length) % tabs.length;
    setActive(tabs[wrapped].id);
    buttons.current[wrapped]?.focus();
  };
  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const next = vertical ? 'ArrowDown' : 'ArrowRight';
    const prev = vertical ? 'ArrowUp' : 'ArrowLeft';
    if (event.key === next) focusAndSelect(index + 1);
    else if (event.key === prev) focusAndSelect(index - 1);
    else if (event.key === 'Home') focusAndSelect(0);
    else if (event.key === 'End') focusAndSelect(tabs.length - 1);
    else return;
    event.preventDefault();
  };

  const tablist = (
    <div className="ui-tablist" role="tablist" aria-orientation={orientation}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={(el) => {
            buttons.current[index] = el;
          }}
          role="tab"
          id={`tab-${tab.id}`}
          aria-selected={tab.id === current.id}
          aria-controls={`tabpanel-${tab.id}`}
          tabIndex={tab.id === current.id ? 0 : -1}
          className={`ui-tab${tab.id === current.id ? ' is-on' : ''}`}
          onClick={() => setActive(tab.id)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
  const panel = (
    <div
      className="ui-tabpanel flap-in"
      key={current.id}
      role="tabpanel"
      id={`tabpanel-${current.id}`}
      aria-labelledby={`tab-${current.id}`}
    >
      {current.content}
    </div>
  );

  if (!vertical) {
    return (
      <div className="ui-tabs">
        {tablist}
        {panel}
      </div>
    );
  }
  return (
    <div className="ui-tabs ui-tabs-vertical">
      <div className="ui-tabs-side">
        {before}
        {tablist}
        {after}
      </div>
      {panel}
    </div>
  );
}
