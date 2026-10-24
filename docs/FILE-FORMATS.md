# Formatos de archivo

OpenBurn usa un formato nativo **`.obrn`** (JSON) y es compatible con los proyectos de LightBurn **`.lbrn`** y **`.lbrn2`** (XML).

---

## 1. `.obrn` — proyecto nativo

> El formato anterior `.ovbrn` se sigue leyendo (solo lectura) para no romper proyectos antiguos. Al guardar se usa siempre `.obrn`.

Es un JSON versionado que envuelve la escena de Fabric.js y los metadatos de capas/corte.

```jsonc
{
  "format": "openburn",
  "version": 1,
  "units": "mm",
  "bed": { "width": 400, "height": 400, "showOutline": true },
  "layers": [
    {
      "id": "layer-000000",
      "name": "C00",
      "color": "#000000",
      "settings": {
        "mode": "line",            // line | fill | offsetFill | image
        "speed": 20,               // mm/s
        "power": 50,               // 0..100 %
        "passes": 1,
        "interval": 0.1,           // mm (fill / image)
        "offsetDistance": 0.2,     // mm (offset fill)
        "overscan": 2.5,           // mm
        "dither": "none",          // none | jarvis | atkinson | stucki | ordered
        "output": true,
        "visible": true,
        "airAssist": false
      }
    }
  ],
  "canvas": { /* escena de Fabric.js */ },
  "meta": {
    "name": "Untitled",
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  }
}
```

Propiedades personalizadas guardadas en cada objeto de `canvas`:

| Propiedad | Tipo | Uso |
| --- | --- | --- |
| `layerId` | string | Capa a la que pertenece la forma |
| `cutOverride` | object | Override de corte por objeto (Material Test) |
| `imageAdjust` | object | Brillo/contraste/gamma/umbral/invertir para imágenes |

El formato es estable y se migra por `version`.

---

## 2. LightBurn `.lbrn` / `.lbrn2`

Los proyectos de LightBurn son **XML plano** (no ZIP). `.lbrn` es la variante legada, más legible; `.lbrn2` usa listas compactas de vértices para ocupar menos.

### 2.1 Estructura general

```xml
<?xml version="1.0" encoding="UTF-8"?>
<LightBurnProject AppVersion="1.7.08" FormatVersion="1" MaterialHeight="0" MirrorX="False" MirrorY="False">
  <CutSetting type="Cut">
    <index Value="0"/>
    <name Value="C00"/>
    <speed Value="20"/>
    <maxPower Value="50"/>
    <minPower Value="50"/>
    <numPasses Value="1"/>
    <interval Value="0.1"/>
  </CutSetting>

  <Shape Type="Path" CutIndex="0">
    <XForm>1 0 0 1 55 55</XForm>
    <VertList>V-10 -10V10 -10V10 10V-10 10</VertList>
    <PrimList>L0 1L1 2L2 3L3 0</PrimList>
  </Shape>
</LightBurnProject>
```

- `CutIndex` enlaza la forma con el `<CutSetting>` de ese índice.
- Las coordenadas están en **mm** y el workspace de LightBurn es **Y hacia arriba** (origen abajo-izquierda).
- `XForm` es una matriz `[a b c d e f]` que transforma las coordenadas locales.

### 2.2 Tipos de forma

| Tipo | Atributos / contenido |
| --- | --- |
| `Rect` | `W`, `H`, `Cr` (radio de esquina); centrado en el `XForm` |
| `Ellipse` | `Rx`, `Ry`; centrada en el `XForm` |
| `Polygon` | `Rx`, `Ry`, `N`; centrado |
| `Path` | `VertList` + `PrimList` (o `<V>`/`<P>` en `.lbrn`) |
| `Group` | `<Children>` con más `Shape`; el `XForm` se compone |
| `Text` | `Str`/`Text`, `Font`, `H`, `HasBackupPath`; `<BackupPath>` contiene los contornos |
| `Bitmap` | `W`, `H`, `Data` (PNG en base64), ajustes de imagen |
| `Notes` | Texto informativo (se ignora al importar) |

### 2.3 Vértices y primitivas

**Formato legado (`.lbrn`)**

```xml
<Shape Type="Path" CutIndex="0">
  <XForm>1 0 0 1 5 5</XForm>
  <V vx="0" vy="0"/>
  <V vx="50" vy="0" c1x="40" c1y="10"/>
  <V vx="50" vy="30"/>
  <P T="L" p0="0" p1="1"/>
  <P T="B" p0="1" p1="2"/>
</Shape>
```

