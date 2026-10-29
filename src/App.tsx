import { useEffect, useState } from 'react';
import { store, useAppState } from '@/state/store';
import type { WorkspaceController } from '@/workspace/WorkspaceController';
import { MenuBar } from '@/ui/MenuBar';
import {
  ArrangeToolbar,
  LeftToolbar,
  MainToolbar,
  ModesToolbar,
  NumericToolbar,
  TextToolbar,
} from '@/ui/Toolbars';
import { Workspace } from '@/ui/Workspace';
import { RightDock } from '@/ui/panels/RightDock';
import { StatusBar } from '@/ui/StatusBar';
import { Modal, NumberField, UnitsContext, WorkspaceContext } from '@/ui/common';
import { PreviewDialog } from '@/ui/PreviewDialog';
import { UpdateBanner, UpdateDialog } from '@/ui/UpdateDialog';
import { checkForUpdates } from '@/state/updateStore';
import { machine, useMachineSelector } from '@/serial/machine';
import type { JobPlan } from '@/gcode/types';

export default function App() {
  const state = useAppState();
  const [controller, setController] = useState<WorkspaceController | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [layoutKey, setLayoutKey] = useState(0);
  const [previewPlan, setPreviewPlan] = useState<JobPlan | null>(null);
  const [updateOpen, setUpdateOpen] = useState(false);
  const machineConnected = useMachineSelector((s) => s.connected);
  const machineName = useMachineSelector((s) => s.transportName);

  useEffect(() => {
    const onSettings = () => setSettingsOpen(true);
    const onDevice = () => setDeviceOpen(true);
    const onReset = () => setLayoutKey((k) => k + 1);
    window.addEventListener('openburn:settings', onSettings);
    window.addEventListener('openburn:device-settings', onDevice);
    window.addEventListener('openburn:reset-layout', onReset);
    return () => {
      window.removeEventListener('openburn:settings', onSettings);
      window.removeEventListener('openburn:device-settings', onDevice);
      window.removeEventListener('openburn:reset-layout', onReset);
    };
  }, []);

  useEffect(() => {
    const onCheckUpdates = () => {
      setUpdateOpen(true);
      void checkForUpdates(true);
    };
    const onOpenDialog = () => setUpdateOpen(true);
    window.addEventListener('openburn:check-updates', onCheckUpdates);
    window.addEventListener('openburn:update-dialog-open', onOpenDialog);
    return () => {
      window.removeEventListener('openburn:check-updates', onCheckUpdates);
      window.removeEventListener('openburn:update-dialog-open', onOpenDialog);
    };
  }, []);

  useEffect(() => {
    const onPreview = () => {
      if (!controller) return;
      controller.setStatus('Generating toolpath preview…');
      window.setTimeout(async () => {
        try {
          const plan = await controller.generateJob(false);
          setPreviewPlan(plan);
          controller.setStatus(
            plan.warnings.length
              ? `Preview ready — ${plan.warnings.length} warning(s)`
              : `Preview ready — ${plan.lineCount} GCode lines`,
          );
        } catch (err) {
          controller.setStatus(`Preview failed: ${(err as Error).message}`);
        }
      }, 40);
    };
    window.addEventListener('openburn:preview', onPreview);
    return () => window.removeEventListener('openburn:preview', onPreview);
  }, [controller]);

  useEffect(() => {
    document.title = `${state.doc.meta.name || 'Untitled'}${state.dirty ? ' *' : ''} — OpenBurn`;
  }, [state.doc.meta.name, state.dirty]);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (store.getState().dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  return (
    <WorkspaceContext.Provider value={controller}>
      <UnitsContext.Provider value={state.doc.units}>
        <div className="app">
          <MenuBar />
          <div className="toolbar-top">
            <MainToolbar />
            <ArrangeToolbar />
            <NumericToolbar />
            <TextToolbar />
            <ModesToolbar />
          </div>
          <UpdateBanner onOpen={() => setUpdateOpen(true)} />
          <div className="body">
            <LeftToolbar />
            <Workspace onReady={setController} />
            <RightDock key={layoutKey} />
          </div>
          <StatusBar />
        </div>

        {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
        {deviceOpen && <DeviceSettingsDialog onClose={() => setDeviceOpen(false)} />}
        {updateOpen && <UpdateDialog onClose={() => setUpdateOpen(false)} />}
        {previewPlan && (
          <PreviewDialog
            plan={previewPlan}
            bed={{ width: state.doc.bed.width, height: state.doc.bed.height }}
            canSend={machineConnected}
            connectedName={machineName}
            onClose={() => setPreviewPlan(null)}
            onSend={(plan) => {
              machine.startPlan(plan, 'job');
              setPreviewPlan(null);
            }}
          />
        )}
      </UnitsContext.Provider>
    </WorkspaceContext.Provider>
  );
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const state = useAppState();
  const units = state.doc.units;

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      width={420}
      footer={
        <button className="btn primary" onClick={onClose}>
          Close
        </button>
      }
    >
      <h4 style={{ margin: '0 0 8px' }}>General</h4>
      <div className="field-row">
        <span className="field-label">Units</span>
        <select
          className="input"
          value={units}
          onChange={(e) => store.setUnits(e.target.value as 'mm' | 'in')}
        >
          <option value="mm">Millimeters</option>
          <option value="in">Inches</option>
        </select>
      </div>
      <div className="field-row">
        <span className="field-label">Grid</span>
        <NumberField
          value={state.gridSize}
          onChange={(v) => store.setState({ gridSize: v })}
          units={units}
        />
        <span className="hint">{units}</span>
      </div>
      <div className="field-row">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={state.showGrid}
            onChange={(e) => store.setState({ showGrid: e.target.checked })}
          />
          Show grid
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={state.snapToGrid}
            onChange={(e) => store.setState({ snapToGrid: e.target.checked })}
          />
          Snap to grid
        </label>
      </div>

      <h4 style={{ margin: '14px 0 8px' }}>Workspace</h4>
      <div className="field-row">
        <span className="field-label">Width</span>
        <NumberField
          value={state.doc.bed.width}
          onChange={(v) => store.setBed(v, state.doc.bed.height)}
          units={units}
        />
        <span className="field-label">Height</span>
        <NumberField
          value={state.doc.bed.height}
          onChange={(v) => store.setBed(state.doc.bed.width, v)}
          units={units}
        />
      </div>

      <h4 style={{ margin: '14px 0 8px' }}>Machine (GRBL)</h4>
      <div className="field-row">
        <span className="field-label">Baud</span>
        <select
          className="input"
          value={state.device.baudRate}
          onChange={(e) => store.updateDevice({ baudRate: Number(e.target.value) })}
        >
          {[9600, 19200, 38400, 57600, 115200, 230400, 250000].map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <span className="field-label">Max S</span>
        <input
          className="input narrow"
          type="number"
          min={1}
          value={state.device.maxS}
          onChange={(e) => store.updateDevice({ maxS: Number(e.target.value) || 1000 })}
        />
        <span className="field-label">Rapid</span>
        <input
          className="input narrow"
          type="number"
          min={100}
          step={100}
          value={state.device.rapidRate}
          title="Rapid rate (mm/min)"
          onChange={(e) => store.updateDevice({ rapidRate: Number(e.target.value) || 3000 })}
        />
        <span className="hint">mm/min</span>
      </div>
      <div className="field-row">
        <span className="field-label">Laser</span>
        <select
          className="input"
          value={state.device.laserMode}
          onChange={(e) => store.updateDevice({ laserMode: e.target.value as 'M3' | 'M4' })}
        >
          <option value="M3">M3 constant power</option>
          <option value="M4">M4 dynamic power</option>
        </select>
      </div>
      <div className="field-row">
        <span className="field-label">Origin</span>
        <select
          className="input"
          value={state.device.origin}
          onChange={(e) =>
            store.updateDevice({ origin: e.target.value as 'bottom-left' | 'top-left' })
          }
        >
          <option value="bottom-left">Bottom-left (typical GRBL)</option>
          <option value="top-left">Top-left</option>
        </select>
      </div>
      <label className="checkbox" style={{ marginTop: 6 }}>
        <input
          type="checkbox"
          checked={state.device.homeBeforeJob}
          onChange={(e) => store.updateDevice({ homeBeforeJob: e.target.checked })}
        />
        Home before each job ($H)
      </label>
      <label className="checkbox" style={{ marginTop: 6 }}>
        <input
          type="checkbox"
          checked={state.device.optimizeTravel !== false}
          onChange={(e) => store.updateDevice({ optimizeTravel: e.target.checked })}
        />
        Enable cut planner (see Optimization Settings in the Laser panel)
      </label>
      <div className="field-row" style={{ marginTop: 6 }}>
        <span className="field-label">Air assist</span>
        <select
          className="input"
          value={state.device.airAssistCommand}
          onChange={(e) =>
            store.updateDevice({ airAssistCommand: e.target.value as 'M7' | 'M8' })
          }
        >
          <option value="M8">M8 (flood coolant)</option>
          <option value="M7">M7 (mist coolant)</option>
        </select>
      </div>
      <label className="checkbox" style={{ marginTop: 6 }}>
        <input
          type="checkbox"
          checked={state.device.zAxisEnabled}
          onChange={(e) => store.updateDevice({ zAxisEnabled: e.target.checked })}
        />
        Z axis installed (focus test &amp; per-object Z)
      </label>
      {state.device.zAxisEnabled && (
        <div className="field-row" style={{ marginTop: 6 }}>
          <span className="field-label">Z feed</span>
          <input
            className="input narrow"
            type="number"
            min={10}
            step={10}
            value={state.device.zFeedRate}
            onChange={(e) => store.updateDevice({ zFeedRate: Number(e.target.value) || 300 })}
          />
          <span className="hint">mm/min</span>
        </div>
      )}

      <p className="hint" style={{ marginTop: 12 }}>
        Device-specific settings (firmware, homing, laser power limits) are configured in Device
        Settings and become editable once a laser is connected in Phase 2.
      </p>
    </Modal>
  );
}

function DeviceSettingsDialog({ onClose }: { onClose: () => void }) {
  const state = useAppState();
  const units = state.doc.units;
  const [name, setName] = useState('GRBL');

  return (
    <Modal
      title="Device Settings"
      onClose={onClose}
      width={420}
      footer={
        <button className="btn primary" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="field-row">
        <span className="field-label">Name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field-row">
        <span className="field-label">Type</span>
        <select className="input" value="grbl" disabled>
          <option value="grbl">GRBL (GCode)</option>
        </select>
      </div>
      <h4 style={{ margin: '12px 0 8px' }}>Work area</h4>
      <div className="field-row">
        <span className="field-label">X</span>
        <NumberField
          value={state.doc.bed.width}
          onChange={(v) => store.setBed(v, state.doc.bed.height)}
          units={units}
        />
        <span className="field-label">Y</span>
        <NumberField
          value={state.doc.bed.height}
          onChange={(v) => store.setBed(state.doc.bed.width, v)}
          units={units}
        />
      </div>
      <label className="checkbox" style={{ marginTop: 8 }}>
        <input
          type="checkbox"
          checked={state.doc.bed.showOutline}
          onChange={(e) =>
            store.setState({
              doc: { ...state.doc, bed: { ...state.doc.bed, showOutline: e.target.checked } },
            })
          }
        />
        Show bed outline
      </label>
      <p className="hint" style={{ marginTop: 12 }}>
        Serial communication uses the Web Serial API. In the desktop build, choose a port in the
        Laser panel to grant access; the simulator lets you try job streaming without hardware.
      </p>
    </Modal>
  );
}
