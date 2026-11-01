import { useState } from 'react';
import { getWorkspaceApi, store, useAppState } from '@/state/store';
import { resolveDiscardConfirmation } from '@/state/discardGuard';
import { Modal } from './common';

interface Props {
  onClose: () => void;
}

/** Asks Save / Discard / Cancel before New, Open and project drops. */
export function DiscardChangesDialog({ onClose }: Props) {
  const state = useAppState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = (ok: boolean) => {
    resolveDiscardConfirmation(ok);
    onClose();
  };

  const save = async () => {
    const ws = getWorkspaceApi();
    if (!ws) return finish(false);
    setBusy(true);
    setError(null);
    try {
      await ws.saveDocument();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
    // Cancelling the native save dialog leaves the document dirty: keep the
    // confirmation open so the user can pick Discard or Cancel instead.
    if (!store.getState().dirty) finish(true);
  };

  return (
    <Modal
      title="Unsaved Changes"
      onClose={() => finish(false)}
      width={430}
      footer={
        <>
          <button type="button" className="btn" disabled={busy} onClick={() => finish(false)}>
            Cancel
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => finish(true)}>
            Discard
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        Save changes to <strong>{state.doc.meta.name || 'Untitled'}</strong> before continuing?
      </p>
      <p className="hint" style={{ marginBottom: 0 }}>
        If you discard, the current design will be replaced.
      </p>
      {error && <div className="update-error">{error}</div>}
    </Modal>
  );
}
