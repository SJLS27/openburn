# OpenBurn — TODO & Roadmap

Estado actual: **v0.8.0**. Esta lista se actualiza con cada bloque de trabajo.

> 🟡 = funcionalidad presente pero **parcial**; el checkbox marca el estado real
> (`[ ]` = solo existe la base, falta la paridad con LightBurn).

## ✅ Completado

### Fase 1 — Núcleo de diseño
- [x] Workspace con cama, reglas, grid, origen y zoom/pan
- [x] Capas y paleta de colores (C00…)
- [x] Línea, rect, rect redondeado, elipse, polígono, texto, medir
- [x] Selección, transformación, alineación, distribución, agrupar/orden
- [x] Booleanos, offset, arrays, edición de nodos
- [x] Undo/redo con historial
- [x] Import SVG/DXF/ráster; export SVG
- [x] Formato nativo `.obrn` (lectura de `.ovbrn` legado)
- [x] Trazos hairline de 1 px como LightBurn (independientes del zoom, también en grupos anidados y en export SVG)

### Fase 2 — Preview + GRBL
- [x] Planificador de trayectorias por capa (Line/Fill/Offset Fill/Image)
- [x] Fill por scanlines con overscan
- [x] Raster con potencia variable/dithering
- [x] Ventana Preview animada con estadísticas
- [x] Export GCode `.nc`
- [x] Control GRBL por Web Serial + simulador
- [x] Streaming con control de flujo; Frame/Start/Pause/Stop
- [x] Jog, homing, unlock, set origin
- [x] Consola y macros
- [x] Estado en vivo (MPos, feed, spindle, progreso)

### Fase 3 — Calibración e imagen
- [x] Texto a contornos (opentype.js + Inter)
- [x] Material Test (potencia × velocidad) con overrides por celda
- [x] Interval Test
- [x] Capa `NOTES` no output
- [x] Adjust Image con previsualización
- [x] Trace Image (mono/color)
- [x] Add Tabs
- [x] Optimización de recorridos (nearest neighbour)
- [x] Corrección de estadísticas de viaje/tiempo

### Compatibilidad LightBurn
- [x] Importar `.lbrn` y `.lbrn2` (Rect/Ellipse/Polygon/Path/Group/Text/Bitmap)
- [x] Soporte de `VertList` compacto y `V`/`P` legado
- [x] Soporte de plantillas `VertID`/`PrimID`
- [x] Importar `CutSetting` (modo, velocidad, potencia, pasadas, intervalo)
- [x] Exportar `.lbrn` legado
- [x] Exportar `.lbrn2` compacto
- [x] Texto exportado como contornos
- [x] Imágenes exportadas como `Bitmap`
- [x] Validación round-trip con archivos reales de ejemplo

### Portapapeles
- [x] Pegar vectores de Inkscape como paths editables (prioridad SVG sobre la miniatura raster; soporte de `image/x-inkscape-compressed-svg`)
- [x] Clipboard revalidado para Electron 45+ (API W3C async): se detectan los formatos raw `electron application/osclipboard;format="…"` (Inkscape Linux/macOS/Windows) y se decodifican SVG en UTF-8, UTF-16LE, gzip, zlib y deflate
- [x] Imágenes pegadas/importadas van a una capa en modo **Image** (reutiliza una existente o crea `C00`, `C01`…), como LightBurn; así aparecen en la Preview y se graban sin cambiar la capa a mano
- [x] Pegar en su sitio (`Alt+V`)
- [x] Todos los "Paste" (Ctrl+V, toolbar, **Edit → Paste / Paste in Place**, menú contextual del lienzo) usan el portapapeles interno y, si está vacío, caen automáticamente al del sistema (y `Edit → Paste from Clipboard` fuerza el sistema)
- [x] Tests e2e del pegado por menú (Edit → Paste, menú contextual → Paste / Paste from clipboard) contra el clipboard real de Electron
- [x] SVG pegado/importado como **solo trazo** (se descarta el relleno original), igual que el modo Line de LightBurn
- [x] Tamaño físico correcto al pegar/importar SVG (se normalizan `mm`/`cm`/`in`/`pt` y el `style` del root; la escala se aplica tras parsear a escala 1)
- [x] Texto trazado automáticamente al generar el GCode/Preview (no hace falta *Convert to Path*), como LightBurn
- [x] Relleno (Fill) con agujeros: letras y vectores importados respetan los contracaracteres (regla even-odd), dejando en blanco el interior de "e", "o", "a"…
- [x] Fill de un path con **subpaths anidados** (rectángulo con vectores dentro): los interiores actúan como agujeros del mismo path, como en LightBurn

