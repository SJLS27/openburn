import type { Page } from '@playwright/test';

/**
 * Demo scene shared by the documentation screenshot spec and the app-icon
 * capture. Everything is built headless through `window.__openburn` plus the
 * real toolbar/menu UI, so the captures always show the shipping app.
 *
 * Coordinates are scene millimetres on the default 400 × 400 mm bed.
 * The store and model helpers are only exposed by dev builds (`src/main.tsx`),
 * which is what `npm run dev:build` produces for the screenshot script.
 */

type Point = { x: number; y: number };

type DemoObject = {
  type: string;
  left: number;
  top: number;
  layerId?: string;
  set: (props: Record<string, unknown>) => void;
  setCoords: () => void;
};

type LayerDef = {
  id: string;
  name: string;
  color: string;
  settings: Record<string, unknown>;
};

type DemoWindow = Window & {
  __openburn: {
    canvas: {
      getObjects: () => DemoObject[];
      getActiveObject: () => DemoObject | null;
      discardActiveObject: () => void;
      requestRenderAll: () => void;
      getZoom: () => number;
      viewportTransform: number[];
    };
    newDocument: () => void;
    zoomToPage: (notify?: boolean) => void;
    zoomToFitSelection: () => void;
    convertToPath: () => Promise<void>;
    dropFiles: (files: Array<{ name: string; text?: string }>, at?: Point) => Promise<void>;
    selectAllNodes: () => void;
    selectNode: (subIndex: number, nodeIndex: number, additive: boolean) => void;
    selectAll: () => void;
    setStatus: (text: string) => void;
    generateMaterialTest: (options: Record<string, unknown>) => void;
    generateFocusTest: (options: Record<string, unknown>) => void;
  };
  __openburnStore?: {
    getState: () => { activeLayerId: string; tool: string; doc: { layers: LayerDef[] } };
    replaceDocument: (doc: DemoDocument) => void;
    setState: (patch: Record<string, unknown>) => void;
  };
  __openburnLayers?: {
    createLayer: (index: number) => LayerDef;
    createEmptyDocument: (name?: string) => DemoDocument;
  };
  __openburnLB?: {
    parseLightBurn: (xml: string) => Promise<unknown>;
  };
};

type DemoDocument = { layers: LayerDef[]; meta: { name: string } };

type DemoLayerSpec = {
  /** Palette index (0 black, 1 blue, 2 red, 6 cyan, 7 orange…). */
  index: number;
  name: string;
  color: string;
  settings: Record<string, unknown>;
};

export const DEMO_LAYERS = {
  cut: {
    index: 2,
    name: 'CUT',
    color: '#ff0000',
    settings: { mode: 'line', speed: 20, power: 85, passes: 2 },
  },
  engrave: {
    index: 7,
    name: 'ENGRAVE',
    color: '#ff8000',
    settings: { mode: 'fill', speed: 120, power: 30, passes: 1, interval: 0.08, angle: 45 },
  },
  logo: {
    index: 6,
    name: 'LOGO',
    color: '#00a0c8',
    settings: { mode: 'fill', speed: 90, power: 35, passes: 1, interval: 0.08, angle: 0 },
  },
  score: {
    index: 1,
    name: 'SCORE',
    color: '#0000ff',
    settings: { mode: 'line', speed: 200, power: 25, passes: 1 },
  },
} satisfies Record<string, DemoLayerSpec>;

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

export async function controllerReady(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as unknown as { __openburn?: unknown }).__openburn));
}

function count(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as DemoWindow).__openburn.canvas.getObjects().length);
}

async function waitForCount(page: Page, expected: number): Promise<void> {
  await page.waitForFunction(
    (n) => (window as unknown as DemoWindow).__openburn.canvas.getObjects().length >= n,
    expected,
    { timeout: 4000 },
  );
}

/** Scene mm → client pixels, using the live viewport transform. */
export async function toClient(page: Page, x: number, y: number): Promise<Point & { zoom: number }> {
  const box = await page.locator('.fabric-host canvas').first().boundingBox();
  if (!box) throw new Error('canvas is not visible');
  const { zoom, vpt } = await page.evaluate(() => {
    const c = (window as unknown as DemoWindow).__openburn;
    return { zoom: c.canvas.getZoom(), vpt: c.canvas.viewportTransform };
  });
  return { x: box.x + x * zoom + vpt[4], y: box.y + y * zoom + vpt[5], zoom };
}

