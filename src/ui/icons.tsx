import type { ReactNode, SVGProps } from 'react';

export type IconName =
  | 'flame'
  | 'new'
  | 'open'
  | 'save'
  | 'import'
  | 'undo'
  | 'redo'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'delete'
  | 'pan'
  | 'zoom-page'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-fit'
  | 'preview'
  | 'settings'
  | 'device'
  | 'camera'
  | 'align-left'
  | 'align-hcenter'
  | 'align-right'
  | 'align-top'
  | 'align-vcenter'
  | 'align-bottom'
  | 'distribute-h'
  | 'distribute-v'
  | 'group'
  | 'ungroup'
  | 'select'
  | 'node'
  | 'line'
  | 'rect'
  | 'rounded-rect'
  | 'ellipse'
  | 'polygon'
  | 'text'
  | 'measure'
  | 'union'
  | 'subtract'
  | 'intersect'
  | 'exclude'
  | 'offset'
  | 'array-grid'
  | 'array-circle'
  | 'mirror-h'
  | 'mirror-v'
  | 'trim'
  | 'play'
  | 'pause'
  | 'stop'
  | 'home'
  | 'jog-up'
  | 'jog-down'
  | 'jog-left'
  | 'jog-right'
  | 'eye'
  | 'eye-off'
  | 'chevron'
  | 'close'
  | 'plus'
  | 'minus'
  | 'rotary'
  | 'print-cut'
  | 'repeat'
  | 'frame'
  | 'lock'
  | 'unlock'
  | 'layers'
  | 'laser'
  | 'console'
  | 'macros'
  | 'material'
  | 'shape'
  | 'move'
  | 'grid'
  | 'snap';

