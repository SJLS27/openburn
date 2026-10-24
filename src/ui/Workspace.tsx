import { useEffect, useRef, useState } from 'react';
import { store, useAppState } from '@/state/store';
import { WorkspaceController } from '@/workspace/WorkspaceController';
import { Icon } from './icons';
import { ToolButton } from './common';

interface Props {
  onReady: (controller: WorkspaceController | null) => void;
}

export function Workspace({ onReady }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const fabricRef = useRef<HTMLCanvasElement>(null);
  const bgRef = useRef<HTMLCanvasElement>(null);
  const [controller, setController] = useState<WorkspaceController | null>(null);
  const state = useAppState();

  useEffect(() => {
    if (!wrapRef.current || !fabricRef.current || !bgRef.current) return;
    const c = new WorkspaceController(wrapRef.current, fabricRef.current, bgRef.current);
    setController(c);
    onReady(c);
    return () => {
      onReady(null);
      c.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onReset = () => {
      controller?.setStatus('Layout reset to default');
    };
    const onToggleGrid = () => {
      const s = store.getState();
      store.setState({ showGrid: !s.showGrid });
    };
    window.addEventListener('openburn:reset-layout', onReset);
    window.addEventListener('openburn:toggle-grid', onToggleGrid);
    return () => {
      window.removeEventListener('openburn:reset-layout', onReset);
      window.removeEventListener('openburn:toggle-grid', onToggleGrid);
    };
  }, [controller]);

  return (
    <div className="workspace-area" ref={wrapRef}>
      <canvas ref={bgRef} className="bg-canvas" />
      <div className="fabric-host" ref={hostRef}>
        <canvas ref={fabricRef} />
      </div>

      <div className="pages-bar">
        <span className="page-tab active">Page 1</span>
        <button className="page-tab" title="Add page (Phase 3)" disabled>
          +
        </button>
      </div>

      <div className="zoom-overlay">
        <ToolButton icon="zoom-out" title="Zoom out" onClick={() => controller?.zoomBy(0.8)} />
        <span className="zoom-value">{(state.zoom * 100).toFixed(0)}%</span>
        <ToolButton icon="zoom-in" title="Zoom in" onClick={() => controller?.zoomBy(1.25)} />
        <ToolButton icon="zoom-page" title="Zoom to page" onClick={() => controller?.zoomToPage()} />
        <ToolButton icon="zoom-fit" title="Zoom to selection" onClick={() => controller?.zoomToFitSelection()} />
      </div>

      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 10,
          color: 'var(--text-faint)',
          fontSize: 11,
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <Icon name="grid" size={12} />
        <span>
          {state.doc.bed.width} × {state.doc.bed.height} {state.doc.units}
        </span>
      </div>
    </div>
  );
}
