import { store, useAppState } from '@/state/store';
import {
  DEFAULT_OPTIMIZATION,
  type CutOrderKey,
  type DirectionOrder,
  type OptimizationSettings,
} from '@/gcode/types';
import { Modal } from '../common';

const ORDER_LABEL: Record<CutOrderKey, string> = {
  layer: 'Layer',
  group: 'Group',
  priority: 'Priority',
};

const DIRECTION_LABEL: Record<DirectionOrder, string> = {
  none: 'Off',
  topBottom: 'Top to bottom',
  bottomTop: 'Bottom to top',
  leftRight: 'Left to right',
  rightLeft: 'Right to left',
};

/**
 * LightBurn-style Optimization Settings window: cut ordering criteria plus the
 * path optimisations applied by the cut planner.
 */
export function OptimizationDialog({ onClose }: { onClose: () => void }) {
  const state = useAppState();
  const opt = state.optimization;
  const update = (patch: Partial<OptimizationSettings>) => store.updateOptimization(patch);

  const addOrder = (key: CutOrderKey) => {
    const orderBy = [key, ...opt.orderBy.filter((k) => k !== key)];
    update({ orderBy });
  };

  const toggle = (
    key:
      | 'cutInnerFirst'
      | 'reduceTravel'
      | 'reduceDirectionChanges'
      | 'chooseBestStartingPoint'
      | 'chooseCorners'
      | 'chooseBestDirection'
      | 'removeOverlapping',
    label: string,
    title?: string,
  ) => (
    <label className="checkbox" title={title} style={{ marginBottom: 4 }}>
      <input
        type="checkbox"
        checked={opt[key]}
        onChange={(e) => update({ [key]: e.target.checked } as Partial<OptimizationSettings>)}
      />
      {label}
    </label>
  );

  return (
    <Modal
      title="Optimization Settings"
      onClose={onClose}
      width={470}
      footer={
        <>
          <button
            className="btn"
            onClick={() => update({ ...DEFAULT_OPTIMIZATION })}
            title="Restore LightBurn-style defaults"
          >
            Reset to defaults
          </button>
          <button className="btn primary" onClick={onClose}>
            OK
          </button>
        </>
      }
    >
      <label className="checkbox" style={{ marginBottom: 10 }}>
        <input
          type="checkbox"
          checked={opt.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
        />
        <strong>Enable optimization and output re-ordering</strong>
      </label>
      <p className="hint" style={{ marginBottom: 10 }}>
        When off, graphics are output in the order they were created. The device setting
        &quot;Enable cut planner&quot; must also be on for the planner to run.
      </p>

      <h4 style={{ margin: '0 0 6px' }}>Order by</h4>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        {(Object.keys(ORDER_LABEL) as CutOrderKey[]).map((key) => (
          <button
            key={key}
            className={`btn${opt.orderBy[0] === key ? ' primary' : ''}`}
            style={{ flex: 1 }}
            onClick={() => addOrder(key)}
            title={`Sort by ${ORDER_LABEL[key]} (click to make it the first criterion)`}
          >
            {ORDER_LABEL[key]}
          </button>
        ))}
      </div>
      <div className="summary-row" style={{ alignItems: 'flex-start' }}>
        <span className="hint" style={{ flex: 1 }}>
          {opt.orderBy.length === 0
            ? 'No criteria — creation order is preserved.'
            : opt.orderBy.map((k) => ORDER_LABEL[k]).join(' → ')}
        </span>
        {opt.orderBy.length > 1 && (
          <button
            className="btn"
            style={{ height: 20 }}
            onClick={() => update({ orderBy: opt.orderBy.slice(0, 1) })}
            title="Remove the other criteria"
          >
            Remove
          </button>
        )}
      </div>

      <div className="field-row" style={{ marginTop: 8 }}>
        <span className="field-label" style={{ minWidth: 110 }}>
          Direction order
        </span>
        <select
          className="input"
          value={opt.cutInDirectionOrder}
          onChange={(e) => update({ cutInDirectionOrder: e.target.value as DirectionOrder })}
        >
          {(Object.keys(DIRECTION_LABEL) as DirectionOrder[]).map((d) => (
            <option key={d} value={d}>
              {DIRECTION_LABEL[d]}
            </option>
          ))}
        </select>
      </div>

      <h4 style={{ margin: '12px 0 6px' }}>Optimizations</h4>
      {toggle('cutInnerFirst', 'Cut inner shapes first', 'Cut nested shapes before the outer shape')}
      {toggle('reduceTravel', 'Reduce travel moves', 'Nearest-neighbour ordering with local search')}
      {toggle(
        'reduceDirectionChanges',
        'Reduce direction changes',
        'Prefer continuing in the same direction',
      )}
      {toggle('chooseBestStartingPoint', 'Choose best starting point', 'Start closed cuts at the nearest point')}
      {toggle('chooseCorners', 'Choose corners, if possible', 'Prefer starting at sharp corners')}
      {toggle('chooseBestDirection', 'Choose best direction', 'Reverse open cuts when it shortens travel')}
      {toggle(
        'removeOverlapping',
        'Remove overlapping lines',
        'Skip duplicate geometry that would be cut twice',
      )}
      {opt.removeOverlapping && (
        <div className="field-row" style={{ marginLeft: 18, marginTop: 2 }}>
          <span className="field-label">Tolerance</span>
          <input
            className="input narrow"
            type="number"
            min={0}
            step={0.01}
            value={opt.overlapTolerance}
            onChange={(e) => update({ overlapTolerance: Number(e.target.value) || 0 })}
          />
          <span className="hint">mm</span>
        </div>
      )}

      <p className="hint" style={{ marginTop: 10 }}>
        Run <strong>Preview</strong> (Alt+P) to see the resulting machine path and travel moves.
      </p>
    </Modal>
  );
}