- `V`: `vx`/`vy` son la posición; `c0x/c0y` el handle saliente y `c1x/c1y` el entrante.
- `P`: `T="L"` línea, `T="B"` Bézier; `p0`/`p1` conectan índices de vértices.

**Formato compacto (`.lbrn2`)**

```xml
<VertList>V49 48c0x1c1x49c1y48V62 63c0x62c0y63c1x1</VertList>
<PrimList>L0 1</PrimList>
```

- Cada vértice empieza por `V x y`.
- Los handles se codifican como `c0x…c0y…` y `c1x…c1y…`; el marcador `c0x1`/`c1x1` (sin su `y`) significa “sin handle”.
- `PrimList` usa `L`/`B` con índices `from to`, por ejemplo `L0 1L1 2L2 0`.
- `LineClosed` / `LineOpen` indican polilíneas sin curvas.

> OpenBurn implementa ambos formatos, incluidas las **plantillas** `VertID`/`PrimID` que reutilizan la geometría de una forma anterior (habitual en `.lbrn2`).

### 2.4 Mapeo a OpenBurn

| LightBurn | OpenBurn |
| --- | --- |
| `CutSetting.index` | Capa `lb-<index>` |
| Color de capa | `PALETTE_COLORS[index]` (el color en LightBurn se deriva del índice) |
| `type="Cut"` / `type="Scan"` | `line` / `fill` |
| `speed`, `maxPower`, `numPasses`, `interval` | Ajustes de la capa |
| `kerf`, `angle`, `crossHatch`, `scanOffset` | Kerf, ángulo de scan, cross-hatch y scan offset |
| `Shape Rect/Ellipse/Polygon` | `Fabric.Path` (geometría transformada) |
| `Shape Path` + `VertList` | `Fabric.Path` (líneas y Bézier) |
| `Shape Group` | hijos aplanados con transformación compuesta |
| `Shape Text` | `BackupPath` como trazado; si no existe, `Textbox` aproximado |
| `Shape Bitmap` | `FabricImage` con el PNG embebido |

Al importar:

1. Se aplica la matriz `XForm`.
2. Se invierte Y (`y' = -y`) para pasar al lienzo Y-abajo.
3. Se normaliza el conjunto al cuadrante positivo con 10 mm de margen.
4. La cama se ajusta al contenido si excede 400 × 400 mm.

### 2.5 Exportación

OpenBurn exporta:

- Una `<CutSetting>` por capa (índices contiguos 0..N-1).
- Una `<Shape Type="Path">` por contorno, con coordenadas absolutas en mm y `XForm` identidad.
- Texto → contornos (no depende de fuentes en LightBurn).
- Imágenes → `<Shape Type="Bitmap">` con PNG base64.
- Y invertida de vuelta con `y_lb = bed.height - y_scene`.

Formatos:

- `.lbrn` → `<V>`/`<P>` legado, legible.
- `.lbrn2` → `<VertList>`/`<PrimList>` compacto.

### 2.6 Limitaciones conocidas

- Los **colores personalizados** de OpenBurn no se escriben en el XML; LightBurn usa el color de la paleta según el índice.
- Los **grupos se aplanan** al exportar.
- Los **overrides por objeto** se exportan como ajustes de capa (aviso en la barra de estado).
- Las **imágenes rotadas** se exportan sin rotación (aviso).
- El **texto sin `BackupPath`** al importar se aproxima con un `Textbox` (tamaño/fuente pueden variar).
- Formas desconocidas se omiten con un aviso.
- La compatibilidad se validó con ejemplos reales y round-trip; **no se probó abriendo un `.lbrn2` exportado en LightBurn 2.x** dentro de este entorno.

---

## 3. Tabla rápida de formatos

| Extensión | Lectura | Escritura | Uso |
| --- | --- | --- | --- |
| `.obrn` | ✅ | ✅ | Proyecto nativo |
| `.ovbrn` | ✅ | — | Proyecto nativo legado (solo lectura) |
| `.lbrn` | ✅ | ✅ | Intercambio LightBurn (legado) |
| `.lbrn2` | ✅ | ✅ | Intercambio LightBurn (actual) |
| `.svg` | ✅ | ✅ | Vectorial |
| `.dxf` | ✅ (LINE/LWPOLYLINE/POLYLINE/CIRCLE/ARC/TEXT) | — | CAD |
| `.png/.jpg/.gif/.bmp/.webp` | ✅ | — | Raster (imagen) |
| `.nc/.gcode` | — | ✅ | GCode GRBL |
