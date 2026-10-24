import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

createRoot(container).render(<App />);

// Development-only helpers for debugging document import/export.
if (import.meta.env.DEV) {
  void import('./core/serialize').then((m) => {
    (window as unknown as { __openburnIO?: unknown }).__openburnIO = m;
  });
  void import('./core/dxf').then((m) => {
    (window as unknown as { __openburnDxf?: unknown }).__openburnDxf = m;
  });
  void import('./serial/machine').then((m) => {
    (window as unknown as { __openburnMachine?: unknown }).__openburnMachine = m.machine;
  });
  void import('./gcode/job').then((m) => {
    (window as unknown as { __openburnJob?: unknown }).__openburnJob = m;
  });
  void import('./state/store').then((m) => {
    (window as unknown as { __openburnStore?: unknown }).__openburnStore = m.store;
  });
  void import('./io/lightburn').then((m) => {
    (window as unknown as { __openburnLB?: unknown }).__openburnLB = m;
  });
}