/** Draw with one of the real shape tools (r/e/l) between two scene points. */
async function draw(page: Page, key: 'r' | 'e' | 'l', from: Point, to: Point): Promise<void> {
  const before = await count(page);
  await page.keyboard.press('Escape');
  // Escape keeps the current tool (it only discards the selection), so go back
  // to Select before switching to the shape tool.
  await page.keyboard.press('s');
  await page.keyboard.press(key);
  await page.waitForFunction(
    (want) => (window as unknown as DemoWindow).__openburnStore?.getState().tool === want,
    key === 'r' ? 'rect' : key === 'e' ? 'ellipse' : 'line',
    { timeout: 5000 },
  );
  const a = await toClient(page, from.x, from.y);
  const b = await toClient(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await waitForCount(page, before + 1);
  await page.keyboard.press('Escape');
}

/** Close the active object selection so screenshots do not show handles. */
export async function deselectAll(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = (window as unknown as DemoWindow).__openburn;
    w.canvas.discardActiveObject();
    w.canvas.requestRenderAll();
  });
  await page.mouse.move(5, 5);
}

// ---------------------------------------------------------------------------
// Fixture assets
// ---------------------------------------------------------------------------

const FLAME_PATH =
  'M32 8c4.3 8.6.8 12.6-2.4 16.4-3.2 3.8-6.4 7.5-3.2 13.4 0-3.7 2.4-5.9 4.8-8 ' +
  '.5 2.9 2.1 5.1 4.3 6.7 2.4 1.8 3.2 4 1.9 7 5.9-3.2 9.4-8.8 9.4-15.3 0-9.7-6.7-16.6-14.8-20.2Z';

/** The app logo (public/favicon.svg path), as an SVG with a real physical size. */
export function logoSvg(sizeMm: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${sizeMm}mm" height="${sizeMm}mm">` +
    `<path d="${FLAME_PATH}"/></svg>`
  );
}

/**
 * Small LightBurn 1.x project used for the compatibility screenshot. It is
 * written by hand (no LightBurn code involved) and parsed by the app itself.
 */
export function lightBurnFixture(): string {
  const now = Math.floor(Date.now() / 1000);
  return `<?xml version="1.0" encoding="UTF-8"?>
<LightBurnProject AppVersion="1.6.03" FormatVersion="1" MaterialHeight="0" MirrorX="False" MirrorY="False">
  <VariableText>
   <Start1 Value="0"/>
   <End1 Value="999"/>
   <Current1 Value="0"/>
  </VariableText>
  <CutSetting type="Cut">
   <index Value="0"/>
   <name Value=""/>
   <maxPower Value="60"/>
   <speed Value="25"/>
   <priority Value="0"/>
   <color Value="0"/>
  </CutSetting>
  <CutSetting type="Scan">
   <index Value="1"/>
   <name Value=""/>
   <maxPower Value="35"/>
   <speed Value="140"/>
   <priority Value="1"/>
   <color Value="4"/>
   <interval Value="0.08"/>
   <angle Value="45"/>
  </CutSetting>
  <Shape Type="Rect" CutIndex="0" W="60" H="40" Cr="0">
   <XForm>1 0 0 1 20 20</XForm>
  </Shape>
  <Shape Type="Rect" CutIndex="0" W="60" H="40" Cr="0">
   <XForm>1 0 0 1 95 20</XForm>
  </Shape>
  <Shape Type="Ellipse" CutIndex="1" Rx="25" Ry="25">
   <XForm>1 0 0 1 190 40</XForm>
  </Shape>
  <Shape Type="Polygon" CutIndex="1" Rx="18" Ry="18" N="6">
   <XForm>1 0 0 1 260 40</XForm>
  </Shape>
  <Shape Type="Path" CutIndex="1">
   <XForm>1 0 0 1 0 0</XForm>
   <VertList>V40 110 c1x40 c1y70V90 110 c1x90 c1y150V140 110 c1x140 c1y70V190 110 c1x190 c1y150V240 110</VertList>
   <PrimList>L0 1B1 2L2 3B3 4</PrimList>
  </Shape>
  <Notes ShowNotes="0" Notes="Imported from LightBurn ${now}"/>
</LightBurnProject>`;
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

/** Fresh document with the four demo layers (recolours the defaults). */
export async function resetDemo(page: Page): Promise<void> {
  await controllerReady(page);
  await page.evaluate((layers) => {
    const w = window as unknown as DemoWindow;
    const store = w.__openburnStore;
    const model = w.__openburnLayers;
    if (!store || !model) throw new Error('demo helpers need a dev build (window.__openburnStore)');
    const doc = model.createEmptyDocument('OpenBurn Demo');
    const specs = Object.values(layers) as DemoLayerSpec[];
    doc.layers = specs.map((spec) => {
      const layer = model.createLayer(spec.index);
      return {
        ...layer,
        name: spec.name,
        color: spec.color,
        settings: { ...layer.settings, ...spec.settings },
      };
    });
    store.replaceDocument(doc);
  }, DEMO_LAYERS);
  const first = await page.evaluate(
    () => (window as unknown as DemoWindow).__openburnStore!.getState().doc.layers[0]!.id,
  );
  await page.evaluate((layerId) => {
    (window as unknown as DemoWindow).__openburnStore!.setState({ activeLayerId: layerId });
  }, first);
  await page.waitForTimeout(300);
  await zoomToPage(page);
}

export async function zoomToPage(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as DemoWindow).__openburn.zoomToPage(false));
}

