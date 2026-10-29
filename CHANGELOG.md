# Changelog

Todas las novedades relevantes de OpenBurn. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa
[Versionado Semántico](https://semver.org/lang/es/).

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
