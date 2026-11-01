import type { SiteContent } from './types';
import { links } from './links';

export const es: SiteContent = {
  lang: 'es',
  locale: 'es_ES',
  meta: {
    home: {
      title: 'OpenBurn — Software libre de corte y grabado láser',
      description:
        'Software libre de corte y grabado láser para GRBL. Diseña, previsualiza y controla tu máquina, con soporte .lbrn/.lbrn2 de LightBurn.',
    },
    features: {
      title: 'Funciones — OpenBurn',
      description:
        'Diseño vectorial, capas de corte estilo LightBurn, previsualización animada, control GRBL, tests de material y kerf, vectorización de imágenes y compatibilidad .lbrn/.lbrn2.',
    },
    download: {
      title: 'Descargar OpenBurn para Windows, macOS y Linux',
      description:
        'Descarga la última versión de OpenBurn. Software libre de corte y grabado láser para Windows, macOS y Linux. Sin cuenta ni clave de licencia.',
    },
    alternative: {
      title: 'Alternativa libre a LightBurn — OpenBurn',
      description:
        'Una alternativa gratuita y de código abierto a LightBurn. Abre y exporta proyectos .lbrn/.lbrn2, controla máquinas GRBL y conserva tu flujo de trabajo sin pagar licencia.',
    },
    privacy: {
      title: 'Privacidad — OpenBurn',
      description:
        'Cómo trata OpenBurn la privacidad: sin cuenta, sin telemetría en la app, sin cookies y analítica agregada sin cookies en esta web.',
    },
    support: {
      title: 'Apoyar OpenBurn — código abierto, sin anuncios',
      description:
        'Patrocina OpenBurn y mantén el proyecto libre, independiente y sin anuncios. La financiación cubre firma de código, hardware de pruebas, hosting y documentación.',
    },
    notFound: {
      title: 'Página no encontrada — OpenBurn',
      description: 'La página que buscas no existe.',
    },
  },
  nav: {
    features: 'Funciones',
    download: 'Descargar',
    docs: 'Documentación',
    github: 'GitHub',
    openMenu: 'Abrir menú',
    closeMenu: 'Cerrar menú',
    switchTo: 'English',
  },
  footer: {
    tagline:
      'Software libre de corte y grabado láser. Diseña, previsualiza y controla tu máquina sin licencias.',
    product: {
      title: 'Producto',
      links: [
        { label: 'Funciones', href: '/es/funciones/' },
        { label: 'Descargar', href: '/es/descargas/' },
        { label: 'Novedades', href: links.changelog },
        { label: 'Roadmap', href: links.roadmap },
      ],
    },
    resources: {
      title: 'Recursos',
      links: [
        { label: 'Documentación', href: links.docs },
        { label: 'Formatos de archivo', href: links.fileFormats },
        { label: 'Arquitectura', href: links.architecture },
        { label: 'Versiones', href: links.releases },
      ],
    },
    community: {
      title: 'Comunidad',
      links: [
        { label: 'GitHub', href: links.github },
        { label: 'Incidencias', href: links.issues },
        { label: 'Contribuir', href: links.contributing },
        { label: 'Apoyar', href: '/es/apoyar/' },
        { label: 'Licencia', href: links.license },
      ],
    },
    license: 'Licencia MIT · © 2026 Santiago Leal (SJLS27)',
    disclaimer:
      'OpenBurn no está afiliado a LightBurn Software Inc. LightBurn es una marca de su respectivo propietario.',
    madeWith: 'Hecho con café y demasiadas pasadas de láser.',
  },
  ui: {
    skipToContent: 'Saltar al contenido',
    recommended: 'Recomendado para tu sistema',
    copy: 'Copiar',
    copied: 'Copiado',
    version: 'Versión',
    license: 'Licencia MIT',
    docs: 'Documentación',
    changelog: 'Novedades',
    roadmap: 'Roadmap',
    contributing: 'Contribuir',
    issues: 'Incidencias',
    releases: 'Versiones',
    source: 'Código fuente',
    privacy: 'Privacidad',
    features: 'Funciones',
    download: 'Descargar',
    home: 'Inicio',
    notAffiliated:
      'OpenBurn es un proyecto independiente de código abierto, no afiliado a LightBurn Software Inc.',
    allReleases: 'Todas las versiones',
    readGuide: 'Leer la guía',
    openExternal: 'Se abre en una pestaña nueva',
  },
  home: {
    hero: {
      eyebrow: 'Código abierto · MIT · Windows, macOS y Linux',
      title: 'Tu láser. Tu software.',
      accent: 'Sin licencias.',
      lead:
        'OpenBurn es un estudio libre y gratuito para corte y grabado láser. Diseña, ajusta las capas, previsualiza cada trayectoria y controla tu máquina GRBL, con compatibilidad total con .lbrn y .lbrn2.',
      primary: 'Descargar gratis',
      secondary: 'Ver en GitHub',
      note: 'Sin cuenta · Sin telemetría · Funciona sin conexión',
      imageAlt:
        'Editor de OpenBurn con figuras vectoriales, el panel Cuts / Layers y el panel de conexión del láser',
    },
    trust: [
      'Licencia MIT',
      'Windows · macOS · Linux',
      'GRBL y Web Serial',
      'Abre y escribe .lbrn/.lbrn2',
      'Funciona sin conexión',
    ],
    features: {
      eyebrow: 'Todo el flujo de trabajo',
      title: 'Un estudio completo, no una demo',
      lead:
        'Diseña, ajusta los cortes, previsualiza y envía a la máquina. Sin suscripciones, sin funciones bloqueadas y sin cuenta.',
      items: [
        {
          icon: 'vector',
          title: 'Diseño vectorial a la altura',
          body:
            'Líneas, figuras, texto, booleanos, offset, edición de nodos y agrupación, con snapping, guías y entrada numérica precisa.',
        },
        {
          icon: 'layers',
          title: 'Capas de corte como las conoces',
          body:
            'Tabla Cuts / Layers con modos Line, Fill, Offset Fill e Image, velocidad y potencia, pasadas, intervalo y kerf por capa.',
        },
        {
          icon: 'preview',
          title: 'Previsualización animada',
          body:
            'Recorre el trabajo, observa la cabeza láser y consulta el tiempo estimado y las estadísticas por capa antes de grabar nada.',
        },
        {
          icon: 'machine',
          title: 'Control GRBL integrado',
          body:
            'Conecta por Web Serial o usa el simulador. Frame, Start, Pause/Resume, Stop, jog, homing y fijar origen.',
        },
        {
          icon: 'test',
          title: 'Tests de material, intervalo, foco y kerf',
          body:
            'Genera matrices de calibración reales con una capa por celda y guarda los resultados en una biblioteca de materiales reutilizable.',
        },
        {
          icon: 'image',
          title: 'Imágenes ajustadas y vectorizadas',
          body:
            'Brillo, contraste, gamma, niveles y curvas; diez modos de tramado; vectorización en un clic con previsualización en vivo.',
        },
      ],
    },
    showcase: {
      eyebrow: 'Míralo en acción',
      title: 'Cada corte, previsualizado antes de ocurrir',
      lead:
        'Capturas reales de la aplicación, no maquetas. Recorre el flujo desde el diseño hasta la máquina.',
      tabs: [
        {
          id: 'preview',
          label: 'Preview',
          title: 'Ve el trabajo antes de empezar',
          body:
            'Cada trayectoria, cada movimiento en vacío y la cabeza láser animada. Consulta el tiempo estimado y las estadísticas por capa y empieza con confianza.',
          image: 'preview',
          alt: 'Previsualización animada de trayectorias con la cabeza láser, la línea de tiempo y estadísticas por capa',
        },
        {
          id: 'layers',
          label: 'Cuts / Layers',
          title: 'Capas que se traducen en cortes reales',
          body:
            'Una tabla estilo LightBurn con modo, velocidad, potencia, pasadas, intervalo y salida, además del editor completo de ajustes de corte.',
          image: 'overview',
          alt: 'Editor de OpenBurn con la tabla Cuts / Layers, la paleta de colores y el panel del láser',
        },
        {
          id: 'material',
          label: 'Test de material',
          title: 'Ajusta cualquier material',
          body:
            'Genera una matriz potencia × velocidad con subcapas reales, ejecuta el trabajo y guarda los ajustes ganadores en tu biblioteca.',
          image: 'material-test',
          alt: 'Matriz de test de material con etiquetas de potencia y velocidad grabadas en una plancha',
        },
        {
          id: 'lightburn',
          label: 'Archivos LightBurn',
          title: 'Tus archivos .lbrn2 son bienvenidos',
          body:
            'Abre y exporta proyectos de LightBurn con capas, grupos, ajustes de corte, contornos de texto y mapas de bits. Migra sin perder tu biblioteca.',
          image: 'lightburn',
          alt: 'Importación y exportación de proyectos LightBurn .lbrn y .lbrn2',
        },
        {
          id: 'image',
          label: 'Herramientas de imagen',
          title: 'De la foto al grabado',
          body:
            'Ajusta niveles y curvas, elige un modo de tramado y vectoriza la imagen en trazos editables con previsualización antes de aplicar.',
          image: 'image-tools',
          alt: 'Diálogo Adjust Image con brillo, contraste, gamma y previsualización en escala de grises',
        },
        {
          id: 'focus',
          label: 'Test de foco',
          title: 'Encuentra el foco perfecto',
          body:
            'Ejecuta una rampa en Z con pasos etiquetados y aplica el offset medido por objeto. Los tests de kerf e intervalo completan la calibración.',
          image: 'focus-test',
          alt: 'Test de foco con rampa del eje Z y pasos etiquetados',
        },
      ],
    },
    comparison: {
      eyebrow: 'Comparación honesta',
      title: 'Cómo se compara con LightBurn',
      lead:
        'LightBurn es un producto maduro y excelente. OpenBurn es una alternativa libre y gratuita que ya cubre el flujo principal, y decimos con claridad qué falta todavía.',
      headers: { openburn: 'OpenBurn', lightburn: 'LightBurn' },
      rows: [
        {
          label: 'Precio',
          openburn: { text: 'Gratis, para siempre', state: 'yes' },
          lightburn: { text: 'Licencia de pago', state: 'text' },
        },
        {
          label: 'Código fuente',
          openburn: { text: 'Abierto (MIT)', state: 'yes' },
          lightburn: { text: 'Cerrado', state: 'no' },
        },
        {
          label: 'Plataformas',
          openburn: { text: 'Windows, macOS y Linux', state: 'yes' },
          lightburn: { text: 'Windows y macOS (Linux beta)', state: 'partial' },
        },
        {
          label: 'Archivos .lbrn / .lbrn2',
          openburn: { text: 'Lectura y escritura', state: 'yes' },
          lightburn: { text: 'Formato nativo', state: 'yes' },
        },
        {
          label: 'Control GRBL',
          openburn: { text: 'Sí, con simulador', state: 'yes' },
          lightburn: { text: 'Sí', state: 'yes' },
        },
        {
          label: 'Previsualización animada',
          openburn: { text: 'Sí', state: 'yes' },
          lightburn: { text: 'Sí', state: 'yes' },
        },
        {
          label: 'Tests de material, intervalo y kerf',
          openburn: { text: 'Sí', state: 'yes' },
          lightburn: { text: 'Sí', state: 'yes' },
        },
        {
          label: 'Vectorización de imágenes',
          openburn: { text: 'Sí', state: 'yes' },
          lightburn: { text: 'Sí', state: 'yes' },
        },
        {
          label: 'Controladoras Ruida / DSP',
          openburn: { text: 'En el roadmap', state: 'partial' },
          lightburn: { text: 'Sí', state: 'yes' },
        },
        {
          label: 'Cámaras y Print & Cut',
          openburn: { text: 'En el roadmap', state: 'partial' },
          lightburn: { text: 'Sí', state: 'yes' },
        },
        {
          label: 'Instaladores firmados',
          openburn: { text: 'Todavía no', state: 'no' },
          lightburn: { text: 'Sí', state: 'yes' },
        },
      ],
      note:
        'Basado en funciones documentadas públicamente a fecha de 2026. LightBurn es una marca de LightBurn Software Inc. OpenBurn no está afiliado, respaldado ni patrocinado por LightBurn.',
    },
    downloads: {
      eyebrow: 'Descargar',
      title: 'Elige tu plataforma',
      lead:
        'Descarga la última versión desde GitHub Releases. Cada versión se compila con CI en Windows, macOS y Linux.',
      allReleases: 'Todas las versiones, checksums y código fuente en GitHub',
      recommended: 'Recomendado para tu sistema',
      cards: [
        {
          os: 'windows',
          icon: 'windows',
          title: 'Windows',
          file: 'Instalador · .exe',
          meta: 'Windows 10 y 11 · x64',
          note: 'Build sin firmar: SmartScreen puede pedirte confirmación.',
          href: links.latest,
          cta: 'Descargar para Windows',
        },
        {
          os: 'macos',
          icon: 'apple',
          title: 'macOS',
          file: 'Imagen de disco · .dmg',
          meta: 'Apple Silicon e Intel · macOS 11+',
          note: 'Build sin firmar: clic derecho → Abrir la primera vez.',
          href: links.latest,
          cta: 'Descargar para macOS',
        },
        {
          os: 'linux',
          icon: 'linux',
          title: 'Linux',
          file: 'AppImage · .AppImage',
          meta: 'x64 · la mayoría de distribuciones',
          note: 'Manifiesto Flatpak disponible; revisión de Flathub pendiente.',
          href: links.latest,
          cta: 'Descargar para Linux',
        },
      ],
    },
    steps: {
      eyebrow: 'En marcha',
      title: 'Tres pasos hasta tu primer corte',
      lead: 'Sin clave de instalación, sin cuenta y sin límite de prueba. Descarga y dibuja.',
      items: [
        {
          title: 'Descarga y abre',
          body: 'Elige el build para tu sistema operativo y ejecútalo. Eso es toda la instalación.',
        },
        {
          title: 'Dibuja o importa',
          body:
            'Empieza desde cero o trae SVG, DXF, imágenes y proyectos de LightBurn directamente a la mesa.',
        },
        {
          title: 'Conecta o simula',
          body:
            'Conecta una controladora GRBL por USB o explora todo el flujo con el simulador integrado.',
        },
      ],
      dev: {
        title: '¿Prefieres el código?',
        body: 'Solo necesitas Node.js 22.22+ y npm 10+ para ejecutar la app de escritorio en desarrollo.',
        code: 'git clone https://github.com/SJLS27/openburn.git\ncd openburn\nnpm install\nnpm run dev:electron',
      },
    },
    faq: {
      eyebrow: 'Preguntas frecuentes',
      title: 'Dudas resueltas',
      lead: 'Lo que todo el mundo pregunta antes de probar OpenBurn.',
      items: [
        {
          q: '¿OpenBurn es realmente gratis?',
          a:
            'Sí. Toda la aplicación tiene licencia MIT: sin planes de pago, sin funciones bloqueadas y sin cuenta. Puedes usarla comercialmente, modificarla y redistribuirla.',
        },
        {
          q: '¿Puedo abrir mis proyectos de LightBurn?',
          a:
            'OpenBurn lee .lbrn y .lbrn2 y escribe ambos formatos. Se admiten capas, grupos, ajustes de corte, contornos de texto y mapas de bits. Algunas funciones avanzadas aún faltan y las notas de compatibilidad de la documentación detallan los límites exactos.',
        },
        {
          q: '¿Funciona con controladoras Ruida o DSP?',
          a:
            'Todavía no. OpenBurn se centra en máquinas basadas en GRBL. Ruida/DSP y los equipos galvo están en el roadmap.',
        },
        {
          q: '¿Necesito conexión a internet?',
          a:
            'No. La aplicación funciona completamente sin conexión y no envía telemetría. La comprobación de actualizaciones es la única petición de red opcional.',
        },
        {
          q: '¿Por qué Windows o macOS avisan al descargar?',
          a:
            'Los builds aún no están firmados. En Windows elige Más información → Ejecutar de todas formas. En macOS haz clic derecho sobre la app y elige Abrir. Los instaladores firmados están previstos.',
        },
        {
          q: '¿Puedo usarlo comercialmente?',
          a:
            'Sí. La licencia MIT permite usar OpenBurn para cualquier fin, incluido trabajo remunerado. Se agradece la atribución, pero no es obligatoria.',
        },
      ],
    },
    support: {
      title: 'Código abierto, sin anuncios ni telemetría',
      body: 'Si OpenBurn te ahorra tiempo, puedes ayudar a financiar la próxima versión.',
      paypal: 'Apoyar con PayPal',
      more: '¿Por qué apoyar?',
    },
    cta: {
      title: '¿Listo para crear algo?',
      lead: 'Descarga OpenBurn, abre un proyecto y previsualiza tu primer corte en minutos.',
      primary: 'Descargar OpenBurn',
      secondary: 'Dar una estrella en GitHub',
    },
  },
  featuresPage: {
    hero: {
      eyebrow: 'Funciones',
      title: 'Hecho para trabajo láser real',
      lead:
        'Todo, desde el primer vector hasta la última pasada: diseño, ajustes de corte, previsualización, calibración y control de la máquina en una sola app de escritorio.',
    },
    grid: {
      eyebrow: 'Qué incluye',
      title: 'Todas las funciones, en la versión gratuita',
      lead: 'Sin complementos, sin módulos de pago y sin funciones bloqueadas.',
      items: [
        {
          icon: 'vector',
          title: 'Diseño vectorial',
          body:
            'Herramientas de línea, rectángulo, rectángulo redondeado, elipse, polígono, texto y medida. Selección múltiple, mover, escalar, rotar, voltear, alinear, distribuir, agrupar, ordenar y editar nodos.',
        },
        {
          icon: 'layers',
          title: 'Cuts / Layers',
          body:
            'Tabla de capas estilo LightBurn con modos Line, Fill, Offset Fill e Image, velocidad, potencia, pasadas, intervalo, salida y aire. Ajustes avanzados como overcut, lead-in/out, offset Z y kerf.',
        },
        {
          icon: 'preview',
          title: 'Previsualización animada',
          body:
            'Recorre la línea de tiempo, observa la cabeza en los movimientos en vacío y consulta el tiempo estimado y las estadísticas de cada capa antes de enviar el trabajo.',
        },
        {
          icon: 'machine',
          title: 'Control GRBL',
          body:
            'Web Serial o simulador integrado, streaming con control de flujo, Frame, Start, Pause/Resume, Stop, jog, homing, unlock y fijar origen. Posición, feed y progreso en vivo.',
        },
        {
          icon: 'test',
          title: 'Tests de calibración',
          body:
            'Test de material (potencia × velocidad), de intervalo, de foco con rampa Z y de kerf. Los resultados se guardan en una biblioteca de materiales reutilizable.',
        },
        {
          icon: 'image',
          title: 'Herramientas de imagen',
          body:
            'Importa PNG, JPG, GIF, BMP y WebP. Ajusta brillo, contraste, gamma, niveles y curvas; elige entre diez modos de tramado y vectoriza con previsualización en vivo.',
        },
        {
          icon: 'text',
          title: 'Texto a contornos',
          body:
            'Convierte texto en contornos con opentype.js y la fuente Inter incluida, para que los archivos se corten igual en cualquier máquina sin depender de fuentes instaladas.',
        },
        {
          icon: 'route',
          title: 'Planificador de corte',
          body:
            'Orden interior primero, clasificación por dirección, reducción de viajes, mejor punto de inicio, esquinas preferidas y eliminación de solapamientos. Ajustes de optimización estilo LightBurn.',
        },
        {
          icon: 'file',
          title: 'Compatibilidad con LightBurn',
          body:
            'Abre y exporta .lbrn y .lbrn2 con geometría, grupos, ajustes de corte, contornos de texto y mapas de bits. Exporta GCode .nc cuando lo necesites.',
        },
        {
          icon: 'update',
          title: 'Actualizaciones automáticas',
          body:
            'Comprueba al arrancar, descarga en segundo plano y ofrece Reiniciar e instalar. Comprobación manual desde Help → Check for Updates.',
        },
        {
          icon: 'shield',
          title: 'Sin conexión y privado',
          body:
            'Sin cuenta, sin telemetría y sin dependencia de la nube. Tus proyectos y ajustes de máquina se quedan en tu ordenador.',
        },
        {
          icon: 'spark',
          title: 'Tabs, offsets y arrays',
          body:
            'Añade puentes para que las piezas no se suelten, offsets de contorno para el kerf y repite el diseño en cuadrícula o en círculo.',
        },
      ],
    },
    cta: {
      title: 'Pruébalo en tu propia máquina',
      lead: 'Descarga la última versión y pruébala con el simulador integrado, sin necesidad de láser.',
      primary: 'Descargar OpenBurn',
      secondary: 'Leer la documentación',
    },
  },
  downloadPage: {
    hero: {
      eyebrow: 'Descargar',
      title: 'Consigue OpenBurn',
      lead:
        'Gratis para Windows, macOS y Linux. Elige el build para tu equipo o compílalo tú mismo desde el código fuente.',
    },
    requirements: {
      title: 'Requisitos del sistema',
      items: [
        'Windows 10 u 11 (x64)',
        'macOS 11 Big Sur o superior (Apple Silicon e Intel)',
        'Linux x64 con soporte AppImage o Flatpak',
        'Opcional: un láser basado en GRBL conectado por USB',
        'Sin cuenta, sin clave de licencia y sin telemetría',
      ],
    },
    install: {
      title: 'Notas de instalación',
      lead: 'Los builds aún no están firmados, así que el sistema operativo puede pedirte confirmación.',
      items: [
        {
          title: 'Windows SmartScreen',
          body:
            'Si aparece SmartScreen, elige Más información → Ejecutar de todas formas. El instalador lo publica nuestro CI en GitHub Releases.',
        },
        {
          title: 'macOS Gatekeeper',
          body:
            'Haz clic derecho sobre OpenBurn.app y elige Abrir la primera vez. Si macOS lo sigue bloqueando, elimina el atributo de cuarentena:',
          code: 'xattr -dr com.apple.quarantine /Applications/OpenBurn.app',
        },
        {
          title: 'Linux AppImage',
          body: 'Haz ejecutable el archivo y lánzalo:',
          code: 'chmod +x OpenBurn-*.AppImage\n./OpenBurn-*.AppImage',
        },
        {
          title: 'Linux Flatpak',
          body:
            'El manifiesto y las fuentes offline están en el repositorio. La publicación en Flathub está pendiente de revisión, así que por ahora la opción es compilarlo en local.',
        },
      ],
    },
    dev: {
      title: 'Compilar desde el código',
      body: 'Necesitas Node.js 22.22+ y npm 10+.',
      code: 'git clone https://github.com/SJLS27/openburn.git\ncd openburn\nnpm install\nnpm run dev:electron\nnpm run build:app',
      note: 'El último comando genera un AppImage, un instalador NSIS o un DMG con electron-builder.',
    },
    cta: {
      title: '¿Necesitas ayuda?',
      lead: 'La documentación cubre el editor, los ajustes de corte, GRBL y los formatos de archivo. Si algo falla, abre una incidencia.',
      primary: 'Leer la documentación',
      secondary: 'Abrir una incidencia',
    },
  },
  alternativePage: {
    hero: {
      eyebrow: 'Alternativa de código abierto',
      title: 'Una alternativa gratuita a LightBurn',
      lead:
        'OpenBurn cubre el flujo diario —diseño vectorial, capas de corte, previsualización animada y control GRBL— sin pagar licencia. Lee y escribe .lbrn/.lbrn2, así que puedes probarlo con tus proyectos actuales y migrar poco a poco.',
    },
    cards: [
      {
        icon: 'file',
        title: 'Los mismos archivos, en ambos sentidos',
        body:
          'Abre proyectos .lbrn y .lbrn2 y expórtalos de vuelta. Tu biblioteca actual no queda atrapada.',
      },
      {
        icon: 'layers',
        title: 'El flujo que ya conoces',
        body:
          'Cuts / Layers, Line, Fill, Offset Fill, Image, pasadas, kerf y ajustes de optimización, en lugares familiares.',
      },
      {
        icon: 'code',
        title: 'Código abierto, sin dependencia',
        body:
          'Licencia MIT, auditable y gratis para siempre. Haz un fork, amplíalo o compílalo tú mismo.',
      },
    ],
    comparison: {
      eyebrow: 'Lado a lado',
      title: 'Cómo se comparan',
      lead: 'Una mirada honesta, no una tabla de marketing.',
      headers: { openburn: 'OpenBurn', lightburn: 'LightBurn' },
      rows: [
        {
          label: 'Precio',
          openburn: { text: 'Gratis, para siempre', state: 'yes' },
          lightburn: { text: 'Licencia de pago', state: 'text' },
        },
        {
          label: 'Código fuente',
          openburn: { text: 'Abierto (MIT)', state: 'yes' },
          lightburn: { text: 'Cerrado', state: 'no' },
        },
        {
          label: 'Plataformas',
          openburn: { text: 'Windows, macOS y Linux', state: 'yes' },
          lightburn: { text: 'Windows y macOS (Linux beta)', state: 'partial' },
        },
        {
          label: 'Archivos .lbrn / .lbrn2',
          openburn: { text: 'Lectura y escritura', state: 'yes' },
          lightburn: { text: 'Formato nativo', state: 'yes' },
        },
        {
          label: 'Control GRBL',
          openburn: { text: 'Sí, con simulador', state: 'yes' },
          lightburn: { text: 'Sí', state: 'yes' },
        },
        {
          label: 'Tests de material, intervalo y kerf',
          openburn: { text: 'Sí', state: 'yes' },
          lightburn: { text: 'Sí', state: 'yes' },
        },
        {
          label: 'Controladoras Ruida / DSP',
          openburn: { text: 'En el roadmap', state: 'partial' },
          lightburn: { text: 'Sí', state: 'yes' },
        },
        {
          label: 'Cámaras y Print & Cut',
          openburn: { text: 'En el roadmap', state: 'partial' },
          lightburn: { text: 'Sí', state: 'yes' },
        },
        {
          label: 'Instaladores firmados',
          openburn: { text: 'Todavía no', state: 'no' },
          lightburn: { text: 'Sí', state: 'yes' },
        },
      ],
      note:
        'Basado en funciones documentadas públicamente a fecha de 2026. LightBurn es una marca de LightBurn Software Inc. OpenBurn no está afiliado, respaldado ni patrocinado por LightBurn.',
    },
    migration: {
      title: 'Migrar en cinco minutos',
      lead:
        'Nada se convierte de forma irreversible: puedes abrir tus archivos, probar el flujo y volver a exportar.',
      items: [
        {
          title: 'Abre tu proyecto',
          body: 'Usa File → Open y elige un archivo .lbrn o .lbrn2 de tu biblioteca actual.',
        },
        {
          title: 'Revisa las capas',
          body:
            'Comprueba modos, velocidad, potencia y pasadas en Cuts / Layers y ajusta lo que haga falta.',
        },
        {
          title: 'Previsualiza el trabajo',
          body: 'Pulsa Alt+P para inspeccionar cada trayectoria, los movimientos en vacío y el tiempo estimado.',
        },
        {
          title: 'Conecta tu láser',
          body:
            'Usa Web Serial con una máquina GRBL real o el simulador para explorar sin hardware.',
        },
        {
          title: 'Exporta si lo necesitas',
          body: 'Escribe .lbrn o .lbrn2 de vuelta en cualquier momento y sigue trabajando en cualquiera de las dos herramientas.',
        },
      ],
    },
    limits: {
      title: 'Dónde LightBurn sigue ganando',
      lead: 'Preferimos ser honestos: estas son las carencias en las que seguimos trabajando.',
      items: [
        'Las controladoras Ruida / DSP aún no son compatibles.',
        'Las cámaras y Print & Cut están en el roadmap.',
        'Los instaladores aún no están firmados.',
        'Una década de casos límite y un ecosistema mucho más grande.',
      ],
    },
    faq: {
      title: 'Preguntas antes de cambiar',
      items: [
        {
          q: '¿Se conservan mis ajustes de corte al abrir y exportar?',
          a:
            'Las capas y los ajustes de corte se mapean en ambos sentidos. Los overrides por objeto se exportan como ajustes de capa, los grupos se aplanan y el texto se exporta como contornos. Consulta las notas de formato para el mapeo exacto.',
        },
        {
          q: '¿Hay un plan de pago o un límite de prueba?',
          a:
            'No. OpenBurn tiene licencia MIT y es totalmente funcional. No hay cuenta, ni suscripción, ni temporizador.',
        },
        {
          q: '¿Puedo seguir usando LightBurn también?',
          a:
            'Sí. Ambas herramientas leen y escriben archivos compatibles, y OpenBurn también exporta GCode. Usa la que mejor encaje en cada trabajo.',
        },
      ],
    },
    cta: {
      title: 'Pruébalo con un proyecto real',
      lead: 'Abre uno de tus archivos de LightBurn y comprueba hasta dónde llega. No cuesta nada.',
      primary: 'Descargar OpenBurn',
      secondary: 'Leer la documentación',
    },
  },
  privacyPage: {
    hero: {
      eyebrow: 'Privacidad',
      title: 'Privacidad, en lenguaje claro',
      lead: 'OpenBurn es una herramienta de escritorio, no un negocio de datos.',
    },
    updated: 'Última actualización: 1 de noviembre de 2026',
    sections: [
      {
        title: 'La aplicación de escritorio',
        paragraphs: [
          'OpenBurn no requiere cuenta y no incluye telemetría, analítica ni publicidad. Tus proyectos se quedan en tu ordenador.',
          'La única petición de red opcional es la comprobación de actualizaciones, que contacta con GitHub Releases para buscar una versión más reciente. Puedes lanzarla manualmente o ignorarla por completo.',
        ],
      },
      {
        title: 'Esta web',
        paragraphs: [
          'El sitio es una compilación estática alojada en Cloudflare Pages. No instala cookies ni utiliza rastreadores publicitarios.',
          'Usamos GoatCounter, una herramienta de analítica sin cookies, para contar visitas de forma agregada. No crea perfiles, no almacena direcciones IP y respeta Do Not Track.',
        ],
      },
      {
        title: 'Alojamiento',
        paragraphs: [
          'Cloudflare procesa datos estándar de las peticiones (como la dirección IP y el user agent) para servir el sitio y protegerlo frente a abusos, conforme a su propia política de privacidad.',
        ],
      },
      {
        title: 'Contacto',
        paragraphs: [
          '¿Dudas o solicitudes? Abre una incidencia en github.com/SJLS27/openburn/issues.',
        ],
      },
    ],
  },
  supportPage: {
    hero: {
      eyebrow: 'Apoya el proyecto',
      title: 'Mantén OpenBurn libre e independiente',
      lead:
        'OpenBurn no tiene anuncios, ni telemetría, ni plan de pago. El patrocinio lo mantiene así y financia el trabajo que un proyecto libre normalmente no puede permitirse.',
    },
    reasonsTitle: 'Por qué importa',
    paypalCta: 'Apoyar con PayPal',
    reasons: [
      {
        icon: 'heart',
        title: 'Sin anuncios. Sin telemetría.',
        body:
          'La app y esta web se quedan limpias: sin rastreadores, sin banners de cookies y sin funciones patrocinadas.',
      },
      {
        icon: 'code',
        title: 'Builds firmados e infraestructura',
        body:
          'Los certificados de firma, los minutos de CI, el hosting y el dominio cuestan dinero cada año.',
      },
      {
        icon: 'test',
        title: 'Hardware y materiales',
        body:
          'Probar en máquinas y materiales reales es lo que hace fiables los tests de calibración, kerf y foco.',
      },
    ],
    ways: {
      title: 'Formas de apoyar',
      lead: 'Recurrente, puntual o completamente gratis: todas las opciones ayudan.',
      items: [
        {
          icon: 'heart',
          title: 'PayPal',
          body: 'Apoyo puntual con tu cuenta de PayPal. PayPal puede aplicar sus comisiones habituales.',
          cta: 'Apoyar con PayPal',
          href: links.paypal,
        },
        {
          icon: 'github',
          title: 'GitHub Sponsors',
          body: 'Apoyo recurrente gestionado por GitHub. Cancela cuando quieras.',
          cta: 'Patrocinar en GitHub',
          href: links.githubSponsors,
        },
        {
          icon: 'file',
          title: 'Patrocinio puntual',
          body:
            'Empresas y particulares pueden financiar una parte concreta: la firma, una función o la documentación.',
          cta: 'Iniciar un patrocinio',
          href: links.sponsorshipIssue,
        },
        {
          icon: 'spark',
          title: 'Estrella y difusión',
          body:
            'Una estrella en GitHub o un mensaje en tu comunidad láser ayudan más de lo que parece.',
          cta: 'Dar una estrella',
          href: links.github,
        },
        {
          icon: 'code',
          title: 'Contribuir',
          body:
            'Código, documentación, reportes y archivos .lbrn2 reales son siempre bienvenidos.',
          cta: 'Guía de contribución',
          href: links.contributing,
        },
      ],
    },
    transparency: {
      title: 'Transparencia',
      paragraphs: [
        'OpenBurn tiene licencia MIT y seguirá teniéndola. El patrocinio nunca desbloquea funciones, cambia la licencia ni compra influencia sobre el roadmap.',
        'No hay anuncios, ni analítica con cookies, ni contenido patrocinado. La única petición de red opcional de la app es la comprobación de actualizaciones.',
        'En qué se gasta: certificados de firma, CI y hosting, materiales y hardware de prueba, y tiempo de mantenimiento y documentación.',
        'Los patrocinadores aparecen aquí y en el repositorio cuando lo autorizan.',
      ],
      note: 'Sin anuncios. Sin telemetría. MIT para siempre.',
    },
    cta: {
      title: 'Apoya OpenBurn',
      lead: 'Mantén el proyecto independiente y las herramientas gratis para todos.',
      primary: 'Apoyar con PayPal',
      secondary: 'Dar una estrella',
    },
  },
  notFound: {
    title: 'Esta trayectoria se salió de la mesa.',
    lead: 'La página que buscas no existe, o el corte se optimizó demasiado.',
    home: 'Volver al inicio',
    download: 'Descargar OpenBurn',
  },
};
