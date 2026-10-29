import { useEffect, useState } from 'react';
import { store, useAppState, type ToolId } from '@/state/store';
import { Icon } from './icons';
import { NumberField, ToolButton, useUnits, useWorkspace } from './common';

export function MainToolbar() {
  const ws = useWorkspace();
  const state = useAppState();
  return (
    <div className="tb-group">
      <ToolButton icon="new" title="New (Ctrl+N)" onClick={() => ws?.newDocument()} />
      <ToolButton icon="open" title="Open (Ctrl+O)" onClick={() => void ws?.openDocument()} />
      <ToolButton icon="save" title="Save (Ctrl+S)" onClick={() => void ws?.saveDocument()} />
      <ToolButton icon="import" title="Import artwork (Ctrl+I)" onClick={() => void ws?.importFile()} />
      <div className="tb-sep" />
      <ToolButton icon="undo" title="Undo (Ctrl+Z)" disabled={!state.canUndo} onClick={() => ws?.undo()} />
      <ToolButton icon="redo" title="Redo (Ctrl+Y)" disabled={!state.canRedo} onClick={() => ws?.redo()} />
      <div className="tb-sep" />
      <ToolButton icon="copy" title="Copy (Ctrl+C)" onClick={() => ws?.copySelection()} />
      <ToolButton icon="cut" title="Cut (Ctrl+X)" onClick={() => { ws?.copySelection(); ws?.deleteSelection(); }} />
      <ToolButton icon="paste" title="Paste (Ctrl+V)" onClick={() => void ws?.pasteSmart()} />
      <ToolButton icon="delete" title="Delete" onClick={() => ws?.deleteSelection()} />
      <div className="tb-sep" />
      <ToolButton icon="pan" title="Pan view (Space / middle mouse)" active={state.tool === 'pan'} onClick={() => setTool('pan')} />
      <div className="tb-sep" />
      <ToolButton icon="zoom-page" title="Zoom to page" onClick={() => ws?.zoomToPage()} />
      <ToolButton icon="zoom-fit" title="Zoom to selection" onClick={() => ws?.zoomToFitSelection()} />
      <div className="tb-sep" />
      <ToolButton icon="preview" title="Preview (Alt+P)" onClick={() => window.dispatchEvent(new CustomEvent('openburn:preview'))} />
      <ToolButton icon="settings" title="Settings" onClick={() => window.dispatchEvent(new CustomEvent('openburn:settings'))} />
      <ToolButton icon="device" title="Device Settings" onClick={() => window.dispatchEvent(new CustomEvent('openburn:device-settings'))} />
    </div>
  );
}

export function ArrangeToolbar() {
  const ws = useWorkspace();
  const state = useAppState();
  const disabled = !state.selection;
  return (
    <div className="tb-group">
      <span className="tb-label">Align</span>
      <ToolButton icon="align-left" title="Align left" disabled={disabled} onClick={() => ws?.align('left')} />
      <ToolButton icon="align-hcenter" title="Align horizontal center" disabled={disabled} onClick={() => ws?.align('hcenter')} />
      <ToolButton icon="align-right" title="Align right" disabled={disabled} onClick={() => ws?.align('right')} />
      <ToolButton icon="align-top" title="Align top" disabled={disabled} onClick={() => ws?.align('top')} />
      <ToolButton icon="align-vcenter" title="Align vertical center" disabled={disabled} onClick={() => ws?.align('vcenter')} />
      <ToolButton icon="align-bottom" title="Align bottom" disabled={disabled} onClick={() => ws?.align('bottom')} />
      <div className="tb-sep" />
      <ToolButton icon="distribute-h" title="Distribute horizontally" disabled={(state.selection?.count ?? 0) < 3} onClick={() => ws?.distribute('h')} />
      <ToolButton icon="distribute-v" title="Distribute vertically" disabled={(state.selection?.count ?? 0) < 3} onClick={() => ws?.distribute('v')} />
      <div className="tb-sep" />
      <ToolButton icon="group" title="Group (Ctrl+G)" disabled={(state.selection?.count ?? 0) < 2} onClick={() => ws?.group()} />
      <ToolButton icon="ungroup" title="Ungroup (Ctrl+U)" disabled={disabled} onClick={() => ws?.ungroup()} />
    </div>
  );
}

