'use client';

import { useEffect, useRef } from 'react';

/**
 * A modal that arrives like a flap: half-flip in, backdrop dims the room.
 * Esc and backdrop-click close it; focus moves inside on open.
 *
 * Callers pass inline closures for onClose - that is the natural way to use
 * it - so the identity of onClose must never be behavioral. It lives in a
 * ref, and the focus/keydown effect runs only on the open transition: the
 * original sin here was depending on onClose, which re-ran the effect (and
 * re-focused the panel) on every parent render - stealing focus from an
 * input on every keystroke.
 */
export function Modal({
  open,
  title,
  wide = false,
  onClose,
  children,
}: {
  open: boolean;
  title?: React.ReactNode;
  wide?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    // Move focus in - unless something inside (an autoFocus button, an
    // input) already took it; the panel must never win focus from a child.
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  return (
    <div className="ui-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`ui-modal flap-in${wide ? ' ui-modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        ref={panelRef}
      >
        {title !== undefined && <h2 className="ui-modal-title">{title}</h2>}
        {children}
      </div>
    </div>
  );
}
