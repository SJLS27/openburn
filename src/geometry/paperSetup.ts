import paper from 'paper';

let ready = false;

/** Initialise Paper.js once with an offscreen canvas (no visible project). */
export function ensurePaper(): void {
  if (ready) return;
  const canvas = document.createElement('canvas');
  paper.setup(canvas);
  ready = true;
}

export function clearPaperProject(): void {
  if (!ready) return;
  paper.project.activeLayer.removeChildren();
}

export { paper };
