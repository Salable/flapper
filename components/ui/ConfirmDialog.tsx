'use client';

import { useState, useCallback } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';

type Ask = {
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
};

/**
 * The house replacement for window.confirm: same one-liner ergonomics,
 * Flapper's own presentation.
 *
 *   const { confirm, dialog } = useConfirm();
 *   ...
 *   if (await confirm({ title: 'Delete this board?', danger: true })) ...
 *   ...render {dialog} once at the root of the component.
 */
export function useConfirm() {
  const [state, setState] = useState<(Ask & { resolve: (ok: boolean) => void }) | null>(null);

  const confirm = useCallback(
    (ask: Ask) =>
      new Promise<boolean>((resolve) => {
        setState({ ...ask, resolve });
      }),
    [],
  );

  const settle = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };

  const dialog = (
    <Modal open={state !== null} title={state?.title} onClose={() => settle(false)}>
      {state?.body !== undefined && <div className="ui-modal-body">{state.body}</div>}
      <div className="ui-modal-actions">
        <Button onClick={() => settle(false)}>Cancel</Button>
        <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => settle(true)} autoFocus>
          {state?.confirmLabel ?? 'Confirm'}
        </Button>
      </div>
    </Modal>
  );

  return { confirm, dialog };
}