const paths: Record<IconName, ReactNode> = {
  flame: (
    <path
      d="M12 2.5c1.6 3.2.3 4.7-.9 6.1-1.2 1.4-2.4 2.8-1.2 5 0-1.4.9-2.2 1.8-3 .2 1.1.8 1.9 1.6 2.5.9.7 1.2 1.5.7 2.6 2.2-1.2 3.5-3.3 3.5-5.7 0-3.6-2.5-6.2-5.5-7.5Z"
      fill="currentColor"
      stroke="none"
    />
  ),
  new: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M12 11v6M9 14h6" />
    </>
  ),
  open: (
    <>
      <path d="M3 6h6l2 2h10v11H3z" />
      <path d="M3 10h18" />
    </>
  ),
  save: (
    <>
      <path d="M4 4h12l4 4v12H4z" />
      <path d="M8 4v6h8V4M8 20v-6h8v6" />
    </>
  ),
  import: (
    <>
      <path d="M12 3v10" />
      <path d="M8 9l4 4 4-4" />
      <path d="M4 15v4h16v-4" />
    </>
  ),
  undo: (
    <>
      <path d="M9 7 4 12l5 5" />
      <path d="M4 12h9a6 6 0 0 1 6 6v1" />
    </>
  ),
  redo: (
    <>
      <path d="m15 7 5 5-5 5" />
      <path d="M20 12h-9a6 6 0 0 0-6 6v1" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="11" height="12" rx="1" />
      <path d="M16 8V5H5v12h3" />
    </>
  ),
  cut: (
    <>
      <circle cx="7" cy="18" r="2.4" />
      <circle cx="17" cy="18" r="2.4" />
      <path d="M8.5 16.3 17 4M15.5 16.3 7 4" />
    </>
  ),
  paste: (
    <>
      <path d="M8 5h8v3H8z" />
      <path d="M9 5H6v16h12V5h-3" />
      <path d="M9 12h6M9 16h6" />
    </>
  ),
  delete: (
    <>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  pan: (
    <>
      <path d="M12 3v18M3 12h18" />
      <path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />
    </>
  ),
  'zoom-page': (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1" />
      <path d="M8 8h8v8H8z" />
    </>
  ),
  'zoom-in': (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5M7.5 10.5h6M10.5 7.5v6" />
    </>
  ),
  'zoom-out': (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5M7.5 10.5h6" />
    </>
  ),
  'zoom-fit': (
    <>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
      <rect x="9" y="9" width="6" height="6" />
    </>
  ),
  preview: (
    <>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1" />
    </>
  ),
  device: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  camera: (
    <>
      <path d="M3 7h4l1.5-2h7L17 7h4v12H3z" />
      <circle cx="12" cy="13" r="3.4" />
    </>
  ),
  'align-left': (
    <>
      <path d="M4 3v18" />
      <rect x="7" y="6" width="10" height="4" />
      <rect x="7" y="14" width="6" height="4" />
    </>
  ),
  'align-hcenter': (
    <>
      <path d="M12 3v18" />
      <rect x="5" y="6" width="14" height="4" />
      <rect x="8" y="14" width="8" height="4" />
    </>
  ),
  'align-right': (
    <>
      <path d="M20 3v18" />
      <rect x="7" y="6" width="10" height="4" />
      <rect x="11" y="14" width="6" height="4" />
    </>
  ),
  'align-top': (
    <>
      <path d="M3 4h18" />
      <rect x="6" y="7" width="4" height="10" />
      <rect x="14" y="7" width="4" height="6" />
    </>
  ),
  'align-vcenter': (
    <>
      <path d="M3 12h18" />
      <rect x="6" y="5" width="4" height="14" />
      <rect x="14" y="8" width="4" height="8" />
    </>
  ),
  'align-bottom': (
    <>
      <path d="M3 20h18" />
      <rect x="6" y="7" width="4" height="10" />
      <rect x="14" y="11" width="4" height="6" />
    </>
  ),
  'distribute-h': (
    <>
      <path d="M3 4v16M21 4v16" />
      <rect x="9" y="6" width="6" height="12" />
    </>
  ),
  'distribute-v': (
    <>
      <path d="M4 3h16M4 21h16" />
      <rect x="6" y="9" width="12" height="6" />
    </>
  ),
  group: (
    <>
      <rect x="3" y="3" width="8" height="8" />
      <rect x="13" y="13" width="8" height="8" />
      <path d="M11 7h4v4M13 17h-4v-4" />
    </>
  ),
  ungroup: (
    <>
      <rect x="3" y="3" width="8" height="8" />
      <rect x="13" y="13" width="8" height="8" />
      <path d="M13 7h4v4" strokeDasharray="2 2" />
    </>
  ),
  select: <path d="M5 3l14 8-6 1.5L10 19z" fill="currentColor" stroke="none" />,
  node: (
    <>
      <path d="M4 18C8 18 8 6 12 6s4 12 8 12" />
      <rect x="2" y="16" width="4" height="4" fill="currentColor" />
      <rect x="10" y="4" width="4" height="4" fill="currentColor" />
      <rect x="18" y="16" width="4" height="4" fill="currentColor" />
    </>
  ),
  line: <path d="M3 20 21 4" />,
  rect: <rect x="3.5" y="5.5" width="17" height="13" />,
  'rounded-rect': <rect x="3.5" y="5.5" width="17" height="13" rx="4" />,
  ellipse: <ellipse cx="12" cy="12" rx="8.5" ry="6.5" />,
  polygon: <path d="M12 3l8 6-3 10H7L4 9z" />,
  text: (
    <>
      <path d="M5 5h14M12 5v15M8 20h8" />
    </>
  ),
  measure: (
    <>
      <path d="M3 15 15 3l6 6L9 21z" />
      <path d="M7 11l2 2M10 8l2 2M13 5l2 2" />
    </>
  ),
  union: (
    <>
      <circle cx="9" cy="12" r="5.5" />
      <circle cx="15" cy="12" r="5.5" />
    </>
  ),
  subtract: (
    <>
      <circle cx="9" cy="12" r="5.5" />
      <path d="M12 7.2a5.5 5.5 0 0 1 0 9.6A5.5 5.5 0 0 1 12 7.2Z" fill="#000" />
      <circle cx="15" cy="12" r="5.5" strokeDasharray="2 2" />
    </>
  ),
  intersect: (
    <>
      <circle cx="9" cy="12" r="5.5" strokeDasharray="2 2" />
      <circle cx="15" cy="12" r="5.5" strokeDasharray="2 2" />
      <path d="M12 7.2a5.5 5.5 0 0 1 0 9.6 5.5 5.5 0 0 1 0-9.6Z" fill="currentColor" stroke="none" />
    </>
  ),
  exclude: (
    <>
      <circle cx="9" cy="12" r="5.5" />
      <circle cx="15" cy="12" r="5.5" />
      <path d="M12 7.2a5.5 5.5 0 0 1 0 9.6A5.5 5.5 0 0 1 12 7.2Z" fill="#000" stroke="none" />
    </>
  ),
  offset: (
    <>
      <rect x="7" y="7" width="10" height="10" />
      <rect x="3.5" y="3.5" width="17" height="17" strokeDasharray="2 2" />
    </>
  ),
  'array-grid': (
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </>
  ),
  'array-circle': (
    <>
      <circle cx="12" cy="12" r="7.5" strokeDasharray="2 2" />
      <circle cx="12" cy="4.5" r="1.6" fill="currentColor" />
      <circle cx="19.5" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="19.5" r="1.6" fill="currentColor" />
      <circle cx="4.5" cy="12" r="1.6" fill="currentColor" />
    </>
  ),
  'mirror-h': (
    <>
      <path d="M12 3v18" strokeDasharray="2 2" />
      <path d="M9 6 4 12l5 6zM15 6l5 6-5 6z" />
    </>
  ),
  'mirror-v': (
    <>
      <path d="M3 12h18" strokeDasharray="2 2" />
      <path d="M6 9 12 4l6 5zM6 15l6 5 6-5z" />
    </>
  ),
  trim: (
    <>
      <path d="M4 4l16 16M20 4 4 20" />
      <circle cx="12" cy="12" r="3" fill="#000" />
    </>
  ),
  play: <path d="M7 4l13 8-13 8z" fill="currentColor" />,
  pause: (
    <>
      <rect x="6" y="4" width="4" height="16" fill="currentColor" />
      <rect x="14" y="4" width="4" height="16" fill="currentColor" />
    </>
  ),
  stop: <rect x="5" y="5" width="14" height="14" fill="currentColor" />,
  home: (
    <>
      <path d="m3 11 9-7 9 7" />
      <path d="M6 10v10h12V10" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  'jog-up': <path d="M12 19V5M5 12l7-7 7 7" />,
  'jog-down': <path d="M12 5v14M5 12l7 7 7-7" />,
  'jog-left': <path d="M19 12H5M12 5l-7 7 7 7" />,
  'jog-right': <path d="M5 12h14M12 5l7 7-7 7" />,
  eye: (
    <>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M4 5l16 14" />
      <path d="M9.6 6.3A10 10 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3 3.6M6.4 8.3A17 17 0 0 0 2.5 12s3.5 6 9.5 6c1.3 0 2.5-.3 3.6-.7" />
    </>
  ),
  chevron: <path d="m6 9 6 6 6-6" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  rotary: (
    <>
      <rect x="7" y="4" width="10" height="16" rx="3" />
      <path d="M4 8v8M20 8v8" />
    </>
  ),
  'print-cut': (
    <>
      <path d="M6 9V3h12v6" />
      <rect x="3" y="9" width="18" height="7" rx="1" />
      <path d="M6 16h12v5H6z" />
    </>
  ),
  repeat: (
    <>
      <path d="M4 9a5 5 0 0 1 5-5h9l-3-3M20 15a5 5 0 0 1-5 5H6l3 3" />
    </>
  ),
  frame: (
    <>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
      <circle cx="12" cy="12" r="2" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="10" rx="1.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="10" width="14" height="10" rx="1.5" />
      <path d="M8 10V7a4 4 0 0 1 7.5-2" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5z" />
      <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
    </>
  ),
  laser: (
    <>
      <path d="M12 2v6M12 16v6M2 12h6M16 12h6" />
      <circle cx="12" cy="12" r="4" />
    </>
  ),
  console: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="m7 9 3 3-3 3M12 15h5" />
    </>
  ),
  macros: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M17.5 14v7M14 17.5h7" />
    </>
  ),
  material: (
    <>
      <path d="M4 4h16v16H4z" />
      <path d="M4 9h16M9 4v16" />
    </>
  ),
  shape: (
    <>
      <path d="M12 3l9 16H3z" />
      <circle cx="12" cy="13" r="3" />
    </>
  ),
  move: (
    <>
      <path d="M12 2v20M2 12h20" />
      <path d="m9 5 3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3" />
    </>
  ),
  grid: (
    <>
      <path d="M3 3h18v18H3z" />
      <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
    </>
  ),
  snap: (
    <>
      <path d="M4 4h4v4H4zM16 4h4v4h-4zM4 16h4v4H4zM16 16h4v4h-4z" />
      <path d="M8 6h8M6 8v8M18 8v8M8 18h8" strokeDasharray="2 2" />
    </>
  ),
};

interface Props extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 16, ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}
