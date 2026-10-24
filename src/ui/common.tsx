import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { WorkspaceApi } from '@/state/store';
import type { Units } from '@/types/document';
import { displayToMm, mmToDisplay } from '@/core/units';
import { Icon, type IconName } from './icons';

export const WorkspaceContext = createContext<WorkspaceApi | null>(null);
export const UnitsContext = createContext<Units>('mm');

export function useWorkspace(): WorkspaceApi | null {
  return useContext(WorkspaceContext);
}

export function useUnits(): Units {
  return useContext(UnitsContext);
}

interface ToolButtonProps {
  icon: IconName;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

export function ToolButton({ icon, title, active, disabled, onClick }: ToolButtonProps) {
  return (
    <button
      type="button"
      className={`tb-btn${active ? ' active' : ''}${disabled ? ' disabled' : ''}`}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={17} />
    </button>
  );
}

interface PanelProps {
  title: string;
  defaultOpen?: boolean;
  right?: ReactNode;
  children: ReactNode;
}

export function Panel({ title, defaultOpen = true, right, children }: PanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="panel">
      <div className="panel-header" onClick={() => setOpen((v) => !v)}>
        <span>{title}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {right}
          <Icon name="chevron" size={13} className={`chev${open ? '' : ' collapsed'}`} />
        </span>
      </div>
      {open && <div className="panel-body">{children}</div>}
    </section>
  );
}

interface NumberFieldProps {
  value: number;
  onChange: (mm: number) => void;
  label?: string;
  units: Units;
  decimals?: number;
  disabled?: boolean;
  title?: string;
  className?: string;
}

/** Numeric input that displays values in the document's units but reports mm. */
export function NumberField({
  value,
  onChange,
  label,
  units,
  decimals = 2,
  disabled,
  title,
  className = 'input narrow',
}: NumberFieldProps) {
  const [text, setText] = useState(() => mmToDisplay(value, units).toFixed(decimals));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(mmToDisplay(value, units).toFixed(decimals));
  }, [value, units, decimals, focused]);

  const commit = () => {
    const parsed = Number.parseFloat(text);
    if (Number.isFinite(parsed)) onChange(displayToMm(parsed, units));
    else setText(mmToDisplay(value, units).toFixed(decimals));
  };

  return (
    <>
      {label && <span className="field-label">{label}</span>}
      <input
        className={className}
        value={text}
        title={title ?? label}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            (e.target as HTMLInputElement).blur();
          }
          e.stopPropagation();
        }}
      />
    </>
  );
}

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

export function Modal({ title, onClose, children, footer, width }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" style={width ? { width } : undefined}>
        <div className="dialog-header">
          <span>{title}</span>
          <button className="close" onClick={onClose} type="button">
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>
  );
}

interface SegControlProps<T extends string> {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (value: T) => void;
}

export function SegControl<T extends string>({ value, options, onChange }: SegControlProps<T>) {
  return (
    <div className="seg-control">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          className={o.value === value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field-row">
      <span className="field-label">{label}</span>
      {children}
    </div>
  );
}

/** Debounced-ish helper for local number inputs inside panels. */
export function useNumberDraft(value: number, commit: (v: number) => void) {
  const [draft, setDraft] = useState(String(value));
  const ref = useRef(value);
  useEffect(() => {
    if (ref.current !== value) {
      ref.current = value;
      setDraft(String(value));
    }
  }, [value]);
  return {
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
    onCommit: () => {
      const n = Number.parseFloat(draft);
      if (Number.isFinite(n)) {
        ref.current = n;
        commit(n);
      } else {
        setDraft(String(ref.current));
      }
    },
  };
}