async function setActiveLayer(page: Page, spec: DemoLayerSpec): Promise<void> {
  await page.evaluate((layerSpec) => {
    const store = (window as unknown as DemoWindow).__openburnStore;
    if (!store) throw new Error('demo helpers need a dev build');
    const layer = store.getState().doc.layers.find((l) => l.name === layerSpec.name);
    if (!layer) throw new Error(`layer ${layerSpec.name} not found`);
    store.setState({ activeLayerId: layer.id });
  }, spec);
}

/**
 * Vector layer: the outline of a 380 × 300 mm desktop name plate.
 *
 * The plate is three rects: the vertical band (left of the wordmark) plus
 * identical top and bottom strips, so all the inner seams coincide and the
 * plate reads as one continuous outline before it is cut.
 */
export async function drawPlate(page: Page): Promise<void> {
  await setActiveLayer(page, DEMO_LAYERS.cut);
  const plate = { x: 10, y: 40, w: 380, h: 300 };
  const strip = 58;
  const bandRight = plate.x + plate.w;
  // Left band, from the top strip to the bottom strip.
  await draw(page, 'r', { x: plate.x, y: plate.y + strip }, { x: bandRight, y: plate.y + plate.h - strip });
  // Top and bottom strips across the full width.
  await draw(page, 'r', { x: plate.x, y: plate.y }, { x: plate.x + plate.w, y: plate.y + strip });
  await draw(page, 'r', { x: plate.x, y: plate.y + plate.h - strip }, { x: plate.x + plate.w, y: plate.y + plate.h });

  // Drilled hanger holes: two in the top strip.
  for (const cx of [plate.x + 42, plate.x + plate.w / 2]) {
    await draw(page, 'e', { x: cx - 5, y: plate.y + strip / 2 - 5 }, { x: cx + 5, y: plate.y + strip / 2 + 5 });
  }
}

/** Draw the flame logo as vector paths (SVG importer, then recolour). */
export async function drawLogo(page: Page, origin: Point, size: number): Promise<void> {
  await setActiveLayer(page, DEMO_LAYERS.logo);
  const before = await count(page);
  await page.evaluate(
    ({ svg, at }) =>
      (window as unknown as DemoWindow).__openburn.dropFiles([{ name: 'openburn-logo.svg', text: svg }], at),
    { svg: logoSvg(size), at: origin },
  );
  await waitForCount(page, before + 1);
  await page.evaluate(() => {
    const w = (window as unknown as DemoWindow).__openburn;
    const active = w.canvas.getActiveObject();
    active?.set({ fill: '#00a0c8', stroke: null, strokeWidth: 0 });
    active?.setCoords();
    w.canvas.discardActiveObject();
    w.canvas.requestRenderAll();
  });
}

