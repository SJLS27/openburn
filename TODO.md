# OpenBurn — TODO & Roadmap

Estado actual: **v0.6.1**. Esta lista se actualiza con cada bloque de trabajo.

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
- [x] Pegar en su sitio (`Alt+V`)
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
- [ ] Estimación de tiempo con aceleraciones

### Producto
- [ ] Empaquetado firmado (AppImage/NSIS/DMG) y auto-update
- [ ] Tests automatizados (unitarios + e2e) en CI
- [ ] Internacionalización (ES/EN)
- [ ] Persistencia de layout de paneles
- [ ] Páginas múltiples
- [ ] Accesibilidad y temas

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

- Presets de proyecto y plantillas de material.
- Biblioteca de arte (SVG) integrada.
- Comparador de trabajos y versionado del diseño.
- Exportación directa a `.lbrn2` con subcapas y colores exactos.
- REST API / CLI para automatización.
