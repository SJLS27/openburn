import { useEffect, useState, type ReactNode } from 'react';
import { store, useAppState } from '@/state/store';
import type { CutMode, CutSettings, DitherMode, FillGrouping, LayerDef } from '@/types/document';
import { Icon } from '../icons';
import { Field, Modal, NumberField, Panel, useUnits, useWorkspace } from '../common';
import { OptimizationDialog } from './OptimizationDialog';

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

const IMAGE_MODE_LABEL: Record<DitherMode, string> = {
  none: 'Continuous',
  grayscale: 'Grayscale',
  threshold: 'Threshold',
  ordered: 'Ordered',
  atkinson: 'Atkinson',
  dither: 'Dither',
  stucki: 'Stucki',
  jarvis: 'Jarvis',
  newsprint: 'Newsprint',
  halftone: 'Halftone',
  sketch: 'Sketch',
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

interface CtxMenu {
  x: number;
  y: number;
  kind: 'header' | 'row';
  layerId?: string;
}

export function CutsLayersPanel() {
  const state = useAppState();
  const units = useUnits();
  const ws = useWorkspace();
  const [editing, setEditing] = useState<LayerDef | null>(null);
  const [optOpen, setOptOpen] = useState(false);
  const [ctx, setCtx] = useState<CtxMenu | null>(null);
  const [showColumns, setShowColumns] = useState({
    speed: true,
    power: true,
    output: true,
    show: true,
    air: true,
  });
  const layers = state.doc.layers;
  const active = layers.find((l) => l.id === state.activeLayerId) ?? layers[0];

  useEffect(() => {
    const ids = state.selection?.layerIds ?? [];
    if (ids.length === 1 && ids[0] !== state.activeLayerId) {
      store.setState({ activeLayerId: ids[0] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selection]);

  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [ctx]);

  if (!active) return null;

  const setAll = (patch: Partial<CutSettings>) => {
    for (const layer of layers) store.updateCutSettings(layer.id, patch);
  };

  const onlyThis = (layerId: string, key: 'output' | 'visible') => {
    for (const layer of layers) {
      store.updateCutSettings(layer.id, { [key]: layer.id === layerId });
    }
  };

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
        <table className="cuts-table cuts-table-lb">
          <thead
            onContextMenu={(e) => {
              e.preventDefault();
              setCtx({ x: e.clientX, y: e.clientY, kind: 'header' });
            }}
          >
            <tr>
              <th style={{ width: 22 }}>#</th>
              <th>Layer</th>
              <th style={{ width: 58 }}>Mode</th>
              {showColumns.speed && showColumns.power && (
                <th style={{ width: 52, textAlign: 'right' }}>Spd/Pwr</th>
              )}
              {showColumns.output && <th style={{ width: 18 }} title="Output"><Icon name="laser" size={10} /></th>}
              {showColumns.show && <th style={{ width: 18 }} title="Show"><Icon name="eye" size={10} /></th>}
              {showColumns.air && <th style={{ width: 18 }} title="Air assist">A</th>}
            </tr>
          </thead>
          <tbody>
            {layers.map((layer, index) => {
              const isActive = layer.id === active.id;
              return (
                <tr
                  key={layer.id}
                  className={`cuts-row${isActive ? ' selected' : ''}${
                    layer.settings.visible ? '' : ' hidden-layer'
                  }${layer.settings.output ? '' : ' no-output'}`}
                  onClick={() => store.setState({ activeLayerId: layer.id })}
                  onDoubleClick={() => setEditing(layer)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    store.setState({ activeLayerId: layer.id });
                    setCtx({ x: e.clientX, y: e.clientY, kind: 'row', layerId: layer.id });
                  }}
                >
                  <td className="cuts-index">
                    {String(index + 1).padStart(2, '0')}
                  </td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
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
                      <span title="Double-click to edit cut settings">{layer.name}</span>
                    </span>
                  </td>
                  <td>
                    <select
                      className="cuts-mini-input"
                      style={{ textAlign: 'left' }}
                      value={layer.settings.mode}
                      onClick={(e) => e.stopPropagation()}
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
                  {showColumns.speed && showColumns.power && (
                    <td>
                      <span className="cuts-spdpwr">
                        <input
                          key={`speed-${layer.id}-${layer.settings.speed}`}
                          className="cuts-mini-input"
                          title="Speed (mm/s)"
                          defaultValue={layer.settings.speed}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={(e) =>
                            store.updateCutSettings(layer.id, { speed: toNum(e.target.value) })
                          }
                        />
                        <span className="cuts-slash">/</span>
                        <input
                          key={`power-${layer.id}-${layer.settings.power}`}
                          className="cuts-mini-input"
                          title="Max power (%)"
                          defaultValue={layer.settings.power}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={(e) =>
                            store.updateCutSettings(layer.id, { power: toNum(e.target.value) })
                          }
                        />
                      </span>
                    </td>
                  )}
                  {showColumns.output && (
                    <td>
                      <button
                        className={`toggle-btn${layer.settings.output ? ' on' : ''}`}
                        title={layer.settings.output ? 'Output to laser' : 'Not output'}
                        onClick={(e) => {
                          e.stopPropagation();
                          store.updateCutSettings(layer.id, { output: !layer.settings.output });
                        }}
                      >
                        <Icon name="laser" size={11} />
                      </button>
                    </td>
                  )}
                  {showColumns.show && (
                    <td>
                      <button
                        className={`toggle-btn${layer.settings.visible ? ' on' : ''}`}
                        title={layer.settings.visible ? 'Show in editor' : 'Hidden in editor'}
                        onClick={(e) => {
                          e.stopPropagation();
                          store.updateCutSettings(layer.id, { visible: !layer.settings.visible });
                        }}
                      >
                        <Icon name={layer.settings.visible ? 'eye' : 'eye-off'} size={11} />
                      </button>
                    </td>
                  )}
                  {showColumns.air && (
                    <td>
                      <button
                        className={`toggle-btn${layer.settings.airAssist ? ' on' : ''}`}
                        title={layer.settings.airAssist ? 'Air assist on' : 'Air assist off'}
                        onClick={(e) => {
                          e.stopPropagation();
                          store.updateCutSettings(layer.id, {
                            airAssist: !layer.settings.airAssist,
                          });
                        }}
                      >
                        A
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="cuts-reorder">
          <button
            className="btn"
            title="Move layer up"
            disabled={layers[0]?.id === active.id}
            onClick={() => store.moveLayer(active.id, -1)}
          >
            ↑
          </button>
          <button
            className="btn"
            title="Move layer down"
            disabled={layers[layers.length - 1]?.id === active.id}
            onClick={() => store.moveLayer(active.id, 1)}
          >
            ↓
          </button>
          <button
            className="btn"
            title="Copy the active layer's settings"
            onClick={() => ws?.copyLayerSettings(active.id)}
          >
            Copy
          </button>
          <button
            className="btn"
            title="Paste settings into the active layer"
            onClick={() => ws?.pasteLayerSettings(active.id)}
          >
            Paste
          </button>
          <button
            className="btn"
            title="Sort: engraving first, cuts last"
            onClick={() => store.sortCutsLast()}
          >
            Sort
          </button>
        </div>

        {/* LightBurn-style abbreviated settings for the active layer. */}
        <div className="cuts-quick">
          <Field label="Passes">
            <input
              className="input narrow"
              type="number"
              min={1}
              value={active.settings.passes}
              onChange={(e) =>
                store.updateCutSettings(active.id, {
                  passes: Math.max(1, toNum(e.target.value)),
                })
              }
            />
          </Field>
          <Field label="Speed">
            <input
              className="input narrow"
              type="number"
              min={0}
              value={active.settings.speed}
              onChange={(e) =>
                store.updateCutSettings(active.id, { speed: toNum(e.target.value) })
              }
            />
          </Field>
          <Field label="Power Max">
            <input
              className="input narrow"
              type="number"
              min={0}
              max={100}
              value={active.settings.power}
              onChange={(e) =>
                store.updateCutSettings(active.id, { power: toNum(e.target.value) })
              }
            />
          </Field>
          <Field label="Power Min">
            <input
              className="input narrow"
              type="number"
              min={0}
              max={100}
              title="Power used at low speeds and for grayscale"
              value={active.settings.minPower}
              onChange={(e) =>
                store.updateCutSettings(active.id, { minPower: toNum(e.target.value) })
              }
            />
          </Field>
          <Field label="Interval">
            <NumberField
              value={active.settings.interval}
              onChange={(v) => store.updateCutSettings(active.id, { interval: v })}
              units={units}
            />
          </Field>
        </div>

        <div style={{ display: 'flex', gap: 4, margin: '7px 0 2px' }}>
          <button className="btn" style={{ flex: 1 }} onClick={() => setEditing(active)}>
            Edit settings
          </button>
          <button
            className="btn"
            style={{ flex: 1 }}
            title="Order of cuts and path optimisations"
            onClick={() => setOptOpen(true)}
          >
            Optimization
          </button>
        </div>
        <p className="hint" style={{ marginTop: 5 }}>
          Double-click a layer for the full Cut Settings Editor. Right-click the header or a layer
          for bulk actions.
        </p>
      </Panel>

      {ctx && (
        <ContextMenu
          menu={ctx}
          layers={layers}
          onClose={() => setCtx(null)}
          onOpenSettings={(layer) => setEditing(layer)}
          onSetAll={setAll}
          onOnlyThis={onlyThis}
          onSortCutsLast={() => store.sortCutsLast()}
          onToggleColumn={(key) =>
            setShowColumns((c) => ({ ...c, [key]: !c[key] }))
          }
          showColumns={showColumns}
        />
      )}

      {editing && (
        <CutSettingsDialog layer={editing} onClose={() => setEditing(null)} units={units} />
      )}
      {optOpen && <OptimizationDialog onClose={() => setOptOpen(false)} />}
    </div>
  );
}

function ContextMenu({
  menu,
  layers,
  onClose,
  onOpenSettings,
  onSetAll,
  onOnlyThis,
  onSortCutsLast,
  onToggleColumn,
  showColumns,
}: {
  menu: CtxMenu;
  layers: LayerDef[];
  onClose: () => void;
  onOpenSettings: (layer: LayerDef) => void;
  onSetAll: (patch: Partial<CutSettings>) => void;
  onOnlyThis: (layerId: string, key: 'output' | 'visible') => void;
  onSortCutsLast: () => void;
  onToggleColumn: (key: 'speed' | 'power' | 'output' | 'show' | 'air') => void;
  showColumns: { speed: boolean; power: boolean; output: boolean; show: boolean; air: boolean };
}) {
  const ws = useWorkspace();
  const layer = menu.layerId ? layers.find((l) => l.id === menu.layerId) : undefined;
  const item = (label: string, action: () => void, danger = false): ReactNode => (
    <button
      key={label}
      className={`ctx-item${danger ? ' danger' : ''}`}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => {
        action();
        onClose();
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      className="ctx-menu"
      style={{ left: menu.x, top: menu.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {menu.kind === 'header' ? (
        <>
          {item('Enable all layers', () => onSetAll({ output: true }))}
          {item('Disable all layers', () => onSetAll({ output: false }))}
          {item('Invert enabled layers', () => {
            for (const l of layers) {
              store.updateCutSettings(l.id, { output: !l.settings.output });
            }
          })}
          {item('Show all layers', () => onSetAll({ visible: true }))}
          {item('Hide all layers', () => onSetAll({ visible: false }))}
          {item('Invert visible layers', () => {
            for (const l of layers) {
              store.updateCutSettings(l.id, { visible: !l.settings.visible });
            }
          })}
          {item('Enable all air assist', () => onSetAll({ airAssist: true }))}
          {item('Disable all air assist', () => onSetAll({ airAssist: false }))}
          <div className="ctx-sep" />
          {item('Sort Cuts Last', onSortCutsLast)}
          <div className="ctx-sep" />
          <div className="ctx-label">Columns</div>
          {item(`${showColumns.speed ? '✓ ' : '   '}Speed / Power`, () => onToggleColumn('speed'))}
          {item(`${showColumns.output ? '✓ ' : '   '}Output`, () => onToggleColumn('output'))}
          {item(`${showColumns.show ? '✓ ' : '   '}Show`, () => onToggleColumn('show'))}
          {item(`${showColumns.air ? '✓ ' : '   '}Air`, () => onToggleColumn('air'))}
        </>
      ) : (
        layer && (
          <>
            {item('Edit cut settings…', () => onOpenSettings(layer))}
            <div className="ctx-sep" />
            {item('Disable this layer', () =>
              store.updateCutSettings(layer.id, { output: false }),
            )}
            {item('Disable all layers but this one', () => onOnlyThis(layer.id, 'output'))}
            {item('Hide this layer', () =>
              store.updateCutSettings(layer.id, { visible: false }),
            )}
            {item('Hide all layers but this one', () => onOnlyThis(layer.id, 'visible'))}
            <div className="ctx-sep" />
            {item('Select all shapes in current layer', () =>
              ws?.selectLayerObjects(layer.id),
            )}
            {item('Flash the content on this layer', () => ws?.flashLayer(layer.id))}
            <div className="ctx-sep" />
            {item('Copy layer settings', () => ws?.copyLayerSettings(layer.id))}
            {item('Paste layer settings', () => ws?.pasteLayerSettings(layer.id))}
            {item('Delete this layer', () => store.removeLayer(layer.id), true)}
          </>
        )
      )}
    </div>
  );
}

function Tabs({
  tab,
  onChange,
}: {
  tab: 'common' | 'advanced';
  onChange: (t: 'common' | 'advanced') => void;
}) {
  return (
    <div className="dlg-tabs">
      <button className={tab === 'common' ? 'active' : ''} onClick={() => onChange('common')}>
        Common
      </button>
      <button className={tab === 'advanced' ? 'active' : ''} onClick={() => onChange('advanced')}>
        Advanced
      </button>
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
  const appState = useAppState();
  const live = appState.doc.layers.find((l) => l.id === layer.id) ?? layer;
  const device = appState.device;
  const [tab, setTab] = useState<'common' | 'advanced'>('common');
  const [, forceRender] = useState(0);
  const s = live.settings;
  const update = (patch: Partial<CutSettings>) => store.updateCutSettings(layer.id, patch);
  const linesPerInch = s.interval > 0 ? 25.4 / s.interval : 0;
  const isVector = s.mode === 'line' || s.mode === 'fill' || s.mode === 'offsetFill';

  return (
    <Modal
      title={`Cut Settings Editor — ${live.name}`}
      onClose={onClose}
      width={560}
      footer={
        <>
          <button
            className="btn"
            title="Store the current settings as this layer's defaults"
            onClick={() => {
              store.saveLayerDefaults(live.id);
              forceRender((n) => n + 1);
            }}
          >
            Save as default
          </button>
          <button
            className="btn"
            title="Restore this layer's saved defaults"
            disabled={!store.hasLayerDefaults(live.id)}
            onClick={() => store.resetLayerDefaults(live.id)}
          >
            Reset to default
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn primary" onClick={onClose}>
            OK
          </button>
        </>
      }
    >
      {/* Essential settings, always visible (LightBurn "Main / Shared"). */}
      <div className="field-row">
        <span className="field-label" style={{ minWidth: 78 }}>
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
        <span className="field-label" style={{ minWidth: 78 }}>
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
        <label className="checkbox" title="Send this layer to the laser">
          <input
            type="checkbox"
            checked={s.output}
            onChange={(e) => update({ output: e.target.checked })}
          />
          Output
        </label>
        <label className="checkbox" title="Turn on air assist (M7/M8)">
          <input
            type="checkbox"
            checked={s.airAssist}
            onChange={(e) => update({ airAssist: e.target.checked })}
          />
          Air assist
        </label>
      </div>

      <div className="grid-4" style={{ marginTop: 8 }}>
        <Field label="Speed">
          <input
            className="input narrow"
            type="number"
            min={0}
            value={s.speed}
            onChange={(e) => update({ speed: toNum(e.target.value) })}
          />
        </Field>
        <Field label="Max Pwr">
          <input
            className="input narrow"
            type="number"
            min={0}
            max={100}
            value={s.power}
            onChange={(e) => update({ power: toNum(e.target.value) })}
          />
        </Field>
        <Field label="Min Pwr">
          <input
            className="input narrow"
            type="number"
            min={0}
            max={100}
            value={s.minPower}
            onChange={(e) => update({ minPower: toNum(e.target.value) })}
          />
        </Field>
        <Field label="Passes">
          <input
            className="input narrow"
            type="number"
            min={1}
            value={s.passes}
            onChange={(e) => update({ passes: Math.max(1, toNum(e.target.value)) })}
          />
        </Field>
      </div>

      <Tabs tab={tab} onChange={setTab} />

      {tab === 'common' && (
        <>
          {isVector && (
            <div className="grid-2">
              <Field label="Z offset">
                <NumberField value={s.zOffset} onChange={(v) => update({ zOffset: v })} units={units} />
              </Field>
              <Field label="Z step">
                <NumberField
                  value={s.zStepPerPass}
                  onChange={(v) => update({ zStepPerPass: v })}
                  units={units}
                />
              </Field>
            </div>
          )}

          {s.mode === 'line' && (
            <>
              <div className="grid-3">
                <Field label="Kerf offset">
                  <NumberField value={s.kerf} onChange={(v) => update({ kerf: v })} units={units} />
                </Field>
              </div>
              <div className="field-row" style={{ marginTop: 4 }}>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={s.perforation}
                    onChange={(e) => update({ perforation: e.target.checked })}
                  />
                  Perforation mode
                </label>
                <span className="field-label" style={{ minWidth: 30 }}>
                  Cut
                </span>
                <NumberField
                  value={s.perforationCut}
                  onChange={(v) => update({ perforationCut: v })}
                  units={units}
                  disabled={!s.perforation}
                />
                <span className="field-label" style={{ minWidth: 34 }}>
                  Skip
                </span>
                <NumberField
                  value={s.perforationSkip}
                  onChange={(v) => update({ perforationSkip: v })}
                  units={units}
                  disabled={!s.perforation}
                />
              </div>
              <p className="hint" style={{ marginTop: 4 }}>
                Tabs / Bridges: use <strong>Tools → Add Tabs</strong> to create cut-out bridges.
              </p>
            </>
          )}

          {(s.mode === 'fill' || s.mode === 'image') && (
            <>
              <div className="grid-3">
                <Field label="Line int.">
                  <NumberField value={s.interval} onChange={(v) => update({ interval: v })} units={units} />
                </Field>
                <Field label="Lines/in">
                  <input className="input narrow" value={linesPerInch.toFixed(1)} readOnly />
                </Field>
                <Field label="Overscan">
                  <NumberField value={s.overscan} onChange={(v) => update({ overscan: v })} units={units} />
                </Field>
                <Field label="Scan angle">
                  <input
                    className="input narrow"
                    type="number"
                    step={15}
                    value={s.angle}
                    onChange={(e) => update({ angle: toNum(e.target.value) })}
                  />
                </Field>
                <Field label="Scan off.">
                  <NumberField
                    value={s.scanOffset}
                    onChange={(v) => update({ scanOffset: v })}
                    units={units}
                  />
                </Field>
                <Field label="Fill grouping">
                  <select
                    className="input"
                    value={s.fillGrouping}
                    onChange={(e) => update({ fillGrouping: e.target.value as FillGrouping })}
                  >
                    <option value="all">All shapes at once</option>
                    <option value="groups">Groups together</option>
                    <option value="individual">Shapes individually</option>
                  </select>
                </Field>
              </div>
              <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={s.bidirectional}
                    onChange={(e) => update({ bidirectional: e.target.checked })}
                  />
                  Bi-directional fill
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={s.crossHatch}
                    onChange={(e) => update({ crossHatch: e.target.checked })}
                  />
                  Cross-hatch
                </label>
              </div>
            </>
          )}

          {s.mode === 'offsetFill' && (
            <div className="grid-3">
              <Field label="Line int.">
                <NumberField value={s.interval} onChange={(v) => update({ interval: v })} units={units} />
              </Field>
              <Field label="Lines/in">
                <input className="input narrow" value={linesPerInch.toFixed(1)} readOnly />
              </Field>
              <Field label="Fill grouping">
                <select
                  className="input"
                  value={s.fillGrouping}
                  onChange={(e) => update({ fillGrouping: e.target.value as FillGrouping })}
                >
                  <option value="all">All shapes at once</option>
                  <option value="groups">Groups together</option>
                  <option value="individual">Shapes individually</option>
                </select>
              </Field>
            </div>
          )}

          {s.mode === 'image' && (
            <>
              <div className="grid-3" style={{ marginTop: 6 }}>
                <Field label="Image mode">
                  <select
                    className="input"
                    value={s.dither}
                    onChange={(e) => update({ dither: e.target.value as DitherMode })}
                  >
                    {(Object.keys(IMAGE_MODE_LABEL) as DitherMode[]).map((m) => (
                      <option key={m} value={m}>
                        {IMAGE_MODE_LABEL[m]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="DPI">
                  <input className="input narrow" value={linesPerInch.toFixed(1)} readOnly />
                </Field>
                <Field label="Dot width">
                  <NumberField
                    value={s.dotWidthCorrection}
                    onChange={(v) => update({ dotWidthCorrection: v })}
                    units={units}
                  />
                </Field>
                <Field label="Angle inc.">
                  <input
                    className="input narrow"
                    type="number"
                    step={15}
                    value={s.angleIncrement}
                    onChange={(e) => update({ angleIncrement: toNum(e.target.value) })}
                  />
                </Field>
                <label className="checkbox" style={{ alignSelf: 'center' }}>
                  <input
                    type="checkbox"
                    checked={s.negative}
                    onChange={(e) => update({ negative: e.target.checked })}
                  />
                  Negative image
                </label>
                <Field label="Cells/in">
                  <input
                    className="input narrow"
                    type="number"
                    min={1}
                    value={s.cellsPerInch}
                    onChange={(e) => update({ cellsPerInch: Math.max(1, toNum(e.target.value)) })}
                  />
                </Field>
                <Field label="Half. angle">
                  <input
                    className="input narrow"
                    type="number"
                    step={15}
                    value={s.halftoneAngle}
                    onChange={(e) => update({ halftoneAngle: toNum(e.target.value) })}
                  />
                </Field>
              </div>
            </>
          )}
        </>
      )}

      {tab === 'advanced' && (
        <>
          <label className="checkbox" style={{ marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={device.laserMode === 'M3'}
              onChange={(e) => store.updateDevice({ laserMode: e.target.checked ? 'M3' : 'M4' })}
            />
            Constant power mode (M3) — off uses variable power (M4)
          </label>
          {s.mode === 'line' && (
            <>
              <div className="grid-3">
                <Field label="Start pause">
                  <input
                    className="input narrow"
                    type="number"
                    min={0}
                    step={50}
                    value={s.startPause}
                    title="Dwell before the cut (ms)"
                    onChange={(e) => update({ startPause: Math.max(0, toNum(e.target.value)) })}
                  />
                </Field>
                <Field label="End pause">
                  <input
                    className="input narrow"
                    type="number"
                    min={0}
                    step={50}
                    value={s.endPause}
                    title="Dwell after the cut (ms)"
                    onChange={(e) => update({ endPause: Math.max(0, toNum(e.target.value)) })}
                  />
                </Field>
                <Field label="Pause pwr">
                  <input
                    className="input narrow"
                    type="number"
                    min={0}
                    max={100}
                    value={s.pausePower}
                    onChange={(e) => update({ pausePower: toNum(e.target.value) })}
                  />
                </Field>
              </div>
              <div style={{ display: 'flex', gap: 14, marginTop: 4 }}>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={s.cutThrough}
                    onChange={(e) => update({ cutThrough: e.target.checked })}
                  />
                  Cut through (laser on during pauses)
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={s.leadIn}
                    onChange={(e) => update({ leadIn: e.target.checked })}
                  />
                  Lead-in
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={s.leadOut}
                    onChange={(e) => update({ leadOut: e.target.checked })}
                  />
                  Lead-out
                </label>
              </div>
              <div className="grid-4" style={{ marginTop: 6 }}>
                <Field label="Overcut">
                  <NumberField value={s.overcut} onChange={(v) => update({ overcut: v })} units={units} />
                </Field>
                <Field label="Lead in">
                  <NumberField
                    value={s.leadInLength}
                    onChange={(v) => update({ leadInLength: v })}
                    units={units}
                  />
                </Field>
                <Field label="Lead out">
                  <NumberField
                    value={s.leadOutLength}
                    onChange={(v) => update({ leadOutLength: v })}
                    units={units}
                  />
                </Field>
                <Field label="Angle">
                  <input
                    className="input narrow"
                    type="number"
                    step={5}
                    value={s.leadAngle}
                    onChange={(e) => update({ leadAngle: toNum(e.target.value) })}
                  />
                </Field>
                <Field label="Style">
                  <select
                    className="input"
                    value={s.leadStyle}
                    onChange={(e) =>
                      update({ leadStyle: e.target.value as 'line' | 'arc' })
                    }
                  >
                    <option value="line">Line</option>
                    <option value="arc">Arc</option>
                  </select>
                </Field>
              </div>
            </>
          )}

          {(s.mode === 'fill' || s.mode === 'image') && (
            <>
              <div className="grid-3">
                <Field label="Ramp length">
                  <NumberField
                    value={s.rampLength}
                    onChange={(v) => update({ rampLength: v })}
                    units={units}
                  />
                </Field>
                <label className="checkbox" style={{ alignSelf: 'center' }}>
                  <input
                    type="checkbox"
                    checked={s.rampOuter}
                    onChange={(e) => update({ rampOuter: e.target.checked })}
                  />
                  Ramp outer edge
                </label>
                {s.mode === 'fill' && (
                  <label className="checkbox" style={{ alignSelf: 'center' }}>
                    <input
                      type="checkbox"
                      checked={s.floodFill}
                      onChange={(e) => update({ floodFill: e.target.checked })}
                    />
                    Flood fill
                  </label>
                )}
              </div>
              {s.mode === 'image' && (
                <label className="checkbox" style={{ marginTop: 6 }}>
                  <input
                    type="checkbox"
                    checked={s.passThrough}
                    onChange={(e) => update({ passThrough: e.target.checked })}
                  />
                  Pass-through (engrave pre-processed images as-is)
                </label>
              )}
            </>
          )}

          <p className="hint" style={{ marginTop: 10 }}>
            <ModeGlyph mode={s.mode} /> {MODE_LABEL[s.mode]} mode.
            {s.mode === 'line'
              ? ' Kerf expands (+) or shrinks (−) closed cuts; overcut extends the start.'
              : ' Interval, angle, cross-hatch and overscan control the raster pattern.'}
          </p>
          <p className="hint">
            Galvo/DSP/Ruida-only options (Frequency, Q-Pulse, PWM override, PPI, U offset, Dot
            mode) are not applicable to GRBL machines.
          </p>
        </>
      )}
    </Modal>
  );
}