/** Queue a textbox through the real text tool and leave editing. */
async function addText(
  page: Page,
  spec: DemoLayerSpec,
  at: Point,
  text: string,
  style: Record<string, unknown>,
): Promise<void> {
  await setActiveLayer(page, spec);
  const before = await count(page);
  const client = await toClient(page, at.x, at.y);
  await page.keyboard.press('Escape');
  await page.keyboard.press('t');
  // Wait until React has switched to the text tool before clicking.
  await page.waitForFunction(
    () => (window as unknown as DemoWindow).__openburnStore?.getState().tool === 'text',
    undefined,
    { timeout: 5000 },
  );
  await page.mouse.click(client.x, client.y);
  await waitForCount(page, before + 1);
  await page.evaluate(
    ({ text: value, style: props }) => {
      const w = (window as unknown as DemoWindow).__openburn;
      const active = w.canvas.getActiveObject();
      if (!active) throw new Error('text tool did not create an object');
      active.set({
        text: value,
        fontFamily: 'Inter, system-ui, sans-serif',
        fill: '#ff8000',
        stroke: null,
        ...props,
      });
      active.setCoords();
      (document.activeElement as HTMLElement | null)?.blur();
      w.canvas.requestRenderAll();
    },
    { text, style },
  );
  // Leave text editing (Fabric: Ctrl+Enter) but keep the textbox selected.
  await page.keyboard.press('Control+Enter');
}

/** "OpenBurn" as real Inter outlines (Tools → Convert to Path). */
export async function drawWordmark(page: Page, fontSize: number): Promise<void> {
  await addText(page, DEMO_LAYERS.engrave, { x: 150, y: 112 }, 'OpenBurn', {
    fontSize,
    textAlign: 'center',
    width: 264,
    lineHeight: 1,
    charSpacing: -15,
  });
  await page.evaluate(() => {
    const w = (window as unknown as DemoWindow).__openburn;
    if (!w.canvas.getActiveObject()) throw new Error('wordmark text was not kept selected');
    return w.convertToPath();
  });
  await deselectAll(page);
}

/** Small engraved tagline under the wordmark (stays editable text). */
export async function drawTagline(page: Page): Promise<void> {
  await addText(page, DEMO_LAYERS.score, { x: 150, y: 240 }, 'OPEN-SOURCE LASER SOFTWARE', {
    fontSize: 7.5,
    textAlign: 'center',
    width: 264,
    charSpacing: 340,
  });
  await deselectAll(page);
}

/**
 * The scene used for the README hero and the web showcase: name plate, vector
 * flame and outlined wordmark. Leaves the canvas deselected and zoomed to the
 * page.
 */
export async function buildDemoScene(page: Page): Promise<void> {
  await resetDemo(page);
  // Escape (previous scene) must not keep the node tool active.
  await page.keyboard.press('s');
  await drawPlate(page);
  await drawWordmark(page, 40);
  await drawLogo(page, { x: 42, y: 132 }, 44);
  await zoomToPage(page);
  await drawTagline(page);
  await zoomToPage(page);
  await deselectAll(page);
  await page.waitForTimeout(250);
}

/** The demo scene plus the imported fixture, for the node editing capture. */
export async function sceneForNodes(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.keyboard.press('s');
  await buildDemoScene(page);
  // The horns are imported as paths: perfect for showing node handles.
  await importLightBurnFixture(page);
  await zoomToPage(page);
}

/** Two crossed horns drawn as Bézier paths through the SVG importer. */
async function importLightBurnFixture(page: Page): Promise<void> {
  const xml = lightBurnFixture();
  await page.evaluate(
    (text) => (window as unknown as DemoWindow).__openburn.dropFiles([{ name: 'horns.lbrn2', text }]),
    xml,
  );
  // Importing switches the bed to the file's size; the count helper is not
  // reliable here because the import also moves the existing objects.
  await page.waitForTimeout(800);
}

/**
 * Import the hand-written LightBurn project for the compatibility capture.
 * It is parsed by the app itself (no LightBurn code involved).
 */
export async function openLightBurnFixture(page: Page): Promise<void> {
  await resetDemo(page);
  await importLightBurnFixture(page);
  // Verify the app's parser handled it (no LightBurn code involved).
  await page.evaluate(async (text) => {
    const w = window as unknown as DemoWindow;
    if (!w.__openburnLB) throw new Error('demo helpers need a dev build');
    await w.__openburnLB.parseLightBurn(text);
  }, lightBurnFixture());
  await deselectAll(page);
}
