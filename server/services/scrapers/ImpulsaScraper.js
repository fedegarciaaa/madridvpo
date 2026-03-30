import BaseScraper from './BaseScraper.js';

// ──────────────────────────────────────────────────────────────────────────────
// ImpulsaScraper — Grupo Impulsa (impulsaproyectos.com)
//
// Tecnología: WordPress + Elementor → usamos Puppeteer (JS rendering)
// Proyectos VPO conocidos:
//   - Cerasus – Ahijones     (64 VPPB, en construcción)
//   - Cooperativa Valdecarros (VPPL, en proyecto)
//   - Cooperativa Brunete     (cooperativa, en proyecto)
//
// NOTA: Elementor usa clases con IDs dinámicos (.e-loop-item-XXXX)
//       → no podemos usar selectores fijos, usamos estructura semántica
// ──────────────────────────────────────────────────────────────────────────────

const BASE_URL    = 'https://www.impulsaproyectos.com';
const LISTING_URL = `${BASE_URL}/proyectos/`;

// Proyectos conocidos con URLs individuales (para fuente_scraping único)
const PROYECTOS_VPO_CONOCIDOS = [
  {
    nombre:      'Cerasus – Ahijones',
    tipo:        'VPPB',
    zona:        'Ahijones',
    viviendas:   64,
    estado:      'en_construccion',
    url:         `${BASE_URL}/proyectos/cerasus/`,
    descripcion: '64 viviendas VPPB en Los Ahijones (Vicálvaro). Cooperativa gestionada por Grupo Impulsa.',
  },
  {
    nombre:      'Cooperativa Valdecarros',
    tipo:        'VPPL',
    zona:        'Valdecarros',
    viviendas:   null,
    estado:      'en_proyecto',
    url:         `${BASE_URL}/proyectos/valdecarros/`,
    descripcion: 'Cooperativa VPPL en Valdecarros. Próximamente. Gestionada por Grupo Impulsa.',
  },
  {
    nombre:      'Cooperativa Brunete',
    tipo:        'cooperativa',
    zona:        'Brunete',
    viviendas:   null,
    estado:      'en_proyecto',
    url:         `${BASE_URL}/proyectos/brunete/`,
    descripcion: 'Cooperativa de vivienda en Brunete. Gestionada por Grupo Impulsa.',
  },
];

// Keywords VPO para detectar proyectos en la página de Elementor
const RE_VPO = /VPO|VPPL|VPPB|COOPERATIVA|vivienda protegida|ahijones|valdecarros|cerasus|brunete/i;

class ImpulsaScraper extends BaseScraper {
  constructor() {
    super('ImpulsaScraper');
  }

  async scrape() {
    this.logger(`Iniciando scraping → ${LISTING_URL}`);

    // ── Paso 1: Listado con Puppeteer (Elementor necesita JS) ─────────────
    const { $, ok, error } = await this.fetchWithPuppeteer(LISTING_URL, {
      timeout:         45000,
      reintentos:      2,
      waitForSelector: '.elementor-widget-container',
    });

    if (!ok) {
      this.logger(`Puppeteer falló: ${error}. Usando datos conocidos.`, 'warn');
      return this._datosConocidos();
    }

    // ── Paso 2: Extraer links de proyectos individuales ───────────────────
    const linksProyectos = new Map(); // url → nombre

    // Buscar en headings del listado
    $('[class*="elementor-heading-title"], h2, h3, h4').each((_, el) => {
      const $el    = $(el);
      const nombre = $el.text().trim();
      if (!nombre || nombre.length < 4) return;

      const contexto = $el.closest('.elementor-section, .e-con, section, article').text();
      if (!RE_VPO.test(nombre + ' ' + contexto)) return;

      const href = $el.closest('a').attr('href') ||
                   $el.find('a').first().attr('href') ||
                   $el.parent().find('a').first().attr('href') || '';
      const url  = href.startsWith('http') ? href :
                   (href ? `${BASE_URL}${href}` : null);

      if (url && url !== LISTING_URL && url.startsWith(BASE_URL)) {
        linksProyectos.set(url, nombre);
      }
    });

    // Buscar también por enlaces directos a /proyectos/[slug]/
    $(`a[href*="${BASE_URL}/proyectos/"], a[href^="/proyectos/"]`).each((_, el) => {
      const href = $(el).attr('href') || '';
      const url  = href.startsWith('http') ? href : `${BASE_URL}${href}`;
      if (url !== LISTING_URL && url.startsWith(BASE_URL) && !linksProyectos.has(url)) {
        const nombre = $(el).text().trim() || '';
        linksProyectos.set(url, nombre);
      }
    });

    this.logger(`${linksProyectos.size} proyectos encontrados en listado.`);

    if (!linksProyectos.size) {
      this.logger('No se encontraron links de proyectos. Usando datos conocidos.', 'warn');
      return this._datosConocidos();
    }

    // ── Paso 3: Visitar cada página individual ────────────────────────────
    const promociones = [];
    for (const [url, nombreListado] of linksProyectos) {
      try {
        const promo = await this._scrapeDetalle(url, nombreListado);
        if (promo) promociones.push(promo);
        await this._delay(3000, 7000);
      } catch (e) {
        this.logger(`Error en detalle ${url}: ${e.message}`, 'warn');
      }
    }

    // ── Paso 4: Completar con proyectos conocidos que no aparecieron ──────
    const nombresEncontrados = new Set(
      promociones.map(p => p.nombre?.toLowerCase().replace(/\s+/g, ' '))
    );
    const conocidos = this._datosConocidos().promociones;
    for (const c of conocidos) {
      const cNombre = c.nombre?.toLowerCase().replace(/\s+/g, ' ');
      const yaEsta  = [...nombresEncontrados].some(n =>
        n.includes(cNombre) || cNombre.includes(n.split(' ')[0])
      );
      if (!yaEsta) {
        promociones.push(c);
      }
    }

    if (!promociones.length) return this._datosConocidos();

    this.logger(`${promociones.length} proyectos VPO encontrados.`);
    return { promociones, error: null };
  }

