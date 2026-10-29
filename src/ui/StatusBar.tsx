import { store, useAppState } from '@/state/store';
import { useMachine } from '@/serial/machine';
import { defaultGridSize, mmToDisplay } from '@/core/units';
import type { Units } from '@/types/document';
import { Icon } from './icons';

export function StatusBar() {
  const state = useAppState();
  const machine = useMachine();
  const units = state.doc.units;
  const cursor = state.cursor;
  const sel = state.selection;

  return (
    <div className="statusbar">
      <span className="status-item" style={{ minWidth: 210 }}>
        {state.statusText}
      </span>

      {machine.connected && (
        <span className="status-item" title={`${machine.transportName} — ${machine.status}`}>
          <span className={`badge-dot ${machine.status === 'alarm' || machine.status === 'door' ? 'error' : machine.status === 'idle' ? 'ok' : 'run'}`} />
          {machine.status}
        </span>
      )}

      {machine.jobActive && (
        <span className="status-item" title="Job progress">
          <span className="progress" style={{ display: 'inline-block', width: 74, height: 6 }}>
            <span
              style={{ display: 'block', height: '100%', width: `${machine.progress * 100}%`, background: 'var(--accent)' }}
            />
          </span>
          <span>{Math.round(machine.progress * 100)}%</span>
          <span style={{ color: machine.jobPaused ? 'var(--yellow)' : 'var(--text-faint)' }}>
            {machine.jobPaused ? 'paused' : `${Math.round(machine.remaining)}s left`}
          </span>
        </span>
      )}

      <span className="status-item" title="Pointer position">
        <Icon name="move" size={12} />
        {cursor
          ? `${mmToDisplay(cursor.x, units).toFixed(2)}, ${mmToDisplay(cursor.y, units).toFixed(2)} ${units}`
          : `—, — ${units}`}
      </span>

      <span className="status-item">
        <Icon name="shape" size={12} />
        {sel ? `${sel.count} selected` : 'No selection'}
      </span>

      <span className="grow" />

      <button
        type="button"
        className={`status-item badge`}
        title="Toggle grid"
        onClick={() => store.setState({ showGrid: !state.showGrid })}
        style={{ background: state.showGrid ? '#4a4e55' : '#3a3d42' }}
      >
        <Icon name="grid" size={11} /> Grid
      </button>

      <button
        type="button"
        className={`status-item badge`}
        title="Snap to grid"
        onClick={() => store.setState({ snapToGrid: !state.snapToGrid })}
        style={{ background: state.snapToGrid ? '#7a4a20' : '#3a3d42' }}
      >
        <Icon name="snap" size={11} /> Snap
      </button>

      <span className="status-item" title="Grid spacing">
        {mmToDisplay(state.gridSize, units).toFixed(units === 'mm' ? 0 : 2)} {units}
      </span>

      <span className="status-item" title="Zoom">
        {(state.zoom * 100).toFixed(0)}%
      </span>

      <select
        className="status-item badge"
        style={{ border: 'none', outline: 'none', cursor: 'pointer', height: 18 }}
        value={units}
        title="Document units"
        onChange={(e) => {
          const next = e.target.value as Units;
          store.setUnits(next);
          store.setState({ gridSize: defaultGridSize(next) });
        }}
      >
        <option value="mm">mm</option>
        <option value="in">inch</option>
      </select>

      <span className="status-item" style={{ color: 'var(--text-faint)' }}>
        OpenBurn {__APP_VERSION__}
      </span>
    </div>
  );
}
