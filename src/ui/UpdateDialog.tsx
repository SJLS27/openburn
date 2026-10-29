import { useState, type ReactNode } from 'react';
import { Modal } from './common';
import { Icon } from './icons';
import {
  checkForUpdates,
  installUpdate,
  useUpdateState,
} from '@/state/updateStore';

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
}

function Progress({ percent }: { percent?: number }) {
  const value = Math.max(0, Math.min(100, percent ?? 0));
  return (
    <div className="progress update-progress">
      <div style={{ width: `${value}%` }} />
    </div>
  );
}

/**
 * Inline strip shown under the toolbars whenever an update is available,
 * downloading, or ready to install. Hidden for every other status.
 */
export function UpdateBanner({ onOpen }: { onOpen: () => void }) {
  const state = useUpdateState();
  const [busy, setBusy] = useState(false);

  if (
    state.status !== 'available' &&
    state.status !== 'downloading' &&
    state.status !== 'downloaded'
  ) {
    return null;
  }

  const restart = async () => {
    setBusy(true);
    try {
      await installUpdate();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="update-banner">
      <Icon name="download" size={14} className="update-icon" />
      <span className="update-text">
        {state.status === 'downloaded' ? (
          <>
            OpenBurn <strong>{state.version}</strong> is ready to install.
          </>
        ) : state.status === 'downloading' ? (
          <>
            Downloading OpenBurn <strong>{state.version}</strong>…{' '}
            {Math.round(state.percent ?? 0)}%
            {formatBytes(state.bytesPerSecond) && (
              <span className="hint"> · {formatBytes(state.bytesPerSecond)}/s</span>
            )}
          </>
        ) : (
          <>
            OpenBurn <strong>{state.version}</strong> is available — starting download…
          </>
        )}
      </span>

      {(state.status === 'downloading' || state.status === 'available') && (
        <Progress percent={state.percent} />
      )}

      <span className="grow" />

      {state.status === 'downloaded' ? (
        <>
          <button type="button" className="btn primary" disabled={busy} onClick={restart}>
            Restart &amp; install
          </button>
          <button type="button" className="btn" onClick={onOpen}>
            Details
          </button>
        </>
      ) : (
        <button type="button" className="btn" onClick={onOpen}>
          Details
        </button>
      )}
    </div>
  );
}

/** Modal used for manual checks (Help → Check for Updates). */
export function UpdateDialog({ onClose }: { onClose: () => void }) {
  const state = useUpdateState();
  const [busy, setBusy] = useState(false);

  const retry = async () => {
    setBusy(true);
    try {
      await checkForUpdates(true);
    } finally {
      setBusy(false);
    }
  };

  const restart = async () => {
    setBusy(true);
    try {
      await installUpdate();
    } finally {
      setBusy(false);
    }
  };

  let body: ReactNode;
  switch (state.status) {
    case 'checking':
      body = (
        <p className="hint" style={{ margin: 0 }}>
          Checking for updates…
        </p>
      );
      break;
    case 'available':
      body = (
        <>
          <p style={{ marginTop: 0 }}>
            OpenBurn <strong>{state.version}</strong> is available. It is downloading in the
            background.
          </p>
          <Progress percent={0} />
          {state.releaseNotes && (
            <div className="update-notes">{state.releaseNotes}</div>
          )}
        </>
      );
      break;
    case 'downloading':
      body = (
        <>
          <p style={{ marginTop: 0 }}>
            Downloading OpenBurn <strong>{state.version}</strong>…{' '}
            {Math.round(state.percent ?? 0)}%
          </p>
          <Progress percent={state.percent} />
          <p className="hint" style={{ marginBottom: 0 }}>
            {formatBytes(state.transferred)}
            {state.total ? ` of ${formatBytes(state.total)}` : ''}
            {formatBytes(state.bytesPerSecond)
              ? ` · ${formatBytes(state.bytesPerSecond)}/s`
              : ''}
          </p>
        </>
      );
      break;
    case 'downloaded':
      body = (
        <>
          <p style={{ marginTop: 0 }}>
            OpenBurn <strong>{state.version}</strong> has been downloaded and is ready to
            install.
          </p>
          <p className="hint" style={{ marginBottom: 0 }}>
            The app will close and reopen to finish the update.
          </p>
          {state.releaseNotes && (
            <div className="update-notes">{state.releaseNotes}</div>
          )}
        </>
      );
      break;
    case 'not-available':
      body = (
        <p className="hint" style={{ margin: 0 }}>
          You are up to date. OpenBurn {state.currentVersion} is the latest version.
        </p>
      );
      break;
    case 'disabled':
      body = (
        <p className="hint" style={{ margin: 0 }}>
          {state.message ??
            'Automatic updates are not available in this build.'}
        </p>
      );
      break;
    case 'error':
      body = (
        <>
          <p style={{ marginTop: 0 }}>The update check failed.</p>
          {state.message && <div className="update-error">{state.message}</div>}
        </>
      );
      break;
    default:
      body = (
        <p className="hint" style={{ margin: 0 }}>
          Automatic updates keep OpenBurn current with the latest fixes and features.
        </p>
      );
  }

  return (
    <Modal
      title="Software Update"
      onClose={onClose}
      width={460}
      footer={
        <>
          <span className="hint grow" style={{ marginRight: 'auto' }}>
            Current version: {state.currentVersion}
          </span>
          {state.status === 'error' && (
            <button type="button" className="btn" disabled={busy} onClick={retry}>
              Try again
            </button>
          )}
          {state.status === 'downloaded' && (
            <button type="button" className="btn primary" disabled={busy} onClick={restart}>
              Restart &amp; install
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      {body}
    </Modal>
  );
}