  // ── Scraping de página individual de proyecto ─────────────────────────────
  async _scrapeDetalle(url, nombreListado = '') {
    this.logger(`  → Detalle: ${url}`);

    const { $, ok, error } = await this.fetchWithPuppeteer(url, {
      timeout:        30000,
      reintentos:     1,
      blockResources: true,
    });

    if (!ok) {
      this.logger(`  ! Error: ${error}`, 'warn');
      return null;
    }

    const textoCompleto = $('body').text();
    const nombre = (
      $('h1').first().text() ||
      $('[class*="elementor-heading-title"]').first().text() ||
      $('meta[property="og:title"]').attr('content') ||
      nombreListado
    ).trim();

    if (!nombre) return null;

    // Verificar que es un proyecto VPO o cooperativa
    if (!RE_VPO.test(nombre + ' ' + textoCompleto.slice(0, 2000))) return null;

    const imgSrc  = $('meta[property="og:image"]').attr('content') ||
                    $('img[src*="cerasus"], img[src*="valdecarros"], img[src*="brunete"], img[src*="impulsa"]').first().attr('src') ||
                    $('[class*="elementor-widget-image"] img').first().attr('src') || null;

    const precioMatch  = textoCompleto.match(/[Dd]esde\s*([\d\.]+)\s*€/);
    const m2Match      = textoCompleto.match(/(\d{2,3})\s*m[²2]/i);
    const vivMatch     = textoCompleto.match(/(\d+)\s*viviendas?/i);
    const fechaMatch   = textoCompleto.match(/entrega[^.]*?(20[2-3]\d)/i);
    const dorms        = this.parseDormitorios(
      textoCompleto.match(/(\d[\d\s,y\-]*)\s*[Dd]ormitorio/)?.[0] || textoCompleto.slice(0, 500)
    );
    const descripcion  = (
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      $('[class*="elementor-text-editor"] p').first().text() || ''
    ).trim().slice(0, 499);

    return this.normalizarPromocion({
      nombre,
      tipo:              (nombre + textoCompleto).match(/VPP[BL]|VPO|COOPERATIVA/i)?.[0] || 'VPPL',
      zona:              this._detectarZona(nombre + ' ' + textoCompleto),
      precio_desde:      precioMatch ? this._parsePrecio(precioMatch[1]) : null,
      m2_desde:          m2Match ? parseInt(m2Match[1]) : null,
      dormitorios_min:   dorms.min,
      dormitorios_max:   dorms.max,
      estado:            /próximo|próximamente/i.test(textoCompleto) ? 'en_proyecto'
                         : this._normalizarEstado(textoCompleto),
      imagen_principal:  imgSrc ? (imgSrc.startsWith('http') ? imgSrc : `${BASE_URL}${imgSrc}`) : null,
      descripcion_corta: descripcion,
      fecha_entrega_est: fechaMatch ? `${fechaMatch[1]}-12-31` : null,
      web_oficial:       url,
      fuente_scraping:   url,
      metadatos: {
        promotora:     'Grupo Impulsa',
        num_viviendas: vivMatch ? parseInt(vivMatch[1]) : null,
      }
    });
  }

  // ── Datos conocidos (los 3 proyectos confirmados) ─────────────────────────
  _datosConocidos() {
    const promociones = PROYECTOS_VPO_CONOCIDOS.map(p =>
      this.normalizarPromocion({
        nombre:            p.nombre,
        tipo:              p.tipo,
        zona:              p.zona,
        estado:            p.estado,
        web_oficial:       p.url,
        fuente_scraping:   p.url,
        descripcion_corta: p.descripcion,
        metadatos: {
          promotora:      'Grupo Impulsa',
          num_viviendas:  p.viviendas,
          datos_manuales: true,
          nota:           'Datos verificados. Revisado 2025.'
        }
      })
    );
    return { promociones, error: null };
  }

  _detectarZona(texto) {
    const zonas = [
      'Ahijones', 'Valdecarros', 'Brunete', 'Berrocales',
      'Rivas', 'Getafe', 'Cerros', 'Vicálvaro', 'Vicalvaro'
    ];
    for (const z of zonas) {
      if (texto.toLowerCase().includes(z.toLowerCase())) return z;
    }
    return '';
  }
}

export default new ImpulsaScraper();
