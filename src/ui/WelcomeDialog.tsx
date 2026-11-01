import { useRecentFiles } from '@/state/recentStore';
import { requestDiscardConfirmation } from '@/state/discardGuard';
import { Modal, useWorkspace } from './common';

interface Props {
  onClose: () => void;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString();
}

function folderOf(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  parts.pop();
  return parts.slice(-2).join('/');
}

/** Lightweight start screen shown when the app launches without a document. */
export function WelcomeDialog({ onClose }: Props) {
  const ws = useWorkspace();
  const recent = useRecentFiles();

  const newDesign = async () => {
    if (!(await requestDiscardConfirmation())) return;
    ws?.newDocument();
    onClose();
  };

  const open = async () => {
    if (!(await requestDiscardConfirmation())) return;
    await ws?.openDocument();
    onClose();
  };

  const openRecent = async (filePath: string) => {
    if (!(await requestDiscardConfirmation())) return;
    await ws?.openPath(filePath);
    onClose();
  };

  return (
    <Modal
      title="Welcome to OpenBurn"
      onClose={onClose}
      width={520}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <p className="hint" style={{ marginTop: 0 }}>
        Design a laser job, preview the toolpath and send it to a GRBL machine.
      </p>

      <div className="welcome-actions">
        <button type="button" className="btn primary" onClick={() => void newDesign()}>
          New Design
        </button>
        <button type="button" className="btn" onClick={() => void open()}>
          Open Project…
        </button>
      </div>

      <h4 style={{ margin: '18px 0 8px' }}>Recent Files</h4>
      {recent.length === 0 ? (
        <p className="hint" style={{ margin: 0 }}>
          Projects you open or save will show up here.
        </p>
      ) : (
        <ul className="recent-list">
          {recent.map((file) => (
            <li key={file.path}>
              <button
                type="button"
                className="recent-item"
                title={file.path}
                onClick={() => void openRecent(file.path)}
              >
                <span className="recent-name">{file.name}</span>
                <span className="recent-meta">
                  {folderOf(file.path)} · {formatDate(file.openedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
