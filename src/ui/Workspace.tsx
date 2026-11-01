import { useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import { store, useAppState } from '@/state/store';
import { requestDiscardConfirmation } from '@/state/discardGuard';
import { dropKindForFile, isTextDrop } from '@/core/dropRouting';
import { mimeForFile, readAsDataUrl } from '@/core/fileApi';
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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
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

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  useEffect(() => {
    // A file dropped outside the canvas would otherwise navigate the window.
    const prevent = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  const handleDrop = async (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (!controller) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const dropped = await Promise.all(
      files.map(async (file) => {
        const electron = window.openburn;
        const path =
          electron?.getFilePath?.(file) ?? (file as File & { path?: string }).path;
        if (path) return { name: file.name, path };
        if (isTextDrop(file.name)) return { name: file.name, text: await file.text() };
        const bytes = new Uint8Array(await file.arrayBuffer());
        return {
          name: file.name,
          dataUrl: await readAsDataUrl(bytes, file.type || mimeForFile(file.name)),
        };
      }),
    );

    const replacesDocument = dropped.some((file) => {
      const kind = dropKindForFile(file.name);
      return kind === 'project' || kind === 'lightburn';
    });
    if (replacesDocument && !(await requestDiscardConfirmation())) return;

    const at = controller.getScenePointFromClient(e.clientX, e.clientY);
    await controller.dropFiles(dropped, at);
  };

  const run = (fn: () => void) => {
    setContextMenu(null);
    fn();
  };

  const hasSelection = !!state.selection;
  const menuX = contextMenu ? Math.min(contextMenu.x, window.innerWidth - 220) : 0;
  const menuY = contextMenu ? Math.min(contextMenu.y, window.innerHeight - 300) : 0;

  return (
    <div
      className="workspace-area"
      ref={wrapRef}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDragging(false);
      }}
      onDrop={(e) => void handleDrop(e)}
    >
      <canvas ref={bgRef} className="bg-canvas" />
      <div className="fabric-host" ref={hostRef}>
        <canvas ref={fabricRef} />
      </div>

      {dragging && <div className="drop-overlay">Drop to open or import</div>}

      {contextMenu && (
        <div
          className="canvas-context-menu"
          style={{ left: menuX, top: menuY }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            disabled={!hasSelection}
            onClick={() => run(() => { controller?.copySelection(); controller?.deleteSelection(); })}
          >
            <span>Cut</span><span className="shortcut">Ctrl+X</span>
          </button>
          <button type="button" disabled={!hasSelection} onClick={() => run(() => controller?.copySelection())}>
            <span>Copy</span><span className="shortcut">Ctrl+C</span>
          </button>
          <button type="button" onClick={() => run(() => void controller?.pasteSmart())}>
            <span>Paste</span><span className="shortcut">Ctrl+V</span>
          </button>
          <button type="button" onClick={() => run(() => void controller?.pasteInPlace())}>
            <span>Paste in place</span><span className="shortcut">Alt+V</span>
          </button>
          <button type="button" onClick={() => run(() => void controller?.pasteFromSystem())}>
            <span>Paste from clipboard</span>
          </button>
          <button type="button" disabled={!hasSelection} onClick={() => run(() => controller?.duplicateSelection())}>
            <span>Duplicate</span><span className="shortcut">Ctrl+D</span>
          </button>
          <div className="ctx-sep" />
          <button type="button" disabled={!hasSelection} onClick={() => run(() => controller?.deleteSelection())}>
            <span>Delete</span><span className="shortcut">Supr</span>
          </button>
          <button type="button" onClick={() => run(() => controller?.selectAll())}>
            <span>Select all</span><span className="shortcut">Ctrl+A</span>
          </button>
        </div>
      )}

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
