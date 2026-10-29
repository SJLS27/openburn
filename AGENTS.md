# AGENTS.md — Guía para agentes y contribuidores

Este archivo describe **cómo trabajar en OpenBurn** y, sobre todo, **cómo verificar
que cada cambio funciona**. Cualquier agente automático o persona que toque el
repo debe seguirlo.

> OpenBurn es una app **Electron + React + TypeScript** para diseño y control de
> máquinas láser. El renderer se construye con Vite y el proceso principal con
> `tsc`. Antes de cambiar código, lee `docs/ARCHITECTURE.md`.

---

## 1. Comandos esenciales

| Comando | Qué hace |
| --- | --- |
| `npm install` | Instala dependencias |
| `npm run dev` | Renderer en el navegador (HMR) |
| `npm run dev:electron` | App de escritorio con Vite + Electron |
| `npm run typecheck` | `tsc --noEmit` sobre `src/` y `electron/` |
| `npm run build` | Typecheck + Vite + compilación del proceso principal |
| `npm run test` | Tests unitarios y de componentes (Vitest) |
| `npm run test:watch` | Vitest en modo watch |
| `npm run test:coverage` | Tests + informe de cobertura (`coverage/`) |
| `npm run test:e2e` | Build + tests end-to-end (Playwright + Electron) |
| `npm run build:app` | Instaladores con electron-builder |

Comprobación mínima antes de dar un cambio por terminado:

```bash
npm run typecheck && npm run test && npm run build
```

Para cambios que afecten a la UI de escritorio o al proceso principal, añade
además `npm run test:e2e` (en Linux sin pantalla: `xvfb-run -a npm run test:e2e`).

---

## 2. Política de testing

1. **Toda feature nueva debe incluir tests** que demuestren su funcionamiento.
2. **Todo bug fix debe incluir un test de regresión** que falle antes del arreglo
   y pase después.
3. Ningún PR se mergea si `typecheck`, `test` o `build` fallan.
4. Los tests no deben depender de red, hardware real ni del reloj del sistema
   (usa mocks y valores deterministas).
5. Si algo no se puede testear de forma automática, documéntalo en el PR y en
   `TODO.md`, y describe el procedimiento manual.

### Definition of done

- [ ] El código compila (`npm run typecheck`).
- [ ] Hay tests nuevos o actualizados que cubren el comportamiento añadido.
- [ ] `npm run test` pasa en local.
- [ ] `npm run build` pasa.
- [ ] Los flujos afectados de la UI tienen cobertura e2e o una nota manual.
- [ ] La documentación relevante (`README.md`, `docs/`, `TODO.md`) está al día.

---

## 3. Pirámide de tests

| Nivel | Herramienta | Dónde | Qué cubre |
| --- | --- | --- | --- |
| Unitario | Vitest (entorno `node` o `jsdom`) | `src/**/*.test.ts`, `electron/**/*.test.ts` | Lógica pura: unidades, geometría, GCode, planner, estado, serializadores, updater |
| Componente | Vitest + Testing Library + user-event | `src/**/*.test.tsx` | Paneles, diálogos, menús y otros componentes React, con los límites mockeados |
| End-to-end | Playwright (`_electron`) | `e2e/**/*.spec.ts` | App real: arranque, renderer, IPC, menús y flujos de escritorio |

Regla práctica: **empuja la lógica fuera de la UI** para poder testearla en el
nivel más bajo posible. Un test unitario rápido vale más que un e2e frágil.

### Dónde poner los tests

- Junto al módulo: `src/gcode/optimize.ts` → `src/gcode/optimize.test.ts`.
- Componentes: `src/ui/UpdateDialog.tsx` → `src/ui/UpdateDialog.test.tsx`.
- Proceso principal: `electron/updater.ts` → `electron/updater.test.ts`.
- E2E: `e2e/<flujo>.spec.ts`.
- Utilidades compartidas de test: `src/test/`.

No se incluyen tests en el bundle: `vitest.config.ts` los excluye de `dist/` y
`electron/tsconfig.json` los excluye de `dist-electron/`.

---

## 4. Configuración

- `vitest.config.ts` — entorno `jsdom`, alias `@/` → `src/`, `__APP_VERSION__`
  inyectado desde `package.json`, cobertura v8.
- `src/test/setup.ts` — matchers de `jest-dom`, `cleanup()` automático y stubs
  de APIs que jsdom no implementa (`matchMedia`, `ResizeObserver`,
  `IntersectionObserver`).
- `playwright.config.ts` — tests en `e2e/`, un worker, sin proyectos de
  navegador (Electron se lanza desde cada spec).

Para tests del proceso principal que no necesitan DOM, añade al inicio del
archivo:

```ts
// @vitest-environment node
```

---

## 5. Cómo escribir cada tipo de test

### 5.1 Unitario (lógica pura)

```ts
import { describe, expect, it } from 'vitest';
import { mmToDisplay } from '@/core/units';

describe('core/units', () => {
  it('converts mm to inches', () => {
    expect(mmToDisplay(25.4, 'in')).toBeCloseTo(1, 10);
  });
});
```

Buenos candidatos actuales: `src/core/`, `src/gcode/optimize.ts`,
`src/gcode/types.ts`, `src/io/lightburn.ts`, `src/core/serialize.ts`.

### 5.2 Componente

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyDialog } from '@/ui/MyDialog';