export function NumericToolbar() {
  const ws = useWorkspace();
  const units = useUnits();
  const state = useAppState();
  const sel = state.selection;
  const [locked, setLocked] = useState(true);

  return (
    <div className="tb-group">
      <span className="tb-label">X</span>
      <NumberField
        units={units}
        value={sel?.x ?? 0}
        disabled={!sel}
        onChange={(v) => ws?.applyNumeric({ x: v })}
        className="input tiny"
      />
      <span className="tb-label">Y</span>
      <NumberField
        units={units}
        value={sel?.y ?? 0}
        disabled={!sel}
        onChange={(v) => ws?.applyNumeric({ y: v })}
        className="input tiny"
      />
      <div className="tb-sep" />
      <span className="tb-label">W</span>
      <NumberField
        units={units}
        value={sel?.width ?? 0}
        disabled={!sel}
        onChange={(v) => {
          if (!sel) return;
          if (locked && sel.width > 0) {
            ws?.applyNumeric({ width: v, height: sel.height * (v / sel.width) });
          } else {
            ws?.applyNumeric({ width: v });
          }
        }}
        className="input tiny"
      />
      <span className="tb-label">H</span>
      <NumberField
        units={units}
        value={sel?.height ?? 0}
        disabled={!sel}
        onChange={(v) => {
          if (!sel) return;
          if (locked && sel.height > 0) {
            ws?.applyNumeric({ height: v, width: sel.width * (v / sel.height) });
          } else {
            ws?.applyNumeric({ height: v });
          }
        }}
        className="input tiny"
      />
      <button
        type="button"
        className={`tb-btn${locked ? ' active' : ''}`}
        title={locked ? 'Aspect ratio locked' : 'Aspect ratio unlocked'}
        onClick={() => setLocked((v) => !v)}
      >
        <Icon name={locked ? 'lock' : 'unlock'} size={14} />
      </button>
      <div className="tb-sep" />
      <span className="tb-label">∠</span>
      <NumberField
        units="mm"
        decimals={1}
        value={sel?.angle ?? 0}
        disabled={!sel}
        onChange={(v) => ws?.applyNumeric({ angle: v })}
        className="input tiny"
        title="Rotation (degrees)"
      />
      <span className="tb-label">°</span>
      <div className="tb-sep" />
      <ToolButton icon="mirror-h" title="Flip horizontally" disabled={!sel} onClick={() => ws?.flip('h')} />
      <ToolButton icon="mirror-v" title="Flip vertically" disabled={!sel} onClick={() => ws?.flip('v')} />
      <ToolButton icon="rotary" title="Rotate 90°" disabled={!sel} onClick={() => ws?.rotate(90)} />
    </div>
  );
}

const FONTS = [
  'Inter',
  'Arial',
  'Helvetica',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Verdana',
  'Trebuchet MS',
];

