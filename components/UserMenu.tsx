'use client';

import { useEffect, useRef, useState } from 'react';
import { signOut } from '@/lib/auth-client';

/**
 * The signed-in person's corner of the AppBar - one dropdown, right-aligned,
 * rather than the name and Sign out sitting as separate things in the bar.
 * Docs lives permanently by the logo instead (AppBar itself), not in here -
 * every signed-in page renders this same component, so they all agree on
 * what the global nav is.
 */
export function UserMenu({ userName, current }: { userName: string; current?: 'dashboard' | 'account' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    // mousedown, not click: closes before whatever the click also targets
    // reacts to it, so a click just outside the panel never both closes the
    // menu and fires whatever was sitting underneath.
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        type="button"
        className="user-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="user-menu-name">{userName}</span>
        <span className="user-menu-chevron" aria-hidden="true">
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <div className="user-menu-panel" role="menu">
          {current === 'account' ? (
            <a className="user-menu-item" role="menuitem" href="/dashboard" onClick={() => setOpen(false)}>
              Dashboard
            </a>
          ) : (
            <a className="user-menu-item" role="menuitem" href="/account" onClick={() => setOpen(false)}>
              Account
            </a>
          )}
          <button
            type="button"
            className="user-menu-item"
            role="menuitem"
            onClick={async () => {
              await signOut();
              // Full navigation: nothing of this account may linger in the
              // router cache for the next person to sign in.
              window.location.assign('/');
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
