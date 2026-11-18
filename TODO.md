# OpenBurn — TODO & Roadmap

Estado actual: **v0.11.1**. Esta lista se actualiza con cada bloque de trabajo.

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
- [x] Preview **vectorial** (SVG con `viewBox` en mm, zoom sin pérdida): cama, rejilla, travel, toolpaths y grabado de imágenes desde sus scanlines, tonado por potencia — `src/ui/previewPaths.ts`
- [x] Grabado de imágenes como **textura raster** reconstruida desde `powers[]` (`src/gcode/rasterTexture.ts`), revelada fila a fila y fiel al dithering/modos continuos
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
- [x] El paneo con botón central no dispara el pegado de la selección primaria (X11) mientras se arrastra el lienzo
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

Orden sugerido: **seguridad** + **P1 — editor**, **P2 — cortes/capas**, **P3 —
máquina/taller**, hardware (rotary/cámaras/DSP) cuando haya máquinas para probar,
y P6b (varios documentos) cuando el store pase a multi-documento. Detalle en
[TODO.md](TODO.md#-paridad-con-lightburn-feature-parity).

> ⚠️ **Antes de la próxima release:** la deuda viva está en
> [🔐 Seguridad](#-seguridad-y-hardening) (`sandbox`, CSP) y en el
> [🔁 Circuito de release](#-circuito-de-release). Lo que bloqueaba 0.11.1
> (arranque sin fuentes, `fs:*`, `.ttc`, script del Flatpak y gate del tag) ya
> está resuelto.

### 🖥️ Arranque sin fuentes del sistema ✅

**Resuelto.** En sistemas sin ninguna fuente, Chromium abortaba en
`SkFontMgr_FontConfigInterface` (`FATAL: Not implemented`) antes de crear la
ventana. Como lee `fontconfig` antes de ejecutar cualquier JS de la app, no se
puede arreglar en el mismo arranque: `electron/fontFallback.ts` detecta el caso
(`fc-list` + los `<dir>` del `fonts.conf` del sistema), escribe un `fontconfig`
que añade la Inter incluida y **reinicia una vez** con `FONTCONFIG_FILE`
apuntando a él. Si el reinicio tampoco encuentra fuentes, sale un diálogo
*No fonts found* en vez de un SIGTRAP. Las máquinas con fuentes no se tocan.

- [x] Detectarlo antes de crear la ventana y relanzar con la fuente incluida
- [x] Aviso claro (`No fonts found`) si el fallback no basta
- [x] Tests unitarios de la detección y del `fontconfig` generado
- [x] E2E `e2e/startup-fonts.spec.ts`: el primer arranque deja el fallback y el
  proceso relanzado **no** emite el `FATAL` de Skia
- [x] Documentado en `docs/USAGE.md` (requisitos)
- [ ] Verificar el diálogo *No fonts found* de forma automatizada (hoy depende de
  un entorno sin fuentes ni Inter empaquetada)

### 🔤 Soporte de colecciones de fuentes (`.ttc`) ✅

**Resuelto.** `opentype.js` rechaza la firma `ttcf`, así que las colecciones
(`.ttc`/`.otc`, donde van Arial y Times New Roman en Windows/macOS) no aparecían
en el selector. `electron/fontCollection.ts` las abre: reubica los directorios de
cada cara y copia sus tablas con offsets absolutos, y `expandCollections` lista
una entrada por cara como `ruta#índice`, que `fonts:read` extrae bajo demanda
con la misma allow-list.

- [x] Parsear la colección y listar cada cara con su familia y estilo reales
  (`readNames` lee la tabla `name` sin parsear contornos, así que también
  funciona con CFF2, que `opentype.js` no soporta)
- [x] Leer una cara concreta desde el renderer (`path#index`)
- [x] Fuentes variables: se detecta el eje `wght` (`fvar`) y la cara se lista como
  regular y bold cuando su rango llega a 600
- [ ] Instanciar el peso pedido de una fuente variable: `opentype.js` 1.3 no
  implementa `getVariation`, así que una variable se contornea con su instancia
  por defecto (el peso correcto exige actualizar la dependencia)
- [x] Tests con fuentes reales generadas por `opentype.js` y empaquetadas en un
  `.ttc` (`electron/fontCollection.test.ts`) y e2e del IPC en
  `e2e/system-fonts.spec.ts`

### 🔁 Circuito de release

Lecciones del release de 0.11.1 (el primer intento falló y hubo que mover la
etiqueta):

- [x] Un fallo de test dependía de las fuentes instaladas en el runner de CI.
  `registerFontHandlers` acepta la fuente de datos y `listSystemFonts` acepta el
  ejecutor de `fc-list`, así que el escaneo de Linux se prueba con una salida
  fija. Barrido del resto: el updater mockea `electron-updater`/`codesign` y
  fuerza `process.platform`; `pathAllowList` y `fontFallback` usan directorios
  temporales; ningún test hace red ni depende del reloj.
- [x] El gate de release valida CI sobre el commit del tag (`workflow_call` con
  `commit: github.sha` y checkout de esa referencia).
- [x] `docs/DEVELOPMENT.md` documenta cómo re-taggear un release fallido.

### 📦 Empaquetado local (Flatpak)

- [x] `scripts/flatpak-local.sh` deriva el tag de `package.json` (el bloque `git`
  del manifiesto se sustituye por el `dir` del worktree con una regex).

### 🚀 Auto-update (prioridad máxima)
- [x] `electron-updater` en el proceso principal, con eventos main → preload → renderer
- [x] Comprobación en segundo plano al arrancar (5 s) y manual desde **Help → Check for Updates…**
- [x] Descarga automática con progreso, banner en la app y aviso *Restart & install*
- [x] `build.publish` apuntando a GitHub Releases (`latest.yml` / `latest-*.yml`)
- [x] Workflow de release por tag `v*` para Linux, Windows y macOS
- [ ] Firma de código (certificado Windows y notarización de macOS): prerrequisito para evitar avisos del sistema y para actualizar macOS en producción
- [x] Auto-update de macOS: sin firma, `electron/updater.ts` reporta `disabled` con explicación (detección con `codesign`) en vez de error
- [x] Gate de release sobre CI verde (`release.yml` reutiliza el workflow de CI)
- [ ] Canales beta/stable y rollback de versiones
- [x] Repin del Flatpak a la última release (manifest apuntando a `v0.11.1`); seguimiento de Flathub pendiente
- [x] Regenerar `flatpak/node-sources.json` para v0.8.1 (nuevas deps: `electron-updater`, `vitest`, `playwright`, `jsdom`…) con `flatpak-node-generator`; CI valida la cobertura con `npm run check:flatpak-sources`

### 🌐 Web pública
- [x] Landing bilingüe (EN/ES) en `website/` con Astro, SEO técnico, schema.org, sitemap y `robots.txt`
- [x] CI de la web: `astro check`, build, smoke tests y chequeo de enlaces internos
- [x] Página de apoyo/patrocinio bilingüe sin cookies ni anuncios, con GitHub Sponsors
- [x] Publicar en Cloudflare Pages: <https://openburn.pages.dev> (proyecto direct-upload con Wrangler)
- [x] Verificar la propiedad en Google Search Console (archivo HTML, 1 nov 2026)
- [ ] Enviar `sitemap-index.xml` en Search Console y solicitar indexación de las páginas principales
- [ ] Alta en Bing Webmaster Tools importando la propiedad desde Search Console
- [ ] Crear la cuenta GoatCounter `openburn` y comprobar que el script registra visitas
- [x] Campo *Website* y topics del repo
- [ ] Backlinks: Flathub, AlternativeTo, Product Hunt, Reddit/HN

### 🧪 Tests automatizados
Política, plantillas y cómo mockear los límites: [AGENTS.md](AGENTS.md).
- [x] Infraestructura: Vitest + jsdom + Testing Library (`vitest.config.ts`, `src/test/setup.ts`)
- [x] E2E con Playwright `_electron` (`playwright.config.ts`, specs en `e2e/`)
- [x] Primeros tests: unidades, serialización `.obrn`, `gcode/types`, `gcode/optimize`, `updateStore`, `UpdateDialog` y `electron/updater`
- [x] Scripts `test`, `test:unit`, `test:watch`, `test:coverage`, `test:e2e`
- [x] CI: typecheck + unit + build, y job de e2e con `xvfb`
- [x] Tests de P6: `windowState`, `storage`, `autosave`, `recentFiles`, `HistoryBuffer`, `dropRouting`, diálogos de bienvenida/recuperación/descarte y e2e de recuperación tras crash, drag & drop, recientes y tamaño de ventana
- [x] Procedimiento estándar documentado en `AGENTS.md`
- [x] `workspace/nodes`, `workspace/snap`, `state/snapSettings` y `ui/StatusBar` (snap)
- [x] Ampliar cobertura: round-trip `io/lightburn`, `core/serialize`, `geometry/offset`, `serial/grbl` y simulador (`src/io/lightburn.test.ts` con fixtures de texto; resto pendiente)
- [x] E2E de edición de nodos y snapping (`e2e/nodes-snap.spec.ts`)
- [x] Ciclo de desarrollo headless (`dev:build`, `test:e2e:fast`, `test:e2e:watch`); el Flatpak se verifica con `flatpak info` sin abrir la app
- [ ] `WorkspaceController.test.ts` con un `Canvas` falso para cubrir nodos/snapping sin Electron
- [ ] E2E de flujos completos: dibujar/transformar, import/export `.obrn`/`.lbrn2`, preview y job en el simulador
- [ ] Captura e2e de la Preview con una **imagen raster real** (dither + grayscale): la demo actual (`e2e/demo.ts`) usa solo vectores; el motor de textura (`rasterTexture`) está cubierto por tests unitarios, pero falta el smoke visual del `<image>` en Playwright
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
- [x] Firmware xTool (D1): detección con `$I`, jog con `M2` y sondeo `?\n`
- [ ] xTool: verificar Pause/Stop, progreso y trabajos largos en hardware real

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
- [x] Restringir los handlers `fs:readFile`/`fs:writeFile`/`readBinary` a rutas
  elegidas por el usuario (`electron/pathAllowList.ts`, e2e `file-access`).
- [ ] `SECURITY.md` con política de reporte y respuesta
- [ ] Auditoría de dependencias en CI

### 🎯 Paridad con LightBurn (feature parity)

Funcionalidades que LightBurn tiene y que acercan OpenBurn al flujo de trabajo
real, organizadas por prioridad. Se usa 🟡 cuando ya existe una base en OpenBurn
y solo falta completar la paridad.

#### P1 — Editor (lo que se nota en los primeros 5 minutos)
- [x] **Edición de nodos completa**: añadir (doble clic en el segmento) y eliminar nodos, convertir recta ↔ curva, asas de Bézier con nodos *corner / smooth / symmetric* y `Shift+Alt` para independizarlas — `src/workspace/nodes.ts`
- [x] **Importar el texto de LightBurn como texto editable** (`Str`/`H`/`Font`/`Ah`/`Av` → `Textbox`; los contornos de `BackupPath` quedan como respaldo) — GitHub #1, fixture `sveca2-slovenski.lbrn2`
- [x] **Snapping**: rejilla, vértices, centros, puntos medios e intersecciones, con radio en píxeles, guías al mover y opciones en la barra de estado — `src/workspace/snap.ts`
- [ ] **Guías inteligentes** (líneas de alineación al mover) y **guías arrastrables** desde las reglas — ver bloque *Siguiente update*
- [x] **Reglas reales** en los bordes del viewport, con marcador del puntero y medida de distancias durante el movimiento (`src/workspace/ruler.ts`, `src/workspace/measure.ts`)
- [x] **Campos numéricos de forma**: posición, tamaño y ángulo del bounding box con candado de proporción (también en el arrastre de esquinas)
- [x] **Alineación de texto** horizontal (izquierda / centro / derecha) en la barra de texto y en *Tools*, incluida la exportación a contornos
- [x] **Alineación vertical de texto** (arriba / centro / abajo) al importar `.lbrn2` (`Av` → `originY`); falta exponerla en la barra de texto
- [x] **Selector de fuentes** del sistema (`fonts:list` + `fonts:read` con allow-list) y **texto con fuentes instaladas** en Preview/GCode/export; fallback a Inter con aviso — `electron/fonts.ts`, `src/text/outline.ts`
- [ ] **Texto sobre trazado**
- [ ] **Biblioteca de formas** (engranaje, espiral, caja, teselaciones, formas paramétricas)
- [ ] Herramienta de **medida** ampliada: ángulo, radio, longitud de trazado
- [ ] **Escalar a tamaño físico exacto** con un solo dato (p. ej. "make it 90 mm")

#### 🔭 Siguiente update — nodos y snapping, fase 2

Este bloque **extiende** los contratos de *Edición de nodos completa* y
*Snapping* (P1). No los reformula: `SnapKind`, `SnapTarget`, `SnapOptions`,
`NodeType` y `snapSettings` se congelan aquí y todo lo siguiente se añade como
consumidor (nuevo `kind`, nuevo `source`, nueva propiedad del bloque). No hace
falta migrar documentos ni preferencias guardadas.

| Qué | Dónde engancha | Nota de implementación |
| --- | --- | --- |
| **Guías inteligentes** (alineación al mover) | `SnapTarget.kind = 'guide'` (ya reservado en `src/workspace/snap.ts`) | Las guías rojas actuales de `snapDragDelta` ya calculan `guideX`/`guideY`; falta persistir las guías y renderizarlas sin clic. |
| **Guías arrastrables desde las reglas** | Se guardan en el **documento**, no en `snapSettings` | Entran como `SnapShape` extra en `collectSnapTargets`, así el motor no cambia. |
| **Tangentes y centros de arco** | Nuevos `SnapKind`: `tangent`, `arcCenter` | `KIND_PRIORITY` es un `Record<SnapKind, number>`: añadir la clave basta. |
| **Texto sobre trazado** | `parsePath`/`buildPath` de `src/workspace/nodes.ts` | El modelo ya soporta asas independientes y `closingCurve`; no toca el nodo. |
| **Multi-selección de nodos con marco** | `nodeSelected` + `selectNode` del controlador | `removeNodes` ya borra varios a la vez con índices independientes. |
| **Snap desde el panel numérico** (X/Y/W/H) | `snapPoint` con `zoom` fijo a 1 | El panel aplica `applyNumeric`; el snap sería un ajuste previo del valor. |
| **Cortar nodo / insertar desde menú contextual** | `insertNode`/`removeNodes` | El doble clic ya existe; el menú añade el "cut" a mitad de segmento (usa `splitCubic`). |
| **Previsualización del tipo de nodo** | `NodeType` cerrado a 3 valores | Si se necesita un cuarto tipo (p. ej. `cusp`) se añade a la unión, no a la estructura del nodo. |

#### P2 — Cortes y capas (lo que convierte migrar desde LightBurn)
- [x] **Start From** parcial: origen de cama en cualquiera de las cuatro esquinas (bottom-left / top-left / bottom-right / top-right) con espejo de X/Y en el GCode — GitHub #5. Falta *Current Position* y *User Origin*.
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
- [x] **Autoguardado + recuperación** tras crash (borrador en `userData`, `RecoveryDialog`)
- [x] **Archivos recientes** (10 rutas, `File → Open Recent`) / pantalla de bienvenida
- [ ] **Varios documentos** (pestañas o ventanas) — P6b: requiere `AppStore` multi-documento y un canvas por documento
- [x] **Drag & drop** de SVG/DXF/imágenes y proyectos `.obrn`/`.lbrn2` al lienzo (posición del drop, `webUtils.getPathForFile`)
- [x] Restaurar **tamaño/posición de ventana** (validado contra los monitores actuales, flag maximizada)
- [x] Límite de memoria del **undo** (`HistoryBuffer`: 64 MB y 100 entradas)

---

## 📸 Documentación y capturas

- [x] **README bilingüe**: `README.md` (inglés) y `README.es.md`, banner y badges
  propios en `docs/brand/` (`npm run docs:brand`).
- [x] **Capturas reproducibles**: `npm run docs:screenshots` (manifest + WebP de
  la web) e `npm run docs:icon`. Requiere build de depuración y
  `CAPTURE_DOCS=1`; CI no las ejecuta. Proceso en `docs/DEVELOPMENT.md`.
- [ ] Icono de aplicación definitivo (`.icns` / `.ico` / PNG de 512) a partir de
  `docs/app-icon.png` e integración en electron-builder y Flatpak.

### Migración a Tauri (exploración)

Idea abierta, sin versión asignada: evaluar si merece la pena sustituir
Electron por Tauri (Rust + webview del sistema) para reducir el instalador y el
consumo de memoria.

- Qué habría que rehacer: `electron/` → `src-tauri/` (ventana, IPC y diálogos),
  `electron-updater` → `tauri-plugin-updater`, Web Serial → plugin de serie
  nativo, `app:readAsset` → recursos empaquetados y la política de permisos de
  serial en Linux.
- Qué se mantiene: todo `src/` (React + Fabric/Paper + store), `e2e/` con
  Playwright web y `.obrn`/`.lbrn2`.
- Por qué merece la pena estudiarla: AppImage de menor tamaño, arranque más
  rápido y menos RAM; frente a ello, más dependencia de la webview del sistema y
  del toolchain de Rust.

---

## ⚠️ Limitaciones conocidas

- La compatibilidad LightBurn está validada por round-trip contra archivos reales; **aún no se probó abriendo un `.lbrn2` exportado en LightBurn 2.x** en una máquina con LightBurn instalado.
- Los colores de capa exportados dependen del índice de paleta de LightBurn.
- Los grupos se aplanan y los overrides por objeto se convierten en ajustes de capa.
- Texto importado de LightBurn ya es editable (GitHub #1); las fuentes no instaladas se dibujan con Inter al previsualizar.
- Imágenes rotadas se exportan sin rotación.
- Trace limitado a 700 px de lado mayor.
- El raster de GCode se limita a 360 muestras por eje y muestrea la imagen por tiles (máx. 1600 px de lado).
- Rotary, cámaras, Print & Cut y DSP están pendientes.
- xTool D1: solo se validó conexión y jog en hardware (fw 40.30.002.01). El firmware ejecuta el movimiento al recibir `M2`, así que el progreso del trabajo puede adelantarse al láser, y no se verificó si respeta `!`, `~` y `Ctrl+X` (Pause/Stop).

---

## 🧪 Ideas / backlog

- Biblioteca de arte (SVG) integrada.
- Comparador de trabajos y versionado del diseño (undo persistente entre sesiones).
- Exportación directa a `.lbrn2` con subcapas y colores exactos.
- REST API / CLI para automatización.
- ❌ **Web Worker para la generación de GCode** — medido y descartado por ahora.
  `BENCH=1 npx vitest run --project jsdom src/gcode/job.bench.test.ts` en un
  Ryzen 12 hilos: **200 rellenos → 1275 ms**, de los cuales el planificador son
  **175 ms** y Paper.js **1100 ms** (`getIntersections` 722 ms + importar el SVG
  de cada objeto 350 ms). Un trabajador resuelve como mucho los 175 ms y además
  obliga a portar Fabric y Paper, que necesitan canvas: el coste supera la
  ganancia. Las dos vías que sí atacan el 86 % restante quedan abiertas:
  - [ ] **Sacar las formas simples de Paper**: el relleno de un `Rect`/`Ellipse`
    es analítico (scanlines contra la caja o el círculo), sin `importSVG` ni
    `getIntersections`.
  - [ ] **Cachear contornos** por objeto hasta que cambie su geometría, para que
    reabrir la Preview no repita el trabajo.
  Vuelve a medir el benchmark después de cualquiera de las dos.
- Raster progresivo/streaming para levantar el límite de 360 muestras por eje.
- Sitio de documentación con buscador (hoy todo vive en `docs/`).
- Plantillas de issue/PR, `CODE_OF_CONDUCT.md`, etiquetas `good first issue`.

### Serie / firmware (tras los PRs #3 y #4)
- [x] Selector de puerto serie real en escritorio (`SerialPortDialog` + `electron/serialPort.ts`).
- [ ] E2E del diálogo de puerto: el proceso principal simula `select-serial-port` y se
  comprueba que el diálogo elige el USB y no `ttyS0` (hoy solo hay tests unitarios y de
  componente).
- [ ] Verificar Pause/Stop (`!`, `~`, `Ctrl+X`) y el progreso del job en un xTool real;
  hoy el firmware solo mueve al recibir `M2`.
- [x] Revisar que `openburn.device` antiguo sin `firmware` arranca en `auto` (el spread
  de `loadDevice` lo cubre, y `src/state/store.test.ts` tiene un test explícito de migración).
