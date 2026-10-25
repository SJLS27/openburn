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
- [ ] Trace por capas de color (una capa por color)
- [ ] Preview del trazado antes de aplicar
- [ ] Apply Mask to Image
- [ ] Optimización de imágenes grandes (tiles)
- [ ] Ajuste de imagen con curvas y niveles

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
- El raster de GCode se limita a 360 muestras por eje.
- Rotary, cámaras, Print & Cut y DSP están pendientes.
- El puerto serie en Electron auto-selecciona el primer dispositivo (mejorable con un selector nativo).

---

## 🧪 Ideas / backlog

- Presets de proyecto y plantillas de material.
- Biblioteca de arte (SVG) integrada.
- Comparador de trabajos y versionado del diseño.
- Exportación directa a `.lbrn2` con subcapas y colores exactos.
- REST API / CLI para automatización.