### Atajos estilo LightBurn
- [x] Flip horizontal/vertical con `H` / `V` (y `Ctrl+H`)
- [x] Rotar 90° con `.` / `,`
- [x] Agrupar/desagrupar (`Ctrl+G` / `Ctrl+U`), rehacer (`Ctrl+Shift+Z`)
- [x] Break apart (`Alt+B`), zoom (`+` / `-`), encuadrar selección (`Ctrl+Shift+A`)
- [x] Herramienta de selección movida a `S`; paneo solo con espacio/botón central
- [x] Mirror across line (`Ctrl+Shift+M`), delete duplicates (`Alt+D`), invert selection (`Ctrl+Shift+I`), two-point rotate (`Ctrl+2`)

---

## 🚧 Próximos pasos

Orden sugerido: (1) higiene de release `0.8.1`, (2) **P6 — fundamentos** +
seguridad, (3) **P1 — editor**, (4) **P2 — cortes/capas**, (5) **P3 — máquina/taller**,
y (6) hardware (rotary/cámaras/DSP) cuando haya máquinas para probar. Detalle en
[TODO.md](TODO.md#-paridad-con-lightburn-feature-parity).

### 🚀 Auto-update (prioridad máxima)
- [x] `electron-updater` en el proceso principal, con eventos main → preload → renderer
- [x] Comprobación en segundo plano al arrancar (5 s) y manual desde **Help → Check for Updates…**
- [x] Descarga automática con progreso, banner en la app y aviso *Restart & install*
- [x] `build.publish` apuntando a GitHub Releases (`latest.yml` / `latest-*.yml`)
- [x] Workflow de release por tag `v*` para Linux, Windows y macOS
- [ ] Firma de código (certificado Windows y notarización de macOS): prerrequisito para evitar avisos del sistema y para actualizar macOS en producción
- [ ] 🟡 Auto-update de macOS: sin firma, `electron/updater.ts` intenta actualizar y muestra error en vez de "no disponible" (reportar `disabled` con explicación)
- [ ] 🟡 Gate de release sobre CI verde (hoy `release.yml` se publica con independencia de CI)
- [ ] Canales beta/stable y rollback de versiones
- [x] Repin del Flatpak a la última release (manifest apuntando a `v0.8.0`); seguimiento de Flathub pendiente
- [ ] Regenerar `flatpak/node-sources.json` para v0.8.0 (nuevas deps: `electron-updater`, `vitest`, `playwright`, `jsdom`…) con `flatpak-node-generator npm package-lock.json -o flatpak/node-sources.json`; el build offline de Flatpak fallará hasta entonces

### 🧪 Tests automatizados
Política, plantillas y cómo mockear los límites: [AGENTS.md](AGENTS.md).
- [x] Infraestructura: Vitest + jsdom + Testing Library (`vitest.config.ts`, `src/test/setup.ts`)
- [x] E2E con Playwright `_electron` (`playwright.config.ts`, specs en `e2e/`)
- [x] Primeros tests: unidades, serialización `.obrn`, `gcode/types`, `gcode/optimize`, `updateStore`, `UpdateDialog` y `electron/updater`
- [x] Scripts `test`, `test:unit`, `test:watch`, `test:coverage`, `test:e2e`
- [x] CI: typecheck + unit + build, y job de e2e con `xvfb`
- [x] Procedimiento estándar documentado en `AGENTS.md`
- [ ] Ampliar cobertura: round-trip `io/lightburn`, `core/serialize`, `geometry/offset`, `serial/grbl` y simulador
- [ ] E2E de flujos completos: dibujar/transformar, import/export `.obrn`/`.lbrn2`, preview y job en el simulador
- [ ] Umbral de cobertura mínimo en CI (p. ej. 60 % en `src/core` y `src/gcode`)
- [ ] Linter + formateo (ESLint + Prettier) y pre-commit hook
- [ ] Dependabot/renovate + `npm audit` en CI
- [ ] Fuzz/property tests de los parsers `.lbrn2`/SVG/DXF con archivos malformados
- [ ] Test e2e sobre la app **empaquetada** (el auto-update solo funciona con `app.isPackaged`)
- [ ] `electron-log` y crash reporting opt-in

### Calibración
- [x] **Focus Test** con eje Z (rampa de offsets y `G1 Z`)
- [x] Kerf compensation por capa y en la biblioteca de materiales
- [x] Ángulo de scan, cross-hatch y scan offset
- [x] Biblioteca de materiales editable con persistencia
- [x] Material Test con sublayers reales (una capa por celda)
- [x] Kerf Test (slot y span de líneas) con cálculo y aplicación del offset

### Imagen / vector
- [x] Trace por capas de color (una capa por color)
- [x] Preview del trazado antes de aplicar
- [x] Apply Mask to Image
- [x] Optimización de imágenes grandes (tiles)
- [x] Ajuste de imagen con curvas y niveles

### Control y hardware
- [ ] Rotary mode (cilindro, pasos/mm)
- [ ] Print & Cut y cámaras/overlays
- [x] Eje Z: offset por objeto, Focus Test y `G1 Z`
- [ ] Límites suaves y homing de Z
- [ ] Ruida/DSP (UDP)
- [ ] Galvo / EZCad (BSLFiber)
- [ ] Repeat marking / array desde la UI del láser
- [x] Estimación de tiempo con aceleraciones

### Producto
- [ ] Empaquetado firmado (AppImage/NSIS/DMG)
- [ ] Internacionalización (ES/EN)
- [ ] Persistencia de layout de paneles
- [ ] Páginas múltiples
- [ ] Accesibilidad y temas
- [ ] Gestores de paquetes: winget, Homebrew, AUR, `.deb`/`.rpm`, portable

### 🔐 Seguridad y hardening
- [ ] Habilitar `sandbox: true` en `BrowserWindow` (hoy `false`)
- [ ] Endurecer CSP: quitar `script-src 'unsafe-inline'`
- [ ] 🟡 Restringir los handlers `fs:readFile`/`fs:writeFile`/`readBinary` a rutas elegidas por el usuario (hoy aceptan cualquier ruta)
- [ ] `SECURITY.md` con política de reporte y respuesta
- [ ] Auditoría de dependencias en CI

### 🎯 Paridad con LightBurn (feature parity)

Funcionalidades que LightBurn tiene y que acercan OpenBurn al flujo de trabajo
real, organizadas por prioridad. Se usa 🟡 cuando ya existe una base en OpenBurn
y solo falta completar la paridad.

#### P1 — Editor (lo que se nota en los primeros 5 minutos)
- [ ] 🟡 **Edición de nodos completa**: añadir/eliminar nodos, convertir segmento recto ↔ curva, asas de Bézier independientes — hoy solo se arrastran anclas existentes
- [ ] 🟡 **Snapping**: a objetos (vértices, centros, intersecciones, punto medio) — hoy solo *snap to grid*
- [ ] **Guías inteligentes** (líneas de alineación al mover) y **guías arrastrables** desde las reglas
- [ ] 🟡 **Reglas reales** con medida de distancias durante el movimiento
- [ ] **Campos numéricos de forma**: posición, tamaño y ángulo con candado de proporción (hoy casi todo es arrastrar)
- [ ] **Selector de fuentes** del sistema + **texto sobre trazado** — hoy solo Inter (`src/text/outline.ts` mapea todo a Inter)
- [ ] **Biblioteca de formas** (engranaje, espiral, caja, teselaciones, formas paramétricas)
- [ ] Herramienta de **medida** ampliada: ángulo, radio, longitud de trazado
- [ ] **Escalar a tamaño físico exacto** con un solo dato (p. ej. "make it 90 mm")

#### P2 — Cortes y capas (lo que convierte migrar desde LightBurn)
- [ ] **Start From** (Absolute / Current Position / User Origin) — hoy solo hay `origin` de cama (bottom-left/top-left)
- [ ] **Job origin** con anillo visual de origen de usuario en el lienzo
- [ ] **Fire immediately** y velocidad de disparo por capa
- [ ] **Velocidad/potencia por objeto** visible y editable en la tabla Cuts/Layers
- [ ] **Cut order** por capa (orden de ejecución de segmentos) más fino
- [ ] **Optimización por capa** con *save settings as default*
- [ ] 🟡 **Biblioteca de materiales**: búsqueda, presets por modo e **import/export** — hoy es `localStorage` sin compartir
- [ ] **Velocidad de desplazamiento (travel)** por capa separada del rapid rate global

#### P3 — Máquina y taller
- [ ] **Editor `$$` de GRBL** (pasos/mm, aceleración, límites suaves, homing de Z)
- [ ] 🟡 **Selector de puerto serie** en lugar de auto-seleccionar el primero (ahora en limitaciones conocidas)
- [ ] 🟡 **Perfiles de máquina** independientes del documento — hoy el nombre "GRBL" ni se persiste
- [ ] **Reanudar trabajo desde línea N** / recuperar tras parada o corte de luz (diferenciador frente a LightBurn)
- [ ] **Historial de trabajos** y re-ejecución desde el panel Laser
- [ ] **Import/export de biblioteca de materiales** para compartir presets

#### P4 — Producción y posicionamiento
- [ ] **Nesting / auto-arrange** de piezas (empaquetado para aprovechar material)
- [ ] **Repeat marking** mejorado: array por filas/columnas fuera del diseño
- [ ] **Contorno de máquina (machine contour)** para previsualizar el área real de trabajo

#### P5 — Archivos e import/export
- [ ] **Exportar DXF** (hoy solo importa) y **PDF**
- [ ] Importar **`.ai` / `.eps`** y filtro de importación SVG para estilos de trazo
- [ ] 🟡 **Asociación de archivos** y abrir `.obrn`/`.lbrn2` con doble clic (*file associations* + single-instance)

#### P6 — Fundamentos de app de escritorio (transversal)
- [ ] **Autoguardado + recuperación** tras crash
- [ ] **Archivos recientes** / pantalla de bienvenida
- [ ] **Varios documentos** (pestañas o ventanas)
- [ ] **Drag & drop** de SVG/DXF/imagen al lienzo
- [ ] Restaurar **tamaño/posición de ventana**
- [ ] Límite de memoria del **undo** (snapshots acotados)

---

## ⚠️ Limitaciones conocidas

- La compatibilidad LightBurn está validada por round-trip contra archivos reales; **aún no se probó abriendo un `.lbrn2` exportado en LightBurn 2.x** en una máquina con LightBurn instalado.
- Los colores de capa exportados dependen del índice de paleta de LightBurn.
- Los grupos se aplanan y los overrides por objeto se convierten en ajustes de capa.
- Texto sin `BackupPath` al importar se aproxima con un `Textbox` (tamaño/fuente pueden diferir).
- Imágenes rotadas se exportan sin rotación.
- Trace limitado a 700 px de lado mayor.
- El raster de GCode se limita a 360 muestras por eje y muestrea la imagen por tiles (máx. 1600 px de lado).
- Rotary, cámaras, Print & Cut y DSP están pendientes.
- El puerto serie en Electron auto-selecciona el primer dispositivo (mejorable con un selector nativo).

---

## 🧪 Ideas / backlog

- Biblioteca de arte (SVG) integrada.
- Comparador de trabajos y versionado del diseño (undo persistente entre sesiones).
- Exportación directa a `.lbrn2` con subcapas y colores exactos.
- REST API / CLI para automatización.
- Web Worker para la generación de GCode (el raster grande bloquea la UI).
- Raster progresivo/streaming para levantar el límite de 360 muestras por eje.
- Sitio de documentación con buscador (hoy todo vive en `docs/`).
- Plantillas de issue/PR, `CODE_OF_CONDUCT.md`, etiquetas `good first issue`.
