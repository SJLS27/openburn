# Changelog

Todas las novedades relevantes de OpenBurn. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa
[Versionado Semántico](https://semver.org/lang/es/).

## [Unreleased]

### Añadido
- **Preview vectorial**: el Preview ya no dibuja un canvas de 780×500 fijo, sino
  un **SVG** cuyo `viewBox` cubre la cama en milímetros. Hacer zoom mueve esa
  caja en lugar de estirar píxeles, así que **no hay límite de nitidez**: líneas,
  reglas y detalles de 1 µm se ven igual de nítidos a 400×. El recorrido se anima
  por segmentos con `vectorEffect="non-scaling-stroke"`.
- **Raster sin bloque negro**: el grabado de imágenes se dibuja desde las
  *scanlines* reales del trabajo, con color según la potencia láser
  (`rasterPowerColor`), en vez de aplanar la imagen a un bitmap de fondo.

### Cambiado
- El Preview deja de usar `previewRaster.ts` (canvas + `ImageData`): toda la
  geometría vive en `src/ui/previewPaths.ts`, con tests puros.

## [0.11.1] - 2026-11-17

Publicado después de 0.11.0, que salió sin estos cambios: reúne los arreglos
para GitHub #1, #2 y #5.

### Añadido
- **Fuentes del sistema para cortar**: Preview, GCode, *Convert to Path* y la
  exportación `.lbrn2` usan la tipografía del texto si está instalada
  (`fc-list` en Linux, carpetas de fuentes en macOS/Windows). El selector de
  texto muestra las familias instaladas. Si la fuente no está, el texto se
  muestra con Inter, se avisa en la barra de estado y el nombre original queda
  en `lightburnFontFamily` para recuperarlo al instalar la fuente.
- **`fonts:list` / `fonts:read`** en el proceso principal con allow-list: el
  renderer solo puede leer archivos que aparecieron en el listado
  (`electron/fonts.ts`).
- **Origen de cama en las cuatro esquinas**: *Settings → Machine → Origin* y el
  panel Laser ofrecen *bottom-left*, *top-left*, *bottom-right* y *top-right*
  (GitHub #5). `src/gcode/origin.ts` espeja X y/o Y al emitir el GCode, y los
  valores antiguos o corruptos migran a `bottom-left`.
- **Firmware xTool (D1 y similares)**: al conectar se envía `$I` y, si el
  controlador responde `[XTool …]`, la app usa su juego de comandos (sondeo
  `?\n`, jog `G91`/`G1 … S0`/`G90`/`M2`, ruido `ok:` ignorado). Con 1,5 s sin
  respuesta se mantiene GRBL. Nuevo ajuste *Device → Firmware* (Auto-detect /
  GRBL / xTool) para forzarlo. Lógica en `src/serial/dialect.ts`.
- **Selector de puerto serie real en escritorio**: *Connect* muestra los puertos
  del sistema (`/dev/ttyUSB0`, `COM3`, `/dev/cu.usbserial-…`) con el chip USB
  descrito, preselecciona el adaptador y oculta los UART de la placa base.

### Arreglado
- **El texto importado de LightBurn ahora es editable** (GitHub #1): antes se
  importaba solo el contorno de `<BackupPath>` y no se podía editar. Ahora se
  crea un `Textbox` con la cadena (`Str`, ``&#10;`` como salto de línea), el
  tamaño (`H`), la fuente (`Font`) y la alineación (`Ah`/`Av`); los contornos se
  conservan en `lightburnBackupPath`. Verificado con `sveca2-slovenski.lbrn2`.
- **El icono de ajustes es un engranaje**: el dibujo anterior (círculo con ocho
  rayos) parecía el selector de tema claro/oscuro (GitHub #2).
- El proceso principal ya no elige el primer puerto `tty` (a menudo
  `/dev/ttyS0`): antes decía "conectado" mientras el GCode no llegaba a ningún
  sitio. El puerto elegido se muestra en el panel Laser.
- **Disconnect** cancela la lectura pendiente, así que el puerto se libera de
  verdad para otros programas.
- Las escrituras serie se serializan: un sondeo de estado que coincidía con un
  comando ya no falla por el writer bloqueado ni tumba la conexión.

### Limitaciones conocidas
- xTool solo se validó en conexión y jog (D1, fw 40.30.002.01); el progreso del
  trabajo puede adelantarse al cabezal y Pause/Stop no está verificado.
- **La app no arranca en un sistema sin ninguna fuente instalada**: Chromium
  aborta en Skia (`FATAL: Not implemented`) antes de crear la ventana. Es la
  máxima urgencia para la próxima release (ver `TODO.md`).
- Las colecciones `.ttc`/`.otc` (habituales en Windows y macOS) no se listan ni
  se usan para cortar, porque opentype.js no las parsea como una sola cara.

### Desarrollo
- Tests nuevos: `electron/serialPort.test.ts` (catálogo USB, recomendación de
  puerto y broker), `src/serial/transport.test.ts` (escrituras serializadas y
  cierre), `src/ui/SerialPortDialog.test.tsx` y `src/serial/dialect.test.ts`.
- Tests nuevos de este ciclo: `src/ui/icons.test.tsx`, `src/gcode/origin.test.ts`,
  `src/state/store.test.ts` (migración de `openburn.device`),
  `src/ui/common.origin.test.tsx`, `src/io/lightburn.test.ts` con fixtures en
  `src/io/__fixtures__/`, `electron/fonts.test.ts` (parseo de `fc-list`,
  heurística de nombres y allow-list) y `src/text/fontLibrary.test.ts` /
  `src/ui/fontFamilies.test.ts` (resolución por peso/estilo y filtrado).
- Contribuciones de [@pkkid](https://github.com/pkkid) (PRs #3 y #4).
- El e2e de edición de nodos espera a que la herramienta rectángulo esté activa
  antes de dibujar, en lugar de dar por hecho que la tecla `R` surtió efecto
  (`e2e/nodes-snap.spec.ts`).

## [0.11.0] - 2026-11-13

### Añadido
- **Edición de nodos completa**: la herramienta de nodos (`N`) muestra las asas
  de Bézier y permite arrastrarlas, añadir un nodo con doble clic sobre el
  segmento (división de De Casteljau, sin deformar la curva), eliminar nodos
  seleccionados con `Del`, cambiar el tipo de nodo (*Corner / Smooth /
  Symmetric*) y convertir segmentos entre recta y curva desde *Tools*. Para
  nodos suaves y simétricos las asas se mantienen colineales; `Shift+Alt` las
  independiza. El modelo vive en `src/workspace/nodes.ts` (solo `M/L/C/Z`,
  normalizando cuadráticas, arcos y atajos a cúbicas) y las curvas de cierre de
  los paths se conservan en `closingCurve`.
- **Snapping a objetos**: el motor `src/workspace/snap.ts` engancha vértices,
  centros, puntos medios e intersecciones además de la rejilla, con radio en
  píxeles de pantalla (constante con el zoom). Se aplica al crear formas, al
  mover una selección (con guías rojas de alineación) y al arrastrar nodos. El
  botón *Snap* de la barra de estado activa/desactiva y el botón `▾` abre las
  opciones (*Enable*, *Grid*, *Objects*, *Intersections* y radio de captura).
- **Preferencias de snapping versionadas** (`src/state/snapSettings.ts`,
  `openburn.snap`), con migración desde el antiguo booleano `snapToGrid`.

### Desarrollo
- **Ciclo de verificación headless**: `npm run dev:build` mantiene `dist/` y
  `dist-electron/` en watch sin abrir la app, `npm run test:e2e:fast` ejecuta
  Playwright contra el build existente y `npm run test:e2e:watch` combina ambos
  para iterar sin recompilar. La comprobación del Flatpak pasa a
  `scripts/flatpak-local.sh` + `flatpak info`, sin lanzar la aplicación.

### Preparado para lo siguiente
- Contratos estables para `SnapKind`/`SnapTarget` (con `guide` reservado) y
  `NodeType`: guías inteligentes, tangentes, texto sobre trazado y
  multi-selección de nodos entrarán como consumidores, sin migrar datos ni
  romper `.obrn`. Detalle en `TODO.md` → *Siguiente update — nodos y snapping,
  fase 2*.

### Corregido
- **`Del` en la herramienta de nodos** ya no borra el trazado completo: elimina
  solo los nodos seleccionados (el objeto se borra como siempre cuando no hay
  ningún nodo seleccionado).

### Documentación
- **README internacional**: el README principal pasa a inglés y la versión en
  español se conserva en `README.es.md`, con selectores de idioma en ambos.
  Estructura centrada en el lector (*Why OpenBurn*, *Quick start*, *Screenshots*)
  y badges propios del stack en `docs/brand/`.
- **Banner y recursos de marca** rediseñados (`docs/brand/banner.svg`,
  badges SVG del stack e icono `docs/app-icon.png`), generados por
  `npm run docs:brand` y `npm run docs:icon`.
- **Capturas actualizadas a la 0.10**: `e2e/screenshot-docs.spec.ts` (opt-in con
  `npm run docs:screenshots`) monta la escena con las herramientas reales y
  regenera `docs/screenshots/` y los WebP de la web. Las capturas muestran la
  edición de nodos, el snapping, el planner y la escena nueva con el logo
  vectorial.
- **Roadmap**: se anota la migración a Tauri como idea a explorar (enfoque
  multi-plataforma y tamaño del instalador).

## [0.10.0] — 2026-11-08

### Añadido
- **Alineación de texto** (izquierda / centro / derecha) desde la barra de
  texto y desde *Tools → Align Text …*. Actúa sobre el texto seleccionado,
  incluidos los textos dentro de un grupo, y el contorno exportado respeta la
  alineación. `applyTextStyle` acepta `textAlign` y el fingerprint de undo
  incluye alineación, peso, estilo, tracking e interlineado.
- **Reglas del workspace** ancladas a los bordes superior e izquierdo: siguen
  zoom y paneo (también en coordenadas negativas), marcan el origen de la cama
  y resaltan la posición del puntero.
- **Medida en vivo** al mover, escalar o rotar: `W × H`, `ΔX`/`ΔY`, ángulo y
  longitud de líneas, en un recuadro sobre el lienzo.
- **Candado de proporción** en Shape Properties. Con el candado activo, editar
  `W` o `H` ajusta la otra dimensión manteniendo la relación, y arrastrar una
  esquina escala proporcionalmente (mantén `Shift` para estirar libremente; con
  el candado desactivado, `Shift` fuerza la proporción).

### Cambiado
- **Preview más fluido**: la animación, el paneo y el zoom ya no recalculan
  todo en cada frame. El fondo se cachea en coordenadas de mundo y solo se
  recompone al mover la vista; los trazos ya grabados y las filas raster ya
  reveladas se acumulan en capas persistente, de modo que cada frame pinta
  únicamente lo nuevo. Los movimientos del ratón se agrupan en un frame de
  animación y el raster se escribe con `ImageData` en vez de `fillRect` por
  punto (la lógica pura vive en `src/ui/previewRaster.ts`).
- **Campos numéricos de forma**: `X`/`Y`/`W`/`H` operan sobre el bounding box
  de la selección. En objetos rotados el tamaño se resuelve de forma exacta
  (no basta con escalar los ejes locales), y el ángulo de una selección
  múltiple refleja la rotación real del grupo.

### Corregido
- **`npm run dev` / `npm run dev:electron`** ya no se cae al arrancar con
  `ELOOP: too many symbolic links` cuando existe `builddir/` (salida de
  `flatpak-builder`). Vite solo vigila las fuentes de la app y no sigue los
  árboles de montaje de los empaquetados.
- **Preview de imágenes**: las filas de un raster ya no se dibujan como líneas
  negras de borde a borde (que pintaban un rectángulo sólido). Se renderizan
  como píxeles grabados según la potencia y la capa se revela avanzando el
  trabajo.
- **Preview de imágenes (bloque negro)**: la capa raster se pre-renderizaba
  horneada al 32 % de opacidad y se reutilizaba para la parte ya grabada, así
  que la imagen nunca pasaba de la opacidad de fondo. Ahora el grabado se
  dibuja a opacidad completa y solo el fondo atenuado usa alpha bajo.
- **Rampa de potencia en la Preview**: el grabado usa una rampa cálida
  (transparente → ámbar → blanco) en lugar de gris, para distinguir un 20 % de
  un 100 % sobre la cama oscura.
- **Capa de imagen automática**: se crea con `Min power = 0`, porque el valor
  por defecto (20 %) grababa también las zonas blancas en modo Grayscale. La
  Preview avisa si una capa gris sigue con `Min power > 0`.
- **Consola**: el mensaje de bienvenida mostraba la versión fija `0.6.1`; ahora
  usa la versión del build (`__APP_VERSION__`).
- **Potencia del primer punto de una fila raster**: el primer movimiento de cada
  scanline usaba la potencia del segundo punto. Ahora la potencia de cada
  movimiento corresponde al punto anterior, igual que en la Preview (nueva
  utilidad `src/gcode/rasterPreview.ts`).

## [0.9.0] — 2026-11-01

Esta versión se centra en los **fundamentos de app de escritorio**: no perder
trabajo, retomar proyectos rápido y que la ventana y el lienzo se comporten como
en un programa nativo.

### Añadido
- **Autoguardado y recuperación**. Mientras hay cambios sin guardar se escribe
  un borrador en el perfil de la app (debounce de 2 s, flush máximo cada 30 s;
  al guardar o cerrar limpio se elimina). Si la app termina de golpe, el
  siguiente arranque ofrece **Recover Unsaved Work**.
- **Archivos recientes y pantalla de bienvenida**. Hasta 10 rutas en
  *File → Open Recent* (con *Clear Recent Files*) y un diálogo de inicio con
  New Design, Open Project y la lista de recientes.
- **Drag & drop** de `.obrn`, `.lbrn2`, SVG, DXF e imágenes sobre el lienzo. Los
  proyectos sustituyen el documento (con confirmación si hay cambios) y el
  artwork se importa en el punto donde se suelta. Usa `webUtils.getPathForFile`
  y cae a leer el `File` en el navegador.
- **Ventana persistente**: tamaño, posición y estado maximizado se restauran
  validándolos contra los monitores actuales (si el monitor desapareció, la
  ventana vuelve a un tamaño centrado seguro).
- **Historial acotado por memoria**: `HistoryBuffer` limita undo/redo a 64 MB y
  100 entradas, descartando los snapshots más antiguos. Importante con imágenes
  embebidas como data URLs.
- Confirmación **Guardar / Descartar / Cancelar** al crear, abrir, reabrir un
  reciente o soltar un proyecto si hay cambios sin guardar.
- `OPENBURN_USER_DATA_DIR` para aislar el perfil (usado por los e2e).

### Cambiado
- El título del documento al abrir un proyecto ahora es el nombre del archivo.
- Guardar y abrir proyectos actualiza la lista de recientes.
- Los e2e arrancan con un perfil temporal y ya no escriben en la configuración
  real del desarrollador.

### Pendiente
- **Varios documentos** (pestañas/ventanas) queda como P6b: requiere rediseñar
  el store y el controlador a multi-documento.

## [0.8.1] — 2026-11-01

Versión de mantenimiento centrada en que el canal de distribución y las
actualizaciones sean fiables.

### Añadido
- **Comprobación de las fuentes offline de Flatpak** (`npm run
  check:flatpak-sources`): valida que `flatpak/node-sources.json` cubre todos
  los tarballs de `package-lock.json` y los runtimes de Electron para x86_64 y
  aarch64. Se ejecuta en CI, así que una dependencia nueva sin regenerar las
  fuentes ya no rompe el build de Flatpak en silencio.

### Cambiado
- **Release gate sobre CI**: `release.yml` ya no publica con CI en rojo; el
  workflow reutiliza el de CI (`workflow_call`) y el job de publicación depende
  de él.
- `flatpak/node-sources.json` regenerado para las dependencias actuales
  (`electron-updater`, `electron-builder 26`, `vitest`, `playwright`, `jsdom`…).

### Corregido
- **Auto-update en macOS**: los builds sin firmar reportan `disabled` con una
  explicación y un enlace a GitHub Releases, en lugar de intentar actualizar y
  terminar en error. La firma se detecta una vez con `codesign` al arrancar.
- **El paneo con el botón central ya no pega contenido en Linux.** X11/Chromium
  convierte el clic central en un pegado de la selección primaria; ahora esos
  eventos se ignoran mientras se arrastra el lienzo. Cubierto por un test e2e.

## [0.8.0] — 2026-10-28

Esta versión se centra en el **flujo diario**: actualizaciones automáticas,
compatibilidad real con el portapapeles de Inkscape, imágenes que se graban sin
configuración manual y una base sólida de tests y CI.

### Añadido
- **Actualizaciones automáticas** con `electron-updater`: comprobación en segundo
  plano al arrancar (5 s), comprobación manual desde **Help → Check for
  Updates…**, descarga con progreso, banner en la app y *Restart & install*.
  Los builds empaquetados se publican en GitHub Releases mediante el workflow
  `release.yml` (AppImage, NSIS y DMG/ZIP) con `latest*.yml` para el updater.
- **Pegado de vectores de Inkscape como paths editables**. La lectura del
  portapapeles en Electron 45 se hace **por contenido**, no por nombre de
  formato, así que funciona con `image/svg+xml`,
  `image/x-inkscape-compressed-svg`, el envoltorio
  `electron application/osclipboard;format="…"` y los formatos de macOS/Windows.
  Se decodifica UTF-8, UTF-16LE, BOM, gzip, zlib, deflate raw y data URIs SVG.
- **Capa de imagen automática**: al pegar o importar una imagen se asigna a una
  capa en modo **Image** (reutiliza una existente o crea `C00`, `C01`…), como
  LightBurn. Así aparece en la Preview y se graba sin cambiar la capa a mano.
- **Paneo arrastrando con el botón central** del ratón, además de `Espacio` +
  arrastrar y la herramienta Pan.
- **Infraestructura de tests y CI**: Vitest + Testing Library para unidad y
  componentes, Playwright (`_electron`) para end-to-end, workflow de CI
  (typecheck + unit + build + e2e con `xvfb`), workflow de release por tag y
  política de testing en [`AGENTS.md`](AGENTS.md).
- Documentación actualizada: `README`, `docs/USAGE.md`, `docs/ARCHITECTURE.md`,
  `docs/DEVELOPMENT.md`, `TODO.md` y este changelog.

### Corregido
- **Pegado desde los menús**: `Edit → Paste`, `Edit → Paste in Place`, el menú
  contextual del lienzo y el botón de la barra ahora usan la misma lógica que
  `Ctrl+V`: pegan el portapapeles interno y, si está vacío, leen el del
  sistema. Se añadió `Edit → Paste from Clipboard`.
- El formato `image/x-inkscape-compressed-svg` se detecta correctamente tras la
  migración del portapapeles de Electron 45.
- La app ya no intenta actualizarse en builds no empaquetados, Flatpak o
  instalaciones Linux que no sean AppImage: muestra un estado `disabled` con
  explicación en lugar de un error.

### Cambiado
- Flatpak repineado al tag `v0.8.0`.
- **Node.js 22.22+** requerido (lo exige `jsdom` 30); CI y release usan Node 22.
- Las builds de escritorio ya no recompilan la dependencia nativa opcional `canvas`
  de Fabric (`npmRebuild: false`), que no se usa en Electron.

### Limitaciones conocidas
- **Sin firma de código** (Windows/macOS): el sistema puede mostrar avisos y la
  actualización automática en macOS no está operativa en producción hasta
  configurar la notarización.
- En Linux, la actualización automática requiere el build **AppImage**; Flatpak
  y los paquetes de distro se actualizan por su propia tienda.
- La firma de código está pendiente: Windows puede mostrar SmartScreen y macOS
  no puede autoactualizarse hasta configurar la notarización.

## [0.7.1] — 2026-10-25

### Añadido
- Actualización a **Electron 45** y empaquetado inicial de **Flatpak**.

### Cambiado
- El portapapeles usa la nueva API asíncrona estilo W3C de Electron 45.

## [0.7.0] y anteriores

Consulta el historial de commits y las releases en
[GitHub](https://github.com/SJLS27/openburn/releases).
