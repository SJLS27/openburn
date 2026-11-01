# Changelog

Todas las novedades relevantes de OpenBurn. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa
[Versionado Semántico](https://semver.org/lang/es/).

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
