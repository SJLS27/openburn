import { useEffect, useState } from 'react';
import { store, useAppState } from '@/state/store';
import type { CutMode, DitherMode, LayerDef } from '@/types/document';
import { Icon } from '../icons';
import { Modal, NumberField, Panel, useUnits, useWorkspace } from '../common';

const MODE_LABEL: Record<CutMode, string> = {
  line: 'Line',
  fill: 'Fill',
  offsetFill: 'Offset Fill',
  image: 'Image',
};

const MODE_ICON: Record<CutMode, string> = {
  line: 'M2 20 22 4',
  fill: 'M3 4h18v16H3z',
  offsetFill: 'M5 5h14v14H5zM8 8h8v8H8z',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6',
};

function ModeGlyph({ mode }: { mode: CutMode }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d={MODE_ICON[mode]} />
    </svg>
  );
}

function toNum(v: string): number {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

export function CutsLayersPanel() {
  const state = useAppState();
  const units = useUnits();
  const ws = useWorkspace();
  const [editing, setEditing] = useState<LayerDef | null>(null);
  const layers = state.doc.layers;
  const active = layers.find((l) => l.id === state.activeLayerId) ?? layers[0];

  useEffect(() => {
    const ids = state.selection?.layerIds ?? [];
    if (ids.length === 1 && ids[0] !== state.activeLayerId) {
      store.setState({ activeLayerId: ids[0] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selection]);

  if (!active) return null;

  return (
    <div id="panel-cuts">
      <Panel
        title="Cuts / Layers"
        right={
          <span style={{ display: 'flex', gap: 2 }} onClick={(e) => e.stopPropagation()}>
            <button className="toggle-btn" title="Add layer" onClick={() => store.addLayer()}>
              <Icon name="plus" size={12} />
            </button>
            <button
              className="toggle-btn"
              title="Remove active layer"
              onClick={() => store.removeLayer(active.id)}
            >
              <Icon name="minus" size={12} />
            </button>
          </span>
        }
      >
        <table className="cuts-table">
          <thead>
            <tr>
              <th style={{ width: 20 }} />
              <th>Layer</th>
              <th style={{ width: 62 }}>Mode</th>
              <th style={{ width: 52, textAlign: 'right' }}>Speed</th>
              <th style={{ width: 46, textAlign: 'right' }}>Power</th>
              <th style={{ width: 22 }} />
              <th style={{ width: 22 }} />
            </tr>
          </thead>
          <tbody>
            {layers.map((layer) => {
              const isActive = layer.id === active.id;
              return (
                <tr
                  key={layer.id}
                  className={`cuts-row${isActive ? ' selected' : ''}${
                    layer.settings.visible ? '' : ' hidden-layer'
                  }`}
                  onClick={() => store.setState({ activeLayerId: layer.id })}
                  onDoubleClick={() => setEditing(layer)}
                >
                  <td>
                    <input
                      type="color"
                      className="layer-swatch"
                      style={{ padding: 0, background: layer.color }}
                      value={layer.color}
                      title="Layer colour"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        store.updateLayer(layer.id, { color: e.target.value });
                        if (layer.id === active.id && state.selection) {
                          ws?.setLayerOfSelection(layer.id);
                        }
                      }}
                    />
                  </td>
                  <td title="Double-click to edit cut settings">{layer.name}</td>
                  <td title={MODE_LABEL[layer.settings.mode]}>
                    <select
                      className="cuts-mini-input"
                      style={{ textAlign: 'left' }}
                      value={layer.settings.mode}
                      onChange={(e) =>
                        store.updateCutSettings(layer.id, { mode: e.target.value as CutMode })
                      }
                    >
                      {(Object.keys(MODE_LABEL) as CutMode[]).map((m) => (
                        <option key={m} value={m}>
                          {MODE_LABEL[m]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      key={`speed-${layer.id}-${layer.settings.speed}`}
                      className="cuts-mini-input"
                      defaultValue={layer.settings.speed}
                      onBlur={(e) => store.updateCutSettings(layer.id, { speed: toNum(e.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      key={`power-${layer.id}-${layer.settings.power}`}
                      className="cuts-mini-input"
                      defaultValue={layer.settings.power}
                      onBlur={(e) => store.updateCutSettings(layer.id, { power: toNum(e.target.value) })}
                    />
                  </td>
                  <td>
                    <button
                      className={`toggle-btn${layer.settings.output ? ' on' : ''}`}
                      title={layer.settings.output ? 'Output to laser' : 'Not output'}
                      onClick={(e) => {
                        e.stopPropagation();
                        store.updateCutSettings(layer.id, { output: !layer.settings.output });
                      }}
                    >
                      <Icon name="laser" size={12} />
                    </button>
                  </td>
                  <td>
                    <button
                      className={`toggle-btn${layer.settings.visible ? ' on' : ''}`}
                      title={layer.settings.visible ? 'Show in editor' : 'Hidden in editor'}
                      onClick={(e) => {
                        e.stopPropagation();
                        store.updateCutSettings(layer.id, { visible: !layer.settings.visible });
                      }}
                    >
                      <Icon name={layer.settings.visible ? 'eye' : 'eye-off'} size={12} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div style={{ display: 'flex', gap: 4, margin: '7px 0 6px' }}>
          <button className="btn" style={{ flex: 1 }} onClick={() => setEditing(active)}>
            Edit settings
          </button>
        </div>

        <div className="field-row">
          <span className="field-label" style={{ minWidth: 40 }}>
            Speed
          </span>
          <input
            className="input"
            type="number"
            step={1}
            min={0}
            value={active.settings.speed}
            onChange={(e) => store.updateCutSettings(active.id, { speed: toNum(e.target.value) })}
          />
          <span className="hint">mm/s</span>
        </div>
        <div className="field-row">
          <span className="field-label" style={{ minWidth: 40 }}>
            Power
          </span>
          <input
            className="input"
            type="number"
            step={1}
            min={0}
            max={100}
            value={active.settings.power}
            onChange={(e) => store.updateCutSettings(active.id, { power: toNum(e.target.value) })}
          />
          <span className="hint">%</span>
        </div>
        <div className="field-row">
          <span className="field-label" style={{ minWidth: 40 }}>
            Passes
          </span>
          <input
            className="input narrow"
            type="number"
            min={1}
            value={active.settings.passes}
            onChange={(e) =>
              store.updateCutSettings(active.id, { passes: Math.max(1, toNum(e.target.value)) })
            }
          />
          <span className="field-label">Int.</span>
          <input
            className="input narrow"
            type="number"
            step={0.01}
            value={active.settings.interval}
            title="Line interval (mm)"
            onChange={(e) => store.updateCutSettings(active.id, { interval: toNum(e.target.value) })}
          />
        </div>
        <div className="field-row">
          <span className="field-label" style={{ minWidth: 40 }}>
            Mode
          </span>
          <select
            className="input"
            value={active.settings.mode}
            onChange={(e) => store.updateCutSettings(active.id, { mode: e.target.value as CutMode })}
          >
            {(Object.keys(MODE_LABEL) as CutMode[]).map((m) => (
              <option key={m} value={m}>
                {MODE_LABEL[m]}
              </option>
            ))}
          </select>
          <label className="checkbox" title="Air assist">
            <input
              type="checkbox"
              checked={active.settings.airAssist}
              onChange={(e) => store.updateCutSettings(active.id, { airAssist: e.target.checked })}
            />
            Air
          </label>
        </div>
        <p className="hint" style={{ marginTop: 6 }}>
          Double-click a layer to open the full Cut Settings editor. Speed is shown in device units
          (mm/s).
        </p>
      </Panel>

      {editing && (
        <CutSettingsDialog
          layer={editing}
          onClose={() => setEditing(null)}
          units={units}
        />
      )}
    </div>
  );
}

function CutSettingsDialog({
  layer,
  onClose,
  units,
}: {
  layer: LayerDef;
  onClose: () => void;
  units: 'mm' | 'in';
}) {
  const live = useAppState().doc.layers.find((l) => l.id === layer.id) ?? layer;
  const s = live.settings;
  const update = (patch: Parameters<typeof store.updateCutSettings>[1]) =>
    store.updateCutSettings(layer.id, patch);

  return (
    <Modal
      title={`Cut Settings — ${live.name}`}
      onClose={onClose}
      footer={<button className="btn primary" onClick={onClose}>Close</button>}
    >
      <div className="field-row">
        <span className="field-label" style={{ minWidth: 70 }}>
          Name
        </span>
        <input
          className="input"
          value={live.name}
          onChange={(e) => store.updateLayer(live.id, { name: e.target.value })}
        />
        <input
          type="color"
          className="layer-swatch"
          style={{ width: 26, height: 24 }}
          value={live.color}
          onChange={(e) => store.updateLayer(live.id, { color: e.target.value })}
        />
      </div>

      <div className="field-row">
        <span className="field-label" style={{ minWidth: 70 }}>
          Mode
        </span>
        <select
          className="input"
          value={s.mode}
          onChange={(e) => update({ mode: e.target.value as CutMode })}
        >
          {(Object.keys(MODE_LABEL) as CutMode[]).map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </select>
      </div>

      <div className="grid-2" style={{ marginTop: 8 }}>
        <div className="field-row">
          <span className="field-label" style={{ minWidth: 58 }}>
            Speed
          </span>
          <input
            className="input"
            type="number"
            value={s.speed}
            onChange={(e) => update({ speed: toNum(e.target.value) })}
          />
        </div>
        <div className="field-row">
          <span className="field-label" style={{ minWidth: 58 }}>
            Power
          </span>
          <input
            className="input"
            type="number"
            value={s.power}
            onChange={(e) => update({ power: toNum(e.target.value) })}
          />
        </div>
        <div className="field-row">
          <span className="field-label" style={{ minWidth: 58 }}>
            Passes
          </span>
          <input
            className="input"
            type="number"
            min={1}
            value={s.passes}
            onChange={(e) => update({ passes: Math.max(1, toNum(e.target.value)) })}
          />
        </div>
        <div className="field-row">
          <span className="field-label" style={{ minWidth: 58 }}>
            Interval
          </span>
          <NumberField value={s.interval} onChange={(v) => update({ interval: v })} units={units} />
        </div>
        <div className="field-row">
          <span className="field-label" style={{ minWidth: 58 }}>
            Offset
          </span>
          <NumberField
            value={s.offsetDistance}
            onChange={(v) => update({ offsetDistance: v })}
            units={units}
          />
        </div>
        <div className="field-row">
          <span className="field-label" style={{ minWidth: 58 }}>
            Overscan
          </span>
          <NumberField value={s.overscan} onChange={(v) => update({ overscan: v })} units={units} />
        </div>
      </div>

      <div className="field-row" style={{ marginTop: 8 }}>
        <span className="field-label" style={{ minWidth: 70 }}>
          Dither
        </span>
        <select
          className="input"
          value={s.dither}
          onChange={(e) => update({ dither: e.target.value as DitherMode })}
        >
          <option value="none">None</option>
          <option value="jarvis">Jarvis</option>
          <option value="atkinson">Atkinson</option>
          <option value="stucki">Stucki</option>
          <option value="ordered">Ordered</option>
        </select>
      </div>

      <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={s.output}
            onChange={(e) => update({ output: e.target.checked })}
          />
          Output
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={s.visible}
            onChange={(e) => update({ visible: e.target.checked })}
          />
          Show
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={s.airAssist}
            onChange={(e) => update({ airAssist: e.target.checked })}
          />
          Air assist
        </label>
      </div>

      <p className="hint" style={{ marginTop: 10 }}>
        <ModeGlyph mode={s.mode} /> {MODE_LABEL[s.mode]} mode — these settings are used when GCode
        generation is added in Phase 2.
      </p>
    </Modal>
  );
}
