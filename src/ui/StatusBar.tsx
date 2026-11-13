import { useEffect, useRef, useState } from 'react';
import { store, useAppState } from '@/state/store';
import { useMachine } from '@/serial/machine';
import { defaultGridSize, mmToDisplay } from '@/core/units';
import type { Units } from '@/types/document';
import { DEFAULT_SNAP_RADIUS_PX, type SnapKind } from '@/workspace/snap';
import { Icon } from './icons';

export const SNAP_RADIUS_OPTIONS = [4, 6, 8, 12, 16];

/** Human label for the active snap kind in the status bar. */
export function snapKindLabel(kind: SnapKind): string {
  switch (kind) {
    case 'vertex':
      return 'Vertex';
    case 'center':
      return 'Centre';
    case 'midpoint':
      return 'Midpoint';
    case 'intersection':
      return 'Intersection';
    case 'guide':
      return 'Guide';
    case 'grid':
    default:
      return 'Grid';
  }
}

/** Which kinds of snap are active, for the badge title and tests. */
export function snapSummary(
  enabled: boolean,
  kinds: { grid: boolean; objects: boolean; intersections: boolean },
): string {
  if (!enabled) return 'Snapping off';
  const parts: string[] = [];
  if (kinds.grid) parts.push('grid');
  if (kinds.objects) parts.push('objects');
  if (kinds.objects && kinds.intersections) parts.push('intersections');
  return parts.length ? `Snap: ${parts.join(', ')}` : 'Snap: nothing enabled';
}

/**
 * Snap button + options popover. The main button toggles snapping (keeping the
 * old one-click behaviour); the caret or a right-click opens the options.
 */
function SnapControls() {
  const state = useAppState();
  const settings = state.snapSettings;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [open]);

  const summary = snapSummary(settings.enabled, settings);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className="status-item badge"
        title={`${summary} (click to toggle, ▾ for options)`}
        aria-pressed={settings.enabled}
        onClick={() => store.toggleSnap()}
        onContextMenu={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        style={{ background: settings.enabled ? '#7a4a20' : '#3a3d42', borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
      >
        <Icon name="snap" size={11} /> Snap
      </button>
      <button
        type="button"
        className="status-item badge"
        title="Snap settings"
        aria-label="Snap settings"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          background: settings.enabled ? '#7a4a20' : '#3a3d42',
          borderTopLeftRadius: 0,
          borderBottomLeftRadius: 0,
          paddingLeft: 2,
          paddingRight: 2,
        }}
      >
        ▾
      </button>
      {open && (
        <div
          className="snap-popover"
          role="dialog"
          aria-label="Snap settings"
          style={{
            position: 'absolute',
            bottom: 22,
            right: 0,
            zIndex: 40,
            minWidth: 196,
            padding: '8px 10px',
            background: 'var(--panel, #26282c)',
            border: '1px solid var(--border, #3a3d42)',
            borderRadius: 4,
            boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
            fontSize: 11,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <label className="checkbox" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => store.setSnapSettings({ enabled: e.target.checked })}
            />
            Enable snapping
          </label>
          <label className="checkbox" style={{ display: 'flex', gap: 6, alignItems: 'center', opacity: settings.enabled ? 1 : 0.55 }}>
            <input type="checkbox" checked={settings.grid} onChange={(e) => store.setSnapSettings({ grid: e.target.checked })} />
            Grid
          </label>
          <label className="checkbox" style={{ display: 'flex', gap: 6, alignItems: 'center', opacity: settings.enabled ? 1 : 0.55 }}>
            <input type="checkbox" checked={settings.objects} onChange={(e) => store.setSnapSettings({ objects: e.target.checked })} />
            Objects (vertices, centres)
          </label>
          <label
            className="checkbox"
            style={{ display: 'flex', gap: 6, alignItems: 'center', opacity: settings.enabled && settings.objects ? 1 : 0.55 }}
          >
            <input
              type="checkbox"
              checked={settings.intersections}
              onChange={(e) => store.setSnapSettings({ intersections: e.target.checked })}
            />
            Intersections
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'space-between' }}>
            Capture
            <select
              className="status-item badge"
              aria-label="Snap radius"
              value={settings.radiusPx}
              onChange={(e) => store.setSnapSettings({ radiusPx: Number(e.target.value) })}
              style={{ border: 'none', outline: 'none', height: 18 }}
            >
              {SNAP_RADIUS_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r === DEFAULT_SNAP_RADIUS_PX ? `${r} px (default)` : `${r} px`}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

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

      {state.snapHint && (
        <span className="status-item" title="Active snap" data-testid="snap-hint">
          <Icon name="snap" size={11} /> {snapKindLabel(state.snapHint.kind)}
        </span>
      )}

      <button
        type="button"
        className={`status-item badge`}
        title="Toggle grid"
        onClick={() => store.setState({ showGrid: !state.showGrid })}
        style={{ background: state.showGrid ? '#4a4e55' : '#3a3d42' }}
      >
        <Icon name="grid" size={11} /> Grid
      </button>

      <SnapControls />

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