it('closes when the user confirms', async () => {
  const onClose = vi.fn();
  render(<MyDialog onClose={onClose} />);
  await userEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenCalled();
});
```

Para aislar el componente, mockea el store o el bridge **en lugar de** montar
Fabric/Paper:

```ts
const mocks = vi.hoisted(() => ({
  state: { current: { status: 'idle' } },
}));

vi.mock('@/state/updateStore', () => ({
  useUpdateState: () => mocks.state.current,
}));
```

### 5.3 End-to-end

```ts
import { test, expect, _electron as electron } from '@playwright/test';

test('opens the editor', async () => {
  const app = await electron.launch({ args: ['.', '--no-sandbox'] });
  const page = await app.firstWindow();
  await expect(page.locator('canvas').first()).toBeVisible();
  await app.close();
});
```

- Lanza la app desde la raíz del repo (usa `dist/` y `dist-electron/`, por eso
  `test:e2e` compila antes).
- Simula diálogos nativos desde el proceso principal:

```ts
await app.evaluate(({ dialog }, filePath) => {
  dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath });
}, '/tmp/out.obrn');
```

- Mantén los e2e pocos y centrados en flujos críticos; el resto va en unitarios.

---

## 6. Mockear los límites del sistema

### `window.openburn` (bridge de Electron)

El renderer funciona también en navegador, así que el bridge es opcional
(`window.openburn?`). En tests de componentes/estado se define a mano:

```ts
(window as unknown as { openburn: unknown }).openburn = {
  isElectron: true,
  platform: 'linux',
  updater: {
    getState: async () => ({ status: 'idle', currentVersion: '1.0.0' }),
    check: async () => ({ status: 'checking', currentVersion: '1.0.0' }),
    download: vi.fn(),
    install: vi.fn(async () => true),
    onEvent: vi.fn(() => () => {}),
    onOpenDialog: vi.fn(() => () => {}),
  },
};
```

Recuerda limpiar entre tests (`delete window.openburn`) y reiniciar módulos con
`vi.resetModules()` si el módulo guarda estado global (como `updateStore`).

### `electron` y `electron-updater`

Para el proceso principal, mockea ambos módulos y usa `vi.hoisted` para
compartir el estado mutable con la factoría de `vi.mock`. Ver
`electron/updater.test.ts` como referencia.

### Fabric.js / Paper.js

- Prefiere **no** importarlos en tests unitarios: extrae la lógica pura a
  módulos sin dependencias (`gcode/types.ts`, `gcode/optimize.ts`).
- Si necesitas geometría de Fabric/Paper, usa `// @vitest-environment jsdom` y
  construye objetos mínimos; evita `getContext('2d')` real.
- Para e2e, la app real ya monta Fabric/Paper: no hace falta mockear.

### Web Serial / máquina GRBL

Usa el **simulador** integrado (`MockTransport`) en lugar de hardware. Para
tests de la UI del panel Laser, mockea `@/serial/machine`.

### Tiempo y aleatoriedad

Usa `vi.useFakeTimers()` / `vi.setSystemTime()` y `vi.spyOn(Math, 'random')`.
Restaura siempre (`vi.useRealTimers()` en `afterEach`).

---

## 7. Auto-update: qué debe quedar cubierto

El sistema de actualizaciones tiene tres capas y cada una tiene su test:

| Capa | Archivo | Tests |
| --- | --- | --- |
| Proceso principal | `electron/updater.ts` | `electron/updater.test.ts`: deshabilitado en dev, ciclo `checking → available → downloading → downloaded`, error, notas de release, descarga/instalación condicionadas |
| Estado del renderer | `src/state/updateStore.ts` | `src/state/updateStore.test.ts`: sin bridge, hidratación, eventos, delegación, evento de menú nativo |
| UI | `src/ui/UpdateDialog.tsx` | `src/ui/UpdateDialog.test.tsx`: banner oculto/visible, progreso, reinicio, estados del diálogo |

Además, `e2e/app.spec.ts` abre el diálogo desde **Help → Check for Updates…** y
comprueba que en un build sin empaquetar se informa correctamente.

Si cambias eventos de `electron-updater`, actualiza el tipo `UpdaterState` en
`electron/updater.ts`, `electron/preload.ts` y `src/types/electron.d.ts`, y
extiende los tests de las tres capas.

---

## 8. CI

`.github/workflows/ci.yml` ejecuta en cada push/PR dos jobs:

1. **build**: `npm ci` → `npm run typecheck` → `npm run test:unit` → `npm run build`.
2. **e2e**: `npm ci` → instala `xvfb` → `xvfb-run -a npm run test:e2e`.

El workflow de release (`.github/workflows/release.yml`) solo se dispara con
tags `v*`.

---

## 9. Checklist al añadir una feature

1. Lee `docs/ARCHITECTURE.md` y localiza el módulo correcto.
2. Implementa la lógica en un módulo puro siempre que sea posible.
3. Añade tests unitarios para esa lógica.
4. Si hay UI, añade un test de componente (mockeando store/bridge).
5. Si el flujo es crítico, añade o amplía un e2e.
6. Ejecuta `npm run typecheck && npm run test && npm run build`.
7. Actualiza la documentación y `TODO.md`.
8. Describe en el PR qué se probó y qué queda pendiente.

---

## 10. Recursos

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — módulos y flujos.
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — entorno, scripts y empaquetado.
- [TODO.md](TODO.md) — estado del roadmap y tareas de testing pendientes.
- [Vitest](https://vitest.dev/) · [Testing Library](https://testing-library.com/react) ·
  [Playwright Electron](https://playwright.dev/docs/api/class-electron)
