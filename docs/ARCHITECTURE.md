# Arquitectura

OpenBurn es una app **Electron + React + TypeScript** con tres motores principales:

1. **Fabric.js** para el modelo y la edición del lienzo.
2. **Paper.js** para geometría booleana, offset y vectorización de trayectorias.
3. **Controlador GRBL** con transporte Web Serial o simulador.

```mermaid
flowchart LR
    UI[React UI<br/>toolbars · paneles · diálogos]
    STORE[Store observable<br/>documento · capas · selección]
    CANVAS[WorkspaceController<br/>Fabric.js]
    GEO[Geometry<br/>Paper.js]
    PLAN[Job planner<br/>gcode/job.ts]
    OPT[Cut planner<br/>optimize.ts]
    GCODE[GCode writer]
    MACHINE[GRBL controller]
    SERIAL[Web Serial / Simulator]
    FILES[File IO<br/>.obrn · .lbrn2 · SVG/DXF]

    UI <--> STORE
    UI --> CANVAS
    STORE <--> CANVAS
    CANVAS --> GEO
    GEO --> PLAN
    PLAN --> OPT
    OPT --> GCODE
    GCODE --> MACHINE
    MACHINE <--> SERIAL
    FILES <--> STORE
    FILES --> CANVAS
```

---

## 1. Capas de la aplicación

| Carpeta | Responsabilidad |
| --- | --- |
| `electron/` | Ventana, IPC (diálogos, fs, assets), permisos Web Serial y auto-update |
| `src/core/` | `.obrn`, unidades, DXF, acceso a archivos |
| `src/state/` | Store observable + interfaz `WorkspaceApi` |
| `src/workspace/` | `WorkspaceController`: herramientas, selección, historial, zoom, nodos |
| `src/ui/` | Menús, toolbars, paneles, diálogos, iconos |
| `src/geometry/` | Booleanos/offset (Paper.js), tabs |
| `src/gcode/` | Geometría de mecanizado, planificación, optimización y GCode |
| `src/image/` | Ajuste de imagen y vectorización (ImageTracer) |
| `src/text/` | Texto a contornos (opentype.js) |
| `src/serial/` | Transportes y controlador GRBL |
| `src/io/` | Import/export LightBurn |

---

## 2. Estado y controller

- El documento (`OpenBurnDocument`) contiene capas, cama, unidades y la escena serializada.
- `store` es un store observable minimalista (`useSyncExternalStore`) con el estado de UI: herramienta activa, selección, zoom, cursor, dispositivo, etc.
- `WorkspaceController` se registra en `WorkspaceApi` para que la UI invoque comandos imperativos (nuevo, guardar, alinear, booleanos…).
- Cada cambio relevante de la escena se snapshotea para **undo/redo**. Los snapshots excluyen los nodos temporales (`excludeFromExport`).

Las propiedades por objeto viajan con la escena:

```ts
FabricObject.customProperties = ['layerId', 'cutOverride', 'imageAdjust'];
```

---

## 3. Render y coordenadas

- El lienzo de Fabric se dibuja sobre un `<canvas>` de fondo que pinta cama, grid, reglas y origen.
- Ambas capas comparten `viewportTransform`.
- El espacio de trabajo usa **mm** y **Y hacia abajo** (origen arriba-izquierda).
- Al importar LightBurn se aplica `y' = -y` y se normaliza el conjunto.
- Al exportar se invierte con `y_lb = bed.height - y_scene`.

---

## 4. Pipeline de GCode

```
Formas Fabric
   │  (objectContours: toSVG → Paper.js → flatten)
   ▼
Contornos en coordenadas de escena
   │
   ├─ Line: contornos, con kerf opcional (expande/contrae cerrados)
   ├─ Fill: scanlines a `angle` (y +90° con cross-hatch) + scan offset
   ├─ Offset Fill: offsets concéntricos (polígonos)
   └─ Image: filas con potencia por punto
   ▼
PlanSegment[]  { rapid | cut, points, feed, power, powers, z }
   │  (optimizeSegments: vecino más cercano por capa)
   ▼
emitGcode: cabecera, M3/M4, G1 Z (si hay eje Z), G0/G1, M5, M2
   │  (mapeo de origen)
   ▼
GCode + estadísticas (tiempo, distancia, bounds)
```

- **Preview** consume el mismo `JobPlan`, por lo que trayectorias y tiempos coinciden con el envío.
- Los segmentos raster llevan `powers[]` y emiten `G1 X Y S…` para variar potencia punto a punto.
- El kerf se aplica al contorno antes de cerrarlo; los offsets que colapsan se descartan.
- Con `zAxisEnabled`, cada cambio de `zOffset` emite un `G1 Z…` con el feed configurado y el job vuelve a `Z0` al terminar.
- Los Material Tests con *sublayers* crean una capa por celda; el job las procesa como capas normales y la exportación LightBurn genera un `CutSetting` por celda.
- El control de flujo del envío usa una ventana de 120 bytes y acks de GRBL.

