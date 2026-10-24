import { useEffect, useRef, useState } from 'react';
import { useAppState, store, type ToolId, type WorkspaceApi } from '@/state/store';
import { Icon } from './icons';
import { Modal, NumberField, useUnits, useWorkspace } from './common';
import { ImageAdjustDialog, TabsDialog, TraceDialog } from './ImageToolsDialogs';

type DialogKind =
  | 'offset'
  | 'grid'
  | 'circular'
  | 'about'
  | 'material'
  | 'interval'
  | 'image-adjust'
  | 'trace'
  | 'tabs';

interface MenuEntry {
  label?: string;
  shortcut?: string;
  action?: () => void;
  dialog?: DialogKind;
  disabled?: boolean;
  separator?: boolean;
}

interface MenuContext {
  ws: WorkspaceApi | null;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  selectionCount: number;
  setTool: (tool: ToolId) => void;
}

interface MenuDef {
  label: string;
  entries: (ctx: MenuContext) => MenuEntry[];
}

const MENUS: MenuDef[] = [
  {
    label: 'File',
    entries: ({ ws }) => [
      { label: 'New', shortcut: 'Ctrl+N', action: () => ws?.newDocument() },
      { label: 'Open…', shortcut: 'Ctrl+O', action: () => void ws?.openDocument() },
      { label: 'Open LightBurn Project…', action: () => void ws?.openLightBurn() },
      { label: 'Save', shortcut: 'Ctrl+S', action: () => void ws?.saveDocument() },
      { label: 'Save As…', shortcut: 'Ctrl+Shift+S', action: () => void ws?.saveDocument(true) },
      { separator: true },
      { label: 'Import…', shortcut: 'Ctrl+I', action: () => void ws?.importFile() },
      { label: 'Export SVG…', action: () => void ws?.exportSvg() },
      { label: 'Export GCode…', shortcut: 'Ctrl+E', action: () => void ws?.exportGcode(false) },
      { label: 'Export LightBurn (.lbrn)…', action: () => void ws?.saveLightBurn('lbrn') },
      { label: 'Export LightBurn 2 (.lbrn2)…', action: () => void ws?.saveLightBurn('lbrn2') },
      { separator: true },
      { label: 'Preview', shortcut: 'Alt+P', action: () => window.dispatchEvent(new CustomEvent('openburn:preview')) },
      { label: 'Print', disabled: true },
      { separator: true },
      { label: 'Exit', disabled: true },
    ],
  },
  {
    label: 'Edit',
    entries: ({ ws, canUndo, canRedo, hasSelection }) => [
      { label: 'Undo', shortcut: 'Ctrl+Z', disabled: !canUndo, action: () => ws?.undo() },
      { label: 'Redo', shortcut: 'Ctrl+Y', disabled: !canRedo, action: () => ws?.redo() },
      { separator: true },
      {
        label: 'Cut',
        shortcut: 'Ctrl+X',
        disabled: !hasSelection,
        action: () => {
          ws?.copySelection();
          ws?.deleteSelection();
        },
      },
      { label: 'Copy', shortcut: 'Ctrl+C', disabled: !hasSelection, action: () => ws?.copySelection() },
      { label: 'Paste', shortcut: 'Ctrl+V', action: () => void ws?.pasteClipboard() },
      { label: 'Duplicate', shortcut: 'Ctrl+D', disabled: !hasSelection, action: () => ws?.duplicateSelection() },
      { label: 'Delete', shortcut: 'Del', disabled: !hasSelection, action: () => ws?.deleteSelection() },
      { separator: true },
      { label: 'Select All', shortcut: 'Ctrl+A', action: () => ws?.selectAll() },
    ],
  },
  {
    label: 'Arrange',
    entries: ({ ws, hasSelection, selectionCount }) => [
      { label: 'Align Left', action: () => ws?.align('left'), disabled: !hasSelection },
      { label: 'Align Center (H)', action: () => ws?.align('hcenter'), disabled: !hasSelection },
      { label: 'Align Right', action: () => ws?.align('right'), disabled: !hasSelection },
      { label: 'Align Top', action: () => ws?.align('top'), disabled: !hasSelection },
      { label: 'Align Center (V)', action: () => ws?.align('vcenter'), disabled: !hasSelection },
      { label: 'Align Bottom', action: () => ws?.align('bottom'), disabled: !hasSelection },
      { separator: true },
      { label: 'Center on Page', action: () => ws?.align('centerPage'), disabled: !hasSelection },
      { separator: true },
      { label: 'Group', shortcut: 'Ctrl+G', action: () => ws?.group(), disabled: selectionCount < 2 },
      { label: 'Ungroup', shortcut: 'Ctrl+Shift+G', action: () => ws?.ungroup(), disabled: !hasSelection },
      { separator: true },
      { label: 'Flip Horizontal', action: () => ws?.flip('h'), disabled: !hasSelection },
      { label: 'Flip Vertical', action: () => ws?.flip('v'), disabled: !hasSelection },
      { label: 'Rotate 90° CW', action: () => ws?.rotate(90), disabled: !hasSelection },
      { label: 'Rotate 90° CCW', action: () => ws?.rotate(-90), disabled: !hasSelection },
      { separator: true },
      { label: 'Distribute Horizontally', action: () => ws?.distribute('h'), disabled: selectionCount < 3 },
      { label: 'Distribute Vertically', action: () => ws?.distribute('v'), disabled: selectionCount < 3 },
      { separator: true },
      { label: 'Bring to Front', action: () => ws?.bringToFront(), disabled: !hasSelection },
      { label: 'Send to Back', action: () => ws?.sendToBack(), disabled: !hasSelection },
    ],
  },
  {
    label: 'Tools',
    entries: ({ ws, setTool }) => [
      { label: 'Draw Line', action: () => setTool('line') },
      { label: 'Draw Rectangle', action: () => setTool('rect') },
      { label: 'Draw Ellipse', action: () => setTool('ellipse') },
      { label: 'Draw Polygon', action: () => setTool('polygon') },
      { label: 'Draw Text', action: () => setTool('text') },
      { label: 'Measure', action: () => setTool('measure') },
      { separator: true },
      { label: 'Convert to Path', action: () => void ws?.convertToPath() },
      { label: 'Close Path', action: () => ws?.closePath() },
      { separator: true },
      { label: 'Boolean Union', action: () => ws?.booleanOp('union') },
      { label: 'Boolean Subtract', action: () => ws?.booleanOp('subtract') },
      { label: 'Boolean Intersect', action: () => ws?.booleanOp('intersect') },
      { label: 'Boolean Exclude', action: () => ws?.booleanOp('exclude') },
      { separator: true },
      { label: 'Offset Shapes…', dialog: 'offset' },
      { label: 'Grid Array…', dialog: 'grid' },
      { label: 'Circular Array…', dialog: 'circular' },
      { separator: true },
      { label: 'Material Test…', dialog: 'material' },
      { label: 'Interval Test…', dialog: 'interval' },
      { separator: true },
      { label: 'Adjust Image…', dialog: 'image-adjust' },
      { label: 'Trace Image…', dialog: 'trace' },
      { label: 'Add Tabs…', dialog: 'tabs' },
      { separator: true },
      { label: 'Edit Nodes', disabled: true, shortcut: 'Soon' },
    ],
  },
  {
    label: 'Window',
    entries: () => [
      { label: 'Reset to Default Layout', action: () => window.dispatchEvent(new CustomEvent('openburn:reset-layout')) },
      { label: 'Toggle Grid', action: () => window.dispatchEvent(new CustomEvent('openburn:toggle-grid')) },
      { separator: true },
      { label: 'Cuts / Layers', action: () => scrollPanel('cuts') },
      { label: 'Shape Properties', action: () => scrollPanel('shape') },
      { label: 'Color Palette', action: () => scrollPanel('palette') },
      { label: 'Material Library', action: () => scrollPanel('material') },
    ],
  },
  {
    label: 'Help',
    entries: () => [
      { label: 'Help and Notes', disabled: true, shortcut: 'F1' },
      { separator: true },
      { label: 'About OpenBurn', dialog: 'about' },
    ],
  },
];

