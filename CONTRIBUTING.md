# Contribuir a OpenBurn

¡Gracias por tu interés! Este proyecto es open source y las contribuciones son bienvenidas.

## Antes de empezar

- Busca issues abiertos o abre uno para discutir cambios grandes.
- Para cambios pequeños (typos, docs, fixes) puedes abrir un PR directamente.
- Respeta el código de conducta implícito: sé respetuoso y constructivo.

## Flujo

1. Haz un fork del repo y crea una rama:
   ```bash
   git checkout -b feature/mi-aporte
   ```
2. Instala dependencias:
   ```bash
   npm install
   ```
3. Implementa el cambio manteniendo el estilo y la arquitectura existente.
4. Añade tests que cubran el cambio (ver [AGENTS.md](AGENTS.md)).
5. Verifica:
   ```bash
   npm run typecheck
   npm run test
   npm run build
   ```
   Para cambios de escritorio, ejecuta también `npm run test:e2e`.
6. Prueba manualmente el flujo afectado (crear formas, importar/exportar, preview, simulador GRBL).
7. Abre un Pull Request describiendo el cambio, capturas si aplica y limitaciones.

## Tests

La política completa está en [AGENTS.md](AGENTS.md). En resumen:

- **Unitarios/componentes**: Vitest (`npm run test`), archivos `*.test.ts(x)`
  junto al módulo.
- **End-to-end**: Playwright lanzando Electron (`npm run test:e2e`), en `e2e/`.
- Toda feature nueva debe traer tests y todo bug fix un test de regresión.
- No se acepta un PR con `typecheck`, `test` o `build` en rojo.

## Estilo

- TypeScript estricto.
- Componentes funcionales de React y CSS global existente.
- Comandos del lienzo a través de `WorkspaceController` (para historial).
- Propiedades serializables nuevas → añadir a `FabricObject.customProperties`.
- Documenta nuevas limitaciones en `docs/` y `TODO.md`.

## Reportar bugs

Incluye:
- Sistema operativo y versión de OpenBurn.
- Pasos para reproducir.
- Archivo `.obrn`/`.lbrn2` o SVG mínimo si aplica.
- Logs de la consola (DevTools) y captura.

## Licencia

Al contribuir aceptas que tu aporte se publique bajo la licencia MIT del proyecto.
