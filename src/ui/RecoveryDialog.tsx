import { Modal } from './common';

interface Props {
  record: OpenBurnAutosaveRecord;
  busy?: boolean;
  onRecover: () => void;
  onDiscard: () => void;
}

function formatSavedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'an earlier session';
  return date.toLocaleString();
}

/** Offered on launch when a draft from an interrupted session exists. */
export function RecoveryDialog({ record, busy, onRecover, onDiscard }: Props) {
  const fileName = record.filePath?.split(/[\\/]/).pop();

  return (
    <Modal
      title="Recover Unsaved Work"
      onClose={onDiscard}
      width={440}
      footer={
        <>
          <button type="button" className="btn" disabled={busy} onClick={onDiscard}>
            Discard
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={onRecover}
          >
            Recover
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        OpenBurn closed before saving your last changes. A backup was found from{' '}
        <strong>{formatSavedAt(record.savedAt)}</strong>
        {fileName ? (
          <>
            {' '}
            for <strong>{fileName}</strong>
          </>
        ) : null}
        .
      </p>
      <p className="hint" style={{ marginBottom: 0 }}>
        Recover restores the design as unsaved changes; discarding removes the backup.
      </p>
    </Modal>
  );
}
