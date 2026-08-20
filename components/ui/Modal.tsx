'use client';

import { useEffect, useRef } from 'react';

/**
 * A modal that arrives like a flap: half-flip in, backdrop dims the room.
 * Esc and backdrop-click close it; focus moves inside on open.
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

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

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
