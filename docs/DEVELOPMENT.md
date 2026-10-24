# Desarrollo

## Requisitos

- Node.js **20+**
- npm **10+**
- Linux, macOS o Windows

## Instalación

```bash
git clone https://github.com/SJLS27/openburn.git
cd openburn
npm install
```

## Scripts

| Script | Descripción |
| --- | --- |
| `npm run dev` | Vite en el navegador con HMR |
| `npm run dev:electron` | Vite + Electron (ventana de escritorio) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | TypeScript + Vite + compilación de Electron |
| `npm run build:app` | Instalador con electron-builder |
| `npm run preview` | Sirve el build de producción |

## Estructura

```
electron/
  main.ts        # ventana, IPC, permisos Web Serial
  preload.ts     # puente seguro (window.openburn)
src/
  core/          # .obrn, unidades, DXF, file API
  geometry/      # paperOps (booleanos), offset, tabs, paperSetup
  gcode/         # types, geometry, job, optimize
  image/         # adjust, trace
  io/            # lightburn (parser/serializer)
  serial/        # transport, machine
  state/         # store
  text/          # outline
  types/         # document, electron, web-serial, imagetracerjs
  ui/            # componentes y paneles
  workspace/     # controller y fondo
docs/            # documentación
public/fonts/    # Inter (OFL)
```

## Convenciones

- TypeScript estricto; evitar `any` salvo en límites de librerías.
- Los componentes UI usan clases CSS globales (`.tb-btn`, `.panel`, `.input`, …).
- Los comandos que modifican el lienzo deben pasar por `WorkspaceController` para quedar en el historial.
- Las nuevas propiedades serializables de Fabric deben añadirse a `customProperties`.
- Los ajustes de capa se guardan en `doc.layers`; los overrides por objeto en `cutOverride`.

## Añadir una herramienta de dibujo

1. Añade el `ToolId` en `src/state/store.ts`.
2. Crea la detección de arrastre en `WorkspaceController.beginDraw/updateDraw/finishDraw`.
3. Añade el botón en `src/ui/Toolbars.tsx` y el icono en `src/ui/icons.tsx`.
4. Asigna color de capa con `assignLayer` y llama a `afterChange()`.

## Añadir un importador

1. Implementa el parser en `src/core/` o `src/io/`.
2. Devuelve objetos Fabric con `layerId` asignado.
3. Añade el filtro en `src/core/fileApi.ts`.
4. Integra la detección por extensión en `WorkspaceController.openDocument`.
5. Añade pruebas round-trip si el formato se puede exportar.

## LightBurn

- El parser/serializer está en `src/io/lightburn.ts`.
- Para depurar un archivo nuevo, ábrelo con un editor de texto y revisa `CutSetting`, `Shape Type`, `XForm`, `VertList`/`PrimList`.
- Añade soporte para nuevos tipos de `Shape` en `parseShapeElement`.
- Al exportar, los contornos se obtienen con `objectContours` (Paper.js); el texto se convierte antes con `textToScenePath`.
- Documenta cualquier limitación nueva en `docs/FILE-FORMATS.md`.

## Electron y assets

- El renderer se sirve desde `dist/index.html` en producción.
- Las fuentes de `public/fonts` se leen con `fetch` en dev y con el IPC `app:readAsset` en producción (file:// no permite fetch local).
- Web Serial requiere permisos; el main process implementa `select-serial-port` y los handlers de permiso.

## Pruebas manuales sugeridas

- Crear rect/elipse/texto, mover/escalar/rotar, undo/redo.
- Booleanos y offset; tabs y preview del GCode.
- Material Test y comprobar overrides.
- Importar `.lbrn2` de ejemplo; exportar y volver a importar (round-trip).
- Conectar el simulador y ejecutar un job con pausa/resume/stop.
- `npm run build` y abrir la app empaquetada (`npx electron .`).

## Empaquetado

```bash
npm run build:app
```

Salida en `release/`:

- Linux: AppImage
- Windows: NSIS
- macOS: DMG

> La firma de código y el auto-update están pendientes (ver `TODO.md`).

## Solución de problemas

| Problema | Causa / solución |
| --- | --- |
| Web Serial no aparece | Usa un Chromium/Electron moderno; en Electron revisa los handlers de permisos |
| Fuente no carga en producción | Verifica `dist/fonts` y el IPC `app:readAsset` |
| Error `Cannot find module 'electron'` | Ejecuta `npm install` y usa `npm run dev:electron` |
| El build falla por tipos | `npm run typecheck` para ver el error exacto |
| El job no envía | Revisa conexión, `Output` de capa y que no haya otro job activo |