export function TextToolbar() {
  const ws = useWorkspace();
  const [family, setFamily] = useState('Inter');
  const [size, setSize] = useState(10);
  const [spacing, setSpacing] = useState(0);
  const [lineHeight, setLineHeight] = useState(1.1);

  useEffect(() => {
    // defaults stay local; applied when the user changes a value
  }, []);

  return (
    <div className="tb-group">
      <span className="tb-label">Text</span>
      <select
        className="input"
        style={{ width: 88, height: 22 }}
        title="Outline conversion (Convert to Path) currently uses Inter"
        value={family}
        onChange={(e) => {
          setFamily(e.target.value);
          ws?.applyTextStyle({ fontFamily: e.target.value });
        }}
      >
        {FONTS.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      <input
        className="input tiny"
        type="number"
        step={0.5}
        min={1}
        value={size}
        title="Font size (mm)"
        onChange={(e) => {
          const v = Number(e.target.value);
          setSize(v);
          if (Number.isFinite(v) && v > 0) ws?.applyTextStyle({ fontSize: v });
        }}
      />
      <input
        className="input tiny"
        type="number"
        step={0.1}
        style={{ width: 34, flex: '0 0 34px' }}
        value={spacing}
        title="Character spacing"
        onChange={(e) => {
          const v = Number(e.target.value);
          setSpacing(v);
          ws?.applyTextStyle({ charSpacing: v });
        }}
      />
      <input
        className="input tiny"
        type="number"
        step={0.1}
        min={0.5}
        style={{ width: 44, flex: '0 0 44px' }}
        value={lineHeight}
        title="Line height"
        onChange={(e) => {
          const v = Number(e.target.value);
          setLineHeight(v);
          ws?.applyTextStyle({ lineHeight: v });
        }}
      />
      <ToolButton icon="text" title="Bold" onClick={() => ws?.applyTextStyle({ bold: true })} />
      <ToolButton icon="text" title="Italic" onClick={() => ws?.applyTextStyle({ italic: true })} />
    </div>
  );
}

export function ModesToolbar() {
  return (
    <div className="tb-group">
      <span className="tb-label">Modes</span>
      <ToolButton icon="rotary" title="Rotary mode (Phase 3)" disabled />
      <ToolButton icon="print-cut" title="Print and Cut (Phase 3)" disabled />
      <ToolButton icon="repeat" title="Repeat marking (Phase 3)" disabled />
      <ToolButton icon="frame" title="Framing (Phase 2)" disabled />
    </div>
  );
}

export function LeftToolbar() {
  const state = useAppState();
  const ws = useWorkspace();

  return (
    <div className="toolbar-left">
      <ToolButton icon="select" title="Select (S)" active={state.tool === 'select'} onClick={() => setTool('select')} />
      <ToolButton icon="node" title="Edit nodes (N)" active={state.tool === 'node'} onClick={() => setTool('node')} />
      <div className="tb-sep" />
      <ToolButton icon="line" title="Line (L)" active={state.tool === 'line'} onClick={() => setTool('line')} />
      <ToolButton icon="rect" title="Rectangle (R)" active={state.tool === 'rect'} onClick={() => setTool('rect')} />
      <ToolButton icon="rounded-rect" title="Rounded rectangle" active={state.tool === 'roundedRect'} onClick={() => setTool('roundedRect')} />
      <ToolButton icon="ellipse" title="Ellipse (E)" active={state.tool === 'ellipse'} onClick={() => setTool('ellipse')} />
      <ToolButton icon="polygon" title="Polygon (P)" active={state.tool === 'polygon'} onClick={() => setTool('polygon')} />
      <ToolButton icon="text" title="Text (T)" active={state.tool === 'text'} onClick={() => setTool('text')} />
      <ToolButton icon="measure" title="Measure" active={state.tool === 'measure'} onClick={() => setTool('measure')} />
      <div className="tb-sep" />
      <ToolButton icon="union" title="Boolean union" onClick={() => ws?.booleanOp('union')} />
      <ToolButton icon="subtract" title="Boolean subtract" onClick={() => ws?.booleanOp('subtract')} />
      <ToolButton icon="intersect" title="Boolean intersect" onClick={() => ws?.booleanOp('intersect')} />
      <ToolButton icon="exclude" title="Boolean exclude" onClick={() => ws?.booleanOp('exclude')} />
      <div className="tb-sep" />
      <ToolButton icon="offset" title="Offset shapes" onClick={() => window.dispatchEvent(new CustomEvent('openburn:offset'))} />
      <ToolButton icon="array-grid" title="Grid array" onClick={() => window.dispatchEvent(new CustomEvent('openburn:array-grid'))} />
      <ToolButton icon="array-circle" title="Circular array" onClick={() => window.dispatchEvent(new CustomEvent('openburn:array-circular'))} />
      <div className="tb-sep" />
      <ToolButton icon="pan" title="Pan (Space)" active={state.tool === 'pan'} onClick={() => setTool('pan')} />
    </div>
  );
}

function setTool(tool: ToolId) {
  store.setState({ tool });
}