---

## 5. Comunicación con la máquina

```
UI (Laser/Move/Console)
   → machine (singleton)
     → GrblController lógico
       → Transport
         ├─ WebSerialTransport (navigator.serial)
         └─ MockTransport (simulador con tiempos)
```

- `machine` mantiene estado observable: conexión, `MPos`, feed, spindle, trabajo, progreso y logs.
- Polling de estado cada 250 ms (`?`).
- Pausa/resume con `!`/`~`; stop con feed hold + soft reset (`Ctrl+X`).
- En Electron, el proceso principal concede permisos Web Serial y selecciona el puerto.

---

## 6. Auto-update

```
electron/updater.ts          autoUpdater (electron-updater)
   │  checking · update-available · download-progress · update-downloaded · error
   ▼  IPC 'updater:event'
electron/preload.ts          window.openburn.updater { check, download, install, onEvent }
   ▼
src/state/updateStore.ts     store observable (useSyncExternalStore)
   ▼
src/ui/UpdateDialog.tsx      banner de progreso + diálogo "Restart & install"
```

- Solo se activa con `app.isPackaged`. En Linux exige la build **AppImage** (`APPIMAGE` definido); Flatpak y los paquetes de distro se actualizan desde su propia tienda.
- `autoDownload = true` y `autoInstallOnAppQuit = true`: la descarga arranca al detectar la versión y el usuario decide cuándo reiniciar. `quitAndInstall(false, true)` reabre la app tras instalar.
- El feed se define en `build.publish` (GitHub Releases). `.github/workflows/release.yml` compila y publica al empujar un tag `v*`, incluidos `latest.yml` / `latest-*.yml`.
- La comprobación de arranque se retrasa 5 s para no competir con el primer render; **Help → Check for Updates…** (menú nativo y menú in-app) lanza una comprobación manual y abre el diálogo.
- El main cachea el último estado: si el renderer se suscribe tarde, `updater:get-state` hidrata el store.
- La firma de código (Windows/macOS) es independiente del mecanismo y queda pendiente; sin ella macOS no puede aplicar actualizaciones en producción.

---

## 7. Texto e imágenes

- **Texto a contornos**: opentype.js carga Inter (fetch en dev, IPC en producción), reconstruye líneas/alineación/rotación con la matriz de Fabric y devuelve un `pathData` en escena.
- **Adjust Image**: `applyImageAdjust` se comparte entre el rasterizador y la previsualización para que el resultado sea idéntico.
- **Trace Image**: se dibuja la imagen a ≤700 px, se cuantiza (mono/color) y se pasa a ImageTracer; el SVG resultante se importa con Fabric y se ajusta al rectángulo original.

---

## 8. Import/export LightBurn

`src/io/lightburn.ts` implementa:

- **Parser XML** con `DOMParser`.
- Soporte de `Rect`, `Ellipse`, `Polygon`, `Path`, `Group`, `Text` (`BackupPath`), `Bitmap` y `CutSetting`.
- Lectura de `VertList` compacto y `<V>/<P>` legado, incluidos handles Bézier y plantillas `VertID/PrimID`.
- **Serializer** que escribe XML legado o compacto, con contornos en coordenadas absolutas, texto en contornos y bitmaps base64.

No usa el código de LightBurn; se basa en el formato XML y en archivos de ejemplo reales.

---

## 9. Pruebas

La política completa está en [AGENTS.md](../AGENTS.md).

- **Unitarios/componentes**: Vitest + jsdom + Testing Library
  (`vitest.config.ts`, setup en `src/test/setup.ts`).
  - Lógica pura: `src/core/units.test.ts`, `src/core/serialize.test.ts`,
    `src/gcode/types.test.ts`, `src/gcode/optimize.test.ts`.
  - Estado: `src/state/updateStore.test.ts`.
  - Componentes: `src/ui/UpdateDialog.test.tsx`.
  - Proceso principal: `electron/updater.test.ts` (mockea `electron` y
    `electron-updater`, entorno `node`).
- **End-to-end**: Playwright `_electron` sobre `dist/` + `dist-electron/`
  (`playwright.config.ts`, specs en `e2e/`). Cubre arranque de la ventana,
  versión del proceso principal y el diálogo de actualizaciones.
- **Estáticos**: `npm run typecheck` y `npm run build`.
- **CI**: `.github/workflows/ci.yml` ejecuta typecheck + tests + build, y un job
  separado de e2e con `xvfb-run`.

Los tests se excluyen de los builds: `electron/tsconfig.json` ignora
`*.test.ts` / `*.spec.ts` y `vitest.config.ts` no incluye `e2e/`.

Siguen existiendo pruebas manuales con Chrome headless/Puppeteer para flujos
que requieren interacción real con Fabric (booleanos, tabs, ajuste/trace,
round-trip de `.lbrn2` y jobs contra el simulador GRBL).