function scrollPanel(id: string) {
  document.getElementById(`panel-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function MenuBar() {
  const state = useAppState();
  const units = useUnits();
  const ws = useWorkspace();
  const [open, setOpen] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const [offsetDistance, setOffsetDistance] = useState(0.2);
  const [gridRows, setGridRows] = useState(2);
  const [gridCols, setGridCols] = useState(2);
  const [gridDx, setGridDx] = useState(20);
  const [gridDy, setGridDy] = useState(20);
  const [circCount, setCircCount] = useState(6);
  const [circRadius, setCircRadius] = useState(30);
  const [circStart, setCircStart] = useState(0);

  const [matPowerMin, setMatPowerMin] = useState(10);
  const [matPowerMax, setMatPowerMax] = useState(100);
  const [matPowerSteps, setMatPowerSteps] = useState(5);
  const [matSpeedMin, setMatSpeedMin] = useState(10);
  const [matSpeedMax, setMatSpeedMax] = useState(100);
  const [matSpeedSteps, setMatSpeedSteps] = useState(5);
  const [matCell, setMatCell] = useState(12);
  const [matGap, setMatGap] = useState(3);
  const [matMode, setMatMode] = useState<'line' | 'fill'>('line');
  const [matPasses, setMatPasses] = useState(1);
  const [matInterval, setMatInterval] = useState(0.1);
  const [matLabels, setMatLabels] = useState(true);

  const [intMin, setIntMin] = useState(0.05);
  const [intMax, setIntMax] = useState(0.3);
  const [intSteps, setIntSteps] = useState(6);
  const [intCell, setIntCell] = useState(12);
  const [intSpeed, setIntSpeed] = useState(50);
  const [intPower, setIntPower] = useState(40);
  const [intLabels, setIntLabels] = useState(true);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    const onAbout = () => setDialog('about');
    const onOffset = () => setDialog('offset');
    const onGrid = () => setDialog('grid');
    const onCircular = () => setDialog('circular');
    window.addEventListener('openburn:about', onAbout);
    window.addEventListener('openburn:offset', onOffset);
    window.addEventListener('openburn:array-grid', onGrid);
    window.addEventListener('openburn:array-circular', onCircular);
    return () => {
      window.removeEventListener('openburn:about', onAbout);
      window.removeEventListener('openburn:offset', onOffset);
      window.removeEventListener('openburn:array-grid', onGrid);
      window.removeEventListener('openburn:array-circular', onCircular);
    };
  }, []);

  const ctx: MenuContext = {
    ws,
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    hasSelection: !!state.selection && state.selection.count > 0,
    selectionCount: state.selection?.count ?? 0,
    setTool: (tool) => store.setState({ tool }),
  };

  return (
    <div className="menubar" ref={rootRef}>
      <div className="app-logo">
        <Icon name="flame" size={16} className="flame" />
        <span>OpenBurn</span>
      </div>

      {MENUS.map((menu) => {
        const isOpen = open === menu.label;
        return (
          <div key={menu.label} style={{ position: 'relative' }}>
            <button
              type="button"
              className={`menu-item${isOpen ? ' open' : ''}`}
              onClick={() => setOpen(isOpen ? null : menu.label)}
              onMouseEnter={() => open && setOpen(menu.label)}
            >
              {menu.label}
            </button>
            {isOpen && (
              <div className="menu-dropdown">
                {menu.entries(ctx).map((entry, i) =>
                  entry.separator ? (
                    <div className="menu-sep" key={`sep-${i}`} />
                  ) : (
                    <button
                      key={entry.label}
                      type="button"
                      className={`menu-entry${entry.disabled ? ' disabled' : ''}`}
                      disabled={entry.disabled}
                      onClick={() => {
                        setOpen(null);
                        entry.action?.();
                        if (entry.dialog) setDialog(entry.dialog);
                      }}
                    >
                      <span>{entry.label}</span>
                      {entry.shortcut && <span className="shortcut">{entry.shortcut}</span>}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        );
      })}

      {dialog === 'offset' && (
        <Modal
          title="Offset Shapes"
          onClose={() => setDialog(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDialog(null)}>Cancel</button>
              <button
                className="btn primary"
                onClick={() => {
                  ws?.offsetShapes(offsetDistance);
                  setDialog(null);
                }}
              >
                Offset
              </button>
            </>
          }
        >
          <div className="field-row">
            <span className="field-label">Distance</span>
            <NumberField value={offsetDistance} onChange={setOffsetDistance} units={units} />
            <span className="hint">{units}</span>
          </div>
          <p className="hint">
            Positive distances expand the outline, negative distances shrink it. Text must be
            converted to a path first.
          </p>
        </Modal>
      )}

      {(dialog === 'grid' || dialog === 'circular') && (
        <Modal
          title={dialog === 'grid' ? 'Grid Array' : 'Circular Array'}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDialog(null)}>Cancel</button>
              <button
                className="btn primary"
                onClick={() => {
                  if (dialog === 'grid') ws?.arrayGrid(gridRows, gridCols, gridDx, gridDy);
                  else ws?.arrayCircular(circCount, circRadius, circStart);
                  setDialog(null);
                }}
              >
                Create
              </button>
            </>
          }
        >
          {dialog === 'grid' ? (
            <>
              <div className="field-row">
                <span className="field-label">Rows</span>
                <input
                  className="input narrow"
                  type="number"
                  min={1}
                  value={gridRows}
                  onChange={(e) => setGridRows(Number(e.target.value))}
                />
                <span className="field-label">Cols</span>
                <input
                  className="input narrow"
                  type="number"
                  min={1}
                  value={gridCols}
                  onChange={(e) => setGridCols(Number(e.target.value))}
                />
              </div>
              <div className="field-row">
                <span className="field-label">ΔX</span>
                <NumberField value={gridDx} onChange={setGridDx} units={units} />
                <span className="field-label">ΔY</span>
                <NumberField value={gridDy} onChange={setGridDy} units={units} />
              </div>
            </>
          ) : (
            <>
              <div className="field-row">
                <span className="field-label">Count</span>
                <input
                  className="input narrow"
                  type="number"
                  min={2}
                  value={circCount}
                  onChange={(e) => setCircCount(Number(e.target.value))}
                />
              </div>
              <div className="field-row">
                <span className="field-label">Radius</span>
                <NumberField value={circRadius} onChange={setCircRadius} units={units} />
              </div>
              <div className="field-row">
                <span className="field-label">Start</span>
                <input
                  className="input narrow"
                  type="number"
                  value={circStart}
                  onChange={(e) => setCircStart(Number(e.target.value))}
                />
                <span className="hint">deg</span>
              </div>
            </>
          )}
        </Modal>
      )}

      {(dialog === 'material' || dialog === 'interval') && (
        <Modal
          title={dialog === 'material' ? 'Material Test' : 'Interval Test'}
          onClose={() => setDialog(null)}
          width={dialog === 'material' ? 520 : 460}
          footer={
            <>
              <button className="btn" onClick={() => setDialog(null)}>Cancel</button>
              <button
                className="btn primary"
                onClick={() => {
                  if (dialog === 'material') {
                    ws?.generateMaterialTest({
                      powerMin: matPowerMin,
                      powerMax: matPowerMax,
                      powerSteps: matPowerSteps,
                      speedMin: matSpeedMin,
                      speedMax: matSpeedMax,
                      speedSteps: matSpeedSteps,
                      cellSize: matCell,
                      gap: matGap,
                      mode: matMode,
                      passes: matPasses,
                      interval: matInterval,
                      labels: matLabels,
                    });
                  } else {
                    ws?.generateIntervalTest({
                      intervalMin: intMin,
                      intervalMax: intMax,
                      steps: intSteps,
                      cellSize: intCell,
                      speed: intSpeed,
                      power: intPower,
                      labels: intLabels,
                    });
                  }
                  setDialog(null);
                }}
              >
                Create test grid
              </button>
            </>
          }
        >
          {dialog === 'material' ? (
            <>
              <h4 style={{ margin: '0 0 6px' }}>Power (%)</h4>
              <div className="field-row">
                <span className="field-label">Min</span>
                <input className="input narrow" type="number" value={matPowerMin} onChange={(e) => setMatPowerMin(Number(e.target.value))} />
                <span className="field-label">Max</span>
                <input className="input narrow" type="number" value={matPowerMax} onChange={(e) => setMatPowerMax(Number(e.target.value))} />
                <span className="field-label">Steps</span>
                <input className="input narrow" type="number" min={1} max={12} value={matPowerSteps} onChange={(e) => setMatPowerSteps(Number(e.target.value))} />
              </div>
              <h4 style={{ margin: '10px 0 6px' }}>Speed (mm/s)</h4>
              <div className="field-row">
                <span className="field-label">Min</span>
                <input className="input narrow" type="number" value={matSpeedMin} onChange={(e) => setMatSpeedMin(Number(e.target.value))} />
                <span className="field-label">Max</span>
                <input className="input narrow" type="number" value={matSpeedMax} onChange={(e) => setMatSpeedMax(Number(e.target.value))} />
                <span className="field-label">Steps</span>
                <input className="input narrow" type="number" min={1} max={12} value={matSpeedSteps} onChange={(e) => setMatSpeedSteps(Number(e.target.value))} />
              </div>
              <h4 style={{ margin: '10px 0 6px' }}>Layout &amp; cut</h4>
              <div className="field-row">
                <span className="field-label">Cell</span>
                <NumberField value={matCell} onChange={setMatCell} units={units} />
                <span className="field-label">Gap</span>
                <NumberField value={matGap} onChange={setMatGap} units={units} />
                <span className="field-label">Mode</span>
                <select className="input narrow" value={matMode} onChange={(e) => setMatMode(e.target.value as 'line' | 'fill')}>
                  <option value="line">Line</option>
                  <option value="fill">Fill</option>
                </select>
              </div>
              <div className="field-row">
                <span className="field-label">Passes</span>
                <input className="input narrow" type="number" min={1} value={matPasses} onChange={(e) => setMatPasses(Number(e.target.value))} />
                <span className="field-label">Int.</span>
                <NumberField value={matInterval} onChange={setMatInterval} units={units} />
                <label className="checkbox">
                  <input type="checkbox" checked={matLabels} onChange={(e) => setMatLabels(e.target.checked)} />
                  Labels
                </label>
              </div>
              <p className="hint" style={{ marginTop: 8 }}>
                Creates {Math.max(1, Math.min(12, Math.round(matPowerSteps)))} ×{' '}
                {Math.max(1, Math.min(12, Math.round(matSpeedSteps)))} squares on the active layer.
                Each cell carries its own speed/power override; labels go on a non-output NOTES layer.
              </p>
            </>
          ) : (
            <>
              <div className="field-row">
                <span className="field-label">Min</span>
                <NumberField value={intMin} onChange={setIntMin} units={units} />
                <span className="field-label">Max</span>
                <NumberField value={intMax} onChange={setIntMax} units={units} />
                <span className="field-label">Steps</span>
                <input className="input narrow" type="number" min={1} max={10} value={intSteps} onChange={(e) => setIntSteps(Number(e.target.value))} />
              </div>
              <div className="field-row">
                <span className="field-label">Cell</span>
                <NumberField value={intCell} onChange={setIntCell} units={units} />
                <span className="field-label">Speed</span>
                <input className="input narrow" type="number" value={intSpeed} onChange={(e) => setIntSpeed(Number(e.target.value))} />
                <span className="field-label">Power</span>
                <input className="input narrow" type="number" value={intPower} onChange={(e) => setIntPower(Number(e.target.value))} />
              </div>
              <label className="checkbox" style={{ marginTop: 6 }}>
                <input type="checkbox" checked={intLabels} onChange={(e) => setIntLabels(e.target.checked)} />
                Labels
              </label>
              <p className="hint" style={{ marginTop: 8 }}>
                Creates {Math.max(1, Math.min(10, Math.round(intSteps)))} filled patches at increasing
                line intervals to find the right scan spacing for this material.
              </p>
            </>
          )}
        </Modal>
      )}

      {dialog === 'image-adjust' && <ImageAdjustDialog onClose={() => setDialog(null)} />}
      {dialog === 'trace' && <TraceDialog onClose={() => setDialog(null)} />}
      {dialog === 'tabs' && <TabsDialog onClose={() => setDialog(null)} />}

      {dialog === 'about' && (
        <Modal title="About OpenBurn" onClose={() => setDialog(null)} width={420}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <Icon name="flame" size={40} style={{ color: 'var(--accent)' }} />
            <div>
              <h3 style={{ margin: '0 0 6px' }}>OpenBurn 0.5.2</h3>
              <p className="hint" style={{ margin: 0 }}>
                Open-source laser cutting &amp; engraving software inspired by the LightBurn
                workflow. Built with Electron, React, Fabric.js and a GRBL controller. Not
                affiliated with LightBurn Software Inc.
              </p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
