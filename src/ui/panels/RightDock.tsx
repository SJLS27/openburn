import { useEffect, useRef, useState } from 'react';
import { store, useAppState } from '@/state/store';
import { PALETTE_COLORS, type LayerDef } from '@/types/document';
import { machine, useMachine, type MachineStatus } from '@/serial/machine';
import { formatDuration } from '@/gcode/types';
import { OptimizationDialog } from './OptimizationDialog';
import { Icon } from '../icons';
import { Field, Modal, NumberField, Panel, ToolButton, useUnits, useWorkspace } from '../common';
import { CutsLayersPanel } from './CutsLayersPanel';
import {
  MATERIALS_UPDATED_EVENT,
  loadMaterials,
  materialFromLayer,
  saveMaterials,
  type MaterialEntry,
} from '@/core/materials';

export function RightDock() {
  return (
    <div className="right-dock">
      <div className="right-dock-scroll">
        <CutsLayersPanel />
        <ShapePropertiesPanel />
        <ColorPalettePanel />
        <MaterialPanel />
        <LaserPanel />
        <MovePanel />
      </div>
      <BottomTabs />
    </div>
  );
}

function ShapePropertiesPanel() {
  const state = useAppState();
  const units = useUnits();
  const ws = useWorkspace();
  const sel = state.selection;
  const activeLayer = state.doc.layers.find((l) => l.id === state.activeLayerId);

  return (
    <div id="panel-shape">
      <Panel title="Shape Properties">
        {!sel ? (
          <p className="hint">Select one or more shapes to edit their properties.</p>
        ) : (
          <>
            <div className="grid-2">
              <Field label="X">
                <NumberField value={sel.x} onChange={(v) => ws?.applyNumeric({ x: v })} units={units} />
              </Field>
              <Field label="Y">
                <NumberField value={sel.y} onChange={(v) => ws?.applyNumeric({ y: v })} units={units} />
              </Field>
              <Field label="W">
                <NumberField value={sel.width} onChange={(v) => ws?.applyNumeric({ width: v })} units={units} />
              </Field>
              <Field label="H">
                <NumberField value={sel.height} onChange={(v) => ws?.applyNumeric({ height: v })} units={units} />
              </Field>
            </div>
            <Field label="Angle">
              <NumberField
                value={sel.angle}
                onChange={(v) => ws?.applyNumeric({ angle: v })}
                units="mm"
                decimals={1}
              />
              <span className="hint">°</span>
            </Field>
            {state.device.zAxisEnabled && (
              <Field label="Z offset">
                <NumberField
                  value={sel.zOffset}
                  onChange={(v) => ws?.setSelectionZOffset(v)}
                  units={units}
                  decimals={2}
                />
              </Field>
            )}
            <Field label="Cut priority">
              <input
                key={`priority-${sel.cutPriority}`}
                className="input narrow"
                type="number"
                min={0}
                step={1}
                title="Lower numbers are cut first when Order by → Priority is enabled"
                defaultValue={sel.cutPriority}
                onBlur={(e) => ws?.setSelectionCutPriority(Number(e.target.value) || 0)}
              />
            </Field>
            <Field label="Layer">
              <select
                className="input"
                value={state.activeLayerId}
                onChange={(e) => {
                  store.setState({ activeLayerId: e.target.value });
                  ws?.setLayerOfSelection(e.target.value);
                }}
              >
                {state.doc.layers.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <span
                className="layer-swatch"
                style={{ background: activeLayer?.color, flex: '0 0 16px' }}
              />
            </Field>
            <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
              <button className="btn" style={{ flex: 1 }} onClick={() => ws?.flip('h')}>
                Flip H
              </button>
              <button className="btn" style={{ flex: 1 }} onClick={() => ws?.flip('v')}>
                Flip V
              </button>
              <button className="btn" style={{ flex: 1 }} onClick={() => ws?.rotate(90)}>
                +90°
              </button>
            </div>
            {sel.overrideCount > 0 && (
              <div className="field-row" style={{ marginTop: 6 }}>
                <span className="hint" style={{ color: 'var(--accent-soft)' }}>
                  {sel.overrideCount} cut override{sel.overrideCount === 1 ? '' : 's'}
                </span>
                <button
                  className="btn"
                  style={{ marginLeft: 'auto', height: 20 }}
                  onClick={() => ws?.clearCutOverride()}
                  title="Remove per-object speed/power overrides"
                >
                  Clear
                </button>
              </div>
            )}
            <p className="hint" style={{ marginTop: 6 }}>
              {sel.count} object{sel.count === 1 ? '' : 's'} selected
            </p>
          </>
        )}
      </Panel>
    </div>
  );
}

function ensureColorLayer(color: string): LayerDef {
  const s = store.getState();
  const existing = s.doc.layers.find((l) => l.color.toLowerCase() === color.toLowerCase());
  if (existing) return existing;
  const layer = store.addLayer();
  const name = color.replace('#', '').toUpperCase();
  store.updateLayer(layer.id, { color, name });
  return { ...layer, color, name };
}

function ColorPalettePanel() {
  const state = useAppState();
  const ws = useWorkspace();
  const active = state.doc.layers.find((l) => l.id === state.activeLayerId);

  return (
    <div id="panel-palette">
      <Panel title="Color Palette">
        <div className="color-palette">
          {PALETTE_COLORS.map((color) => {
            const layer = state.doc.layers.find(
              (l) => l.color.toLowerCase() === color.toLowerCase(),
            );
            const isActive = active?.color.toLowerCase() === color.toLowerCase();
            return (
              <button
                key={color}
                type="button"
                className={`swatch${isActive ? ' active' : ''}`}
                style={{ background: color }}
                title={layer ? `${layer.name} — click to select layer` : `New layer ${color}`}
                onClick={() => {
                  const target = ensureColorLayer(color);
                  store.setState({ activeLayerId: target.id });
                  if (state.selection) ws?.setLayerOfSelection(target.id);
                }}
              />
            );
          })}
        </div>
        <p className="hint" style={{ marginTop: 6 }}>
          Click a swatch to make it the active layer. With a selection, the colour is applied to the
          selected shapes.
        </p>
      </Panel>
    </div>
  );
}

function MaterialPanel() {
  const state = useAppState();
  const units = useUnits();
  const [materials, setMaterials] = useState<MaterialEntry[]>(() => loadMaterials());
  const [selected, setSelected] = useState(0);
  const active = state.doc.layers.find((l) => l.id === state.activeLayerId);
  const current = materials[Math.min(selected, materials.length - 1)];

  useEffect(() => {
    saveMaterials(materials);
  }, [materials]);

  useEffect(() => {
    const reload = () => setMaterials(loadMaterials());
    window.addEventListener(MATERIALS_UPDATED_EVENT, reload);
    return () => window.removeEventListener(MATERIALS_UPDATED_EVENT, reload);
  }, []);

  const updateCurrent = (patch: Partial<MaterialEntry>) => {
    if (!current) return;
    setMaterials((list) =>
      list.map((m) => (m.id === current.id ? { ...m, ...patch } : m)),
    );
  };

  const addFromLayer = () => {
    if (!active) return;
    setMaterials((list) => [...list, materialFromLayer(active)]);
    setSelected(materials.length);
  };

  const removeCurrent = () => {
    if (!current) return;
    setMaterials((list) => list.filter((m) => m.id !== current.id));
    setSelected(0);
  };

  return (
    <div id="panel-material">
      <Panel title="Material Library" defaultOpen={false}>
        <select
          className="input"
          style={{ height: 24 }}
          value={current ? materials.indexOf(current) : 0}
          onChange={(e) => setSelected(Number(e.target.value))}
        >
          {materials.map((m, i) => (
            <option key={m.id} value={i}>
              {m.name}
              {m.thickness ? ` — ${m.thickness}` : ''}
            </option>
          ))}
        </select>

        {current && (
          <>
            <div className="grid-2" style={{ marginTop: 6 }}>
              <Field label="Name">
                <input
                  className="input"
                  value={current.name}
                  onChange={(e) => updateCurrent({ name: e.target.value })}
                />
              </Field>
              <Field label="Thick.">
                <input
                  className="input"
                  value={current.thickness}
                  placeholder="3 mm"
                  onChange={(e) => updateCurrent({ thickness: e.target.value })}
                />
              </Field>
              <Field label="Speed">
                <input
                  className="input"
                  type="number"
                  value={current.speed}
                  onChange={(e) => updateCurrent({ speed: Number(e.target.value) })}
                />
              </Field>
              <Field label="Power">
                <input
                  className="input"
                  type="number"
                  value={current.power}
                  onChange={(e) => updateCurrent({ power: Number(e.target.value) })}
                />
              </Field>
              <Field label="Pass">
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={current.passes}
                  onChange={(e) => updateCurrent({ passes: Math.max(1, Number(e.target.value)) })}
                />
              </Field>
              <Field label="Kerf">
                <NumberField
                  value={current.kerf}
                  onChange={(v) => updateCurrent({ kerf: v })}
                  units={units}
                />
              </Field>
            </div>
            <div className="field-row" style={{ marginTop: 6 }}>
              <span className="field-label">Mode</span>
              <select
                className="input"
                value={current.mode}
                onChange={(e) => updateCurrent({ mode: e.target.value as 'line' | 'fill' })}
              >
                <option value="line">Line</option>
                <option value="fill">Fill</option>
              </select>
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
          <button
            className="btn primary"
            style={{ flex: 1 }}
            disabled={!active || !current}
            onClick={() => {
              if (!active || !current) return;
              store.updateCutSettings(active.id, {
                speed: current.speed,
                power: current.power,
                passes: current.passes,
                mode: current.mode,
                kerf: current.kerf,
              });
            }}
          >
            Apply to layer
          </button>
          <button className="btn" title="Add the active layer as a material" onClick={addFromLayer}>
            Save layer
          </button>
          <button className="btn" title="Delete this material" onClick={removeCurrent} disabled={!current}>
            Delete
          </button>
        </div>
        <p className="hint" style={{ marginTop: 6 }}>
          Applies speed, power, passes, mode and kerf to {active?.name ?? '—'}. Edits are saved in
          this browser/computer automatically.
        </p>
      </Panel>
    </div>
  );
}

const STATUS_LABEL: Record<MachineStatus, string> = {
  disconnected: 'Disconnected',
  idle: 'Idle',
  run: 'Running',
  hold: 'Hold',
  jog: 'Jogging',
  home: 'Homing',
  alarm: 'Alarm',
  door: 'Door open',
  check: 'Check mode',
};

function statusClass(status: MachineStatus): string {
  if (status === 'idle') return 'ok';
  if (status === 'run' || status === 'jog' || status === 'home') return 'run';
  if (status === 'alarm' || status === 'door') return 'error';
  return '';
}

function LaserPanel() {
  const state = useAppState();
  const ws = useWorkspace();
  const m = useMachine();
  const device = state.device;
  const [port, setPort] = useState('auto');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cutSelected, setCutSelected] = useState(false);
  const [optOpen, setOptOpen] = useState(false);

  useEffect(() => {
    void machine.refreshPorts();
  }, []);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      if (port === 'mock') {
        await machine.connectMock();
      } else if (port === 'auto') {
        await machine.connectSerial(device.baudRate);
      } else {
        await machine.connectSerial(device.baudRate, Number(port));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      void machine.refreshPorts();
    }
  };

  const start = async () => {
    if (!ws) return;
    const plan = await ws.generateJob(cutSelected);
    if (plan.segments.length === 0) {
      ws.setStatus('Nothing to send — check layer output and geometry');
      return;
    }
    plan.warnings.slice(0, 3).forEach((w) => machine.logInfo(`Warning: ${w}`));
    machine.startPlan(plan, 'job');
    ws.setStatus(`Job started — ${formatDuration(plan.timeSeconds)} estimated`);
  };

  const frame = () => {
    const plan = ws?.generateFrameJob();
    if (plan) {
      machine.startPlan(plan, 'frame');
      ws?.setStatus('Framing selection');
    }
  };

  return (
    <div id="panel-laser">
      <Panel title="Laser">
        <div className="field-row">
          <span className="field-label">Device</span>
          <select className="input" value="grbl" disabled>
            <option value="grbl">{device.name} (GCode)</option>
          </select>
        </div>

        {!m.connected ? (
          <>
            <div className="field-row">
              <span className="field-label">Port</span>
              <select className="input" value={port} onChange={(e) => setPort(e.target.value)}>
                <option value="auto">Ask on connect…</option>
                <option value="mock">Simulator (demo)</option>
                {m.ports.map((p) => (
                  <option key={p.index} value={p.index}>
                    {p.label}
                  </option>
                ))}
              </select>
              <button
                className="toggle-btn"
                title="Scan serial ports"
                onClick={() => void machine.refreshPorts()}
              >
                <Icon name="repeat" size={12} />
              </button>
            </div>
            <button className="btn primary block" disabled={busy} onClick={() => void connect()}>
              <Icon name="device" size={13} /> {busy ? 'Connecting…' : 'Connect'}
            </button>
            {error && <p className="hint" style={{ color: 'var(--red)', marginTop: 5 }}>{error}</p>}
            {!navigator.serial && (
              <p className="hint" style={{ marginTop: 5 }}>
                Web Serial is unavailable here. Use the simulator to try the job controls.
              </p>
            )}
          </>
        ) : (
          <>
            <div className="field-row" style={{ justifyContent: 'space-between' }}>
              <span className="status-item">
                <span className={`badge-dot ${statusClass(m.status)}`} />
                <strong>{STATUS_LABEL[m.status]}</strong>
              </span>
              <span className="hint">{m.transportName}</span>
              <button className="btn" style={{ height: 20, padding: '0 7px' }} onClick={() => void machine.disconnect()}>
                Disconnect
              </button>
            </div>
            <div className="field-row" style={{ fontFamily: 'var(--mono)', fontSize: 10.5 }}>
              <span className="field-label">MPos</span>
              <span>
                {m.mpos.x.toFixed(2)}, {m.mpos.y.toFixed(2)}
              </span>
              <span className="grow" />
              <span className="hint">F{m.feed.toFixed(0)} S{m.spindle.toFixed(0)}</span>
            </div>
          </>
        )}

        {m.jobActive && (
          <div style={{ marginTop: 7 }}>
            <div className="progress">
              <div style={{ width: `${Math.round(m.progress * 100)}%` }} />
            </div>
            <div className="field-row" style={{ marginTop: 4, justifyContent: 'space-between' }}>
              <span className="hint">
                {m.jobPaused ? 'Paused' : 'Running'} · {Math.round(m.progress * 100)}%
              </span>
              <span className="hint">
                {formatDuration(m.elapsed)} / {formatDuration(m.remaining)} left
              </span>
              <button
                className="btn"
                style={{ height: 20, padding: '0 7px' }}
                onClick={() => (m.jobPaused ? machine.resumeJob() : machine.pauseJob())}
              >
                {m.jobPaused ? 'Resume' : 'Pause'}
              </button>
            </div>
          </div>
        )}

        <div className="grid-3" style={{ marginTop: 7 }}>
          <button className="btn" disabled={!m.connected || m.jobActive} onClick={frame} title="Frame the selection">
            <Icon name="frame" size={13} /> Frame
          </button>
          <button
            className="btn primary"
            disabled={!m.connected || m.jobActive}
            onClick={() => void start()}
            title="Start job"
          >
            <Icon name="play" size={12} /> Start
          </button>
          <button
            className="btn danger"
            disabled={!m.jobActive}
            onClick={() => machine.stopJob()}
            title="Stop job"
          >
            <Icon name="stop" size={12} /> Stop
          </button>
        </div>

        {m.lastJob && !m.jobActive && (
          <p className="hint" style={{ marginTop: 6 }}>
            Last {m.lastJob.kind}: {m.lastJob.lines} lines in {formatDuration(m.lastJob.seconds)}
            {m.lastJob.completed ? ' ✓' : ' (stopped)'}
          </p>
        )}

        <div className="field-row" style={{ marginTop: 7 }}>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={cutSelected}
              onChange={(e) => setCutSelected(e.target.checked)}
            />
            Cut selected graphics
          </label>
        </div>
        <button
          className="btn block"
          style={{ marginTop: 2, marginBottom: 5 }}
          onClick={() => setOptOpen(true)}
          title="Order of cuts and path optimisations"
        >
          <Icon name="settings" size={13} /> Optimization Settings
        </button>
        <div className="field-row">
          <span className="field-label">Origin</span>
          <select
            className="input"
            value={device.origin}
            onChange={(e) => store.updateDevice({ origin: e.target.value as 'bottom-left' | 'top-left' })}
          >
            <option value="bottom-left">Bottom-left</option>
            <option value="top-left">Top-left</option>
          </select>
        </div>
        <p className="hint" style={{ marginTop: 6 }}>
          {state.doc.bed.width} × {state.doc.bed.height} {state.doc.units} · {device.baudRate} baud ·
          S{device.maxS}
        </p>
      </Panel>
      {optOpen && <OptimizationDialog onClose={() => setOptOpen(false)} />}
    </div>
  );
}

function MovePanel() {
  const m = useMachine();
  const [step, setStep] = useState(1);
  const [feed, setFeed] = useState(1000);
  const disabled = !m.connected;

  return (
    <div id="panel-move">
      <Panel title="Move" defaultOpen={false}>
        <div className="field-row">
          <span className="field-label">Step</span>
          <input
            className="input narrow"
            type="number"
            min={0.01}
            step={0.5}
            value={step}
            onChange={(e) => setStep(Number(e.target.value))}
          />
          <span className="hint">mm</span>
          <span className="field-label">Feed</span>
          <input
            className="input narrow"
            type="number"
            step={100}
            value={feed}
            onChange={(e) => setFeed(Number(e.target.value))}
          />
        </div>
        <div className="jog-pad">
          <span />
          <button className="tb-btn" disabled={disabled} onClick={() => machine.jog(0, step, feed)} title="Y+">
            <Icon name="jog-up" size={17} />
          </button>
          <span />
          <button className="tb-btn" disabled={disabled} onClick={() => machine.jog(-step, 0, feed)} title="X−">
            <Icon name="jog-left" size={17} />
          </button>
          <button
            className="tb-btn"
            disabled={disabled}
            onClick={() => machine.setWorkOrigin()}
            title="Set work origin (G10 L20 P1)"
          >
            <Icon name="home" size={15} />
          </button>
          <button className="tb-btn" disabled={disabled} onClick={() => machine.jog(step, 0, feed)} title="X+">
            <Icon name="jog-right" size={17} />
          </button>
          <span />
          <button className="tb-btn" disabled={disabled} onClick={() => machine.jog(0, -step, feed)} title="Y−">
            <Icon name="jog-down" size={17} />
          </button>
          <span />
        </div>
        <div className="grid-3">
          <button className="btn" disabled={disabled} onClick={() => machine.home()}>
            Home
          </button>
          <button className="btn" disabled={disabled} onClick={() => machine.unlock()}>
            Unlock
          </button>
          <button className="btn" disabled={disabled} onClick={() => machine.setWorkOrigin()}>
            Origin
          </button>
        </div>
        <div className="field-row" style={{ marginTop: 7 }}>
          <span className="field-label">MPos</span>
          <span className="hint" style={{ fontFamily: 'var(--mono)' }}>
            {m.mpos.x.toFixed(2)}, {m.mpos.y.toFixed(2)}
          </span>
        </div>
        <p className="hint" style={{ marginTop: 6 }}>
          Jog uses GRBL 1.1 `$J` commands. Connect a device (or the simulator) in the Laser panel.
        </p>
      </Panel>
    </div>
  );
}

function BottomTabs() {
  const [tab, setTab] = useState<'console' | 'macros' | 'camera'>('console');

  return (
    <div className="bottom-dock">
      <div className="tab-strip">
        {(['console', 'macros', 'camera'] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`tab${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'console' && <ConsolePanel />}
      {tab === 'macros' && <MacrosPanel />}
      {tab === 'camera' && (
        <div style={{ padding: 6 }}>
          <p className="hint">
            Camera overlays and capture arrive in a later phase. Workspace background capture will
            appear here.
          </p>
          <button className="btn block" disabled>
            <Icon name="camera" size={13} /> Add camera
          </button>
        </div>
      )}
    </div>
  );
}

function ConsolePanel() {
  const m = useMachine();
  const [command, setCommand] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    machine.flushLogs();
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [m.logs]);

  const send = () => {
    const trimmed = command.trim();
    if (!trimmed) return;
    machine.sendCommand(trimmed);
    setCommand('');
  };

  return (
    <div style={{ padding: 6 }}>
      <div className="console" ref={logRef}>
        {m.logs.map((l) => (
          <div key={l.id} className={`log-${l.dir}`}>
            {l.dir === 'out' ? '→ ' : l.dir === 'in' ? '← ' : l.dir === 'error' ? '! ' : '· '}
            {l.text}
          </div>
        ))}
      </div>
      <div className="field-row" style={{ marginTop: 5 }}>
        <input
          className="input"
          placeholder={m.connected ? 'Type a GCode command…' : 'Connect a device to send commands'}
          value={command}
          disabled={!m.connected}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') send();
          }}
        />
        <button className="btn" disabled={!m.connected} onClick={send}>
          Send
        </button>
      </div>
      <div style={{ display: 'flex', gap: 3, marginTop: 4, flexWrap: 'wrap' }}>
        {['?', '$X', '$H', '$G', '$$', 'M5'].map((cmd) => (
          <button
            key={cmd}
            className="btn"
            style={{ height: 20, padding: '0 6px', fontSize: 10.5 }}
            disabled={!m.connected}
            onClick={() => machine.sendCommand(cmd)}
          >
            {cmd}
          </button>
        ))}
        <button
          className="btn"
          style={{ height: 20, padding: '0 6px', fontSize: 10.5, marginLeft: 'auto' }}
          onClick={() => machine.clearLogs()}
        >
          Clear
        </button>
      </div>
    </div>
  );
}

interface Macro {
  id: string;
  name: string;
  gcode: string;
}

const MACRO_KEY = 'openburn.macros';

const DEFAULT_MACROS: Macro[] = [
  { id: 'home', name: 'Homing', gcode: '$H' },
  { id: 'unlock', name: 'Unlock alarm', gcode: '$X' },
  { id: 'laseroff', name: 'Laser off', gcode: 'M5' },
  { id: 'settings', name: 'Show settings', gcode: '$$' },
  { id: 'position', name: 'Report position', gcode: '?' },
];

function loadMacros(): Macro[] {
  try {
    const raw = localStorage.getItem(MACRO_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Macro[];
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_MACROS;
}

function MacrosPanel() {
  const m = useMachine();
  const [macros, setMacros] = useState<Macro[]>(loadMacros);
  const [editing, setEditing] = useState<Macro | null>(null);
  const [name, setName] = useState('');
  const [gcode, setGcode] = useState('');

  const persist = (next: Macro[]) => {
    setMacros(next);
    try {
      localStorage.setItem(MACRO_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const startNew = () => {
    setEditing({ id: '', name: '', gcode: '' });
    setName('');
    setGcode('');
  };

  const startEdit = (macro: Macro) => {
    setEditing(macro);
    setName(macro.name);
    setGcode(macro.gcode);
  };

  const save = () => {
    if (!name.trim()) return;
    if (editing && editing.id) {
      persist(macros.map((mac) => (mac.id === editing.id ? { ...mac, name, gcode } : mac)));
    } else {
      persist([...macros, { id: `macro-${Date.now()}`, name, gcode }]);
    }
    setEditing(null);
  };

  const run = (macro: Macro) => {
    const lines = macro.gcode.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    machine.runMacro(lines);
  };

  return (
    <div style={{ padding: 6 }}>
      {!editing && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {macros.map((macro) => (
              <div key={macro.id} className="macro-row">
                <button className="macro-name" onClick={() => startEdit(macro)} title="Edit macro">
                  {macro.name}
                </button>
                <button
                  className="toggle-btn"
                  title="Run macro"
                  disabled={!m.connected}
                  onClick={() => run(macro)}
                >
                  <Icon name="play" size={11} />
                </button>
                <button
                  className="toggle-btn"
                  title="Delete macro"
                  onClick={() => persist(macros.filter((x) => x.id !== macro.id))}
                >
                  <Icon name="close" size={11} />
                </button>
              </div>
            ))}
          </div>
          <button className="btn block" style={{ marginTop: 5 }} onClick={startNew}>
            <Icon name="plus" size={12} /> Add macro
          </button>
          <p className="hint" style={{ marginTop: 5 }}>
            Macros run as a small job through the same GRBL stream.
          </p>
        </>
      )}

      {editing && (
        <>
          <div className="field-row">
            <span className="field-label">Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <textarea
            className="input macro-editor"
            value={gcode}
            placeholder="One GCode command per line"
            onChange={(e) => setGcode(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 4, marginTop: 5 }}>
            <button className="btn" style={{ flex: 1 }} onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button className="btn primary" style={{ flex: 1 }} onClick={save}>
              Save
            </button>
          </div>
        </>
      )}
    </div>
  );
}
