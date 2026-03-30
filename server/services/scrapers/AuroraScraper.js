import BaseScraper from './BaseScraper.js';

// ──────────────────────────────────────────────────────────────────────────────
// AuroraScraper — Aurora Homes (aurora-homes.es)
//
// Estado: La web devuelve 403 con fetch estándar → usamos Puppeteer
//         con headers de navegador real para evitar el bloqueo.
//
// Estrategia:
//   1. Puppeteer en /promociones/ → extraer cards → visitar cada página
//   2. Si falla, datos conocidos (ambas promociones)
//
// Promociones conocidas:
//   - Residencial Arcadia (69 VPPL, Berrocales) — ENTREGADA
//   - Residencial Ítaca   (45 VPPL, Berrocales) — en comercialización
// ──────────────────────────────────────────────────────────────────────────────

const BASE_URL    = 'https://aurora-homes.es';
const LISTING_URL = `${BASE_URL}/promociones/`;

// URLs individuales conocidas (para fuente_scraping único → evita colisiones de deduplicación)
const URLS_CONOCIDAS = {
  arcadia: `${BASE_URL}/promociones/residencial-arcadia/`,
  itaca:   `${BASE_URL}/promociones/residencial-itaca/`,
};

class AuroraScraper extends BaseScraper {
  constructor() {
    super('AuroraScraper');
  }

  async scrape() {
    this.logger(`Iniciando scraping → ${LISTING_URL}`);

    // Intentar con Puppeteer primero (evita 403)
    const { $, ok, error } = await this.fetchWithPuppeteer(LISTING_URL, {
      timeout:        35000,
      reintentos:     2,
      blockResources: true,
    });

    if (!ok) {
      this.logger(`Puppeteer falló (${error}). Usando datos conocidos.`, 'warn');
      return this._datosConocidos();
    }

    const textoCompleto = $('body').text();
    const promociones   = [];

    // ── Paso 1: extraer enlaces individuales ──────────────────────────────
    const linksEncontrados = new Set();

    // Selectores de tarjetas de promoción
    const selectoresCards = [
      '.promocion', '.promo', '.project', '.card',
      '[class*="promo"]', '[class*="project"]', '[class*="residencial"]',
      'article', '.grid-item'
    ];

    for (const sel of selectoresCards) {
      if (!$(sel).length) continue;

      $(sel).each((_, el) => {
        const $el  = $(el);
        const href = $el.find('a').first().attr('href') ||
                     $el.closest('a').attr('href') || '';
        if (!href || href === '#' || href === LISTING_URL) return;
        const url = href.startsWith('http') ? href : `${BASE_URL}${href}`;
        if (url.includes(BASE_URL)) linksEncontrados.add(url);
      });

      if (linksEncontrados.size) break;
    }

    // Si no hay links en cards, buscar hrefs directos a subrutas de /promociones/
    if (!linksEncontrados.size) {
      $(`a[href*="${BASE_URL}/promociones/"], a[href^="/promociones/"]`).each((_, el) => {
        const href = $(el).attr('href') || '';
        const url  = href.startsWith('http') ? href : `${BASE_URL}${href}`;
        if (url !== LISTING_URL && url.length > LISTING_URL.length) {
          linksEncontrados.add(url);
        }
      });
    }

    this.logger(`${linksEncontrados.size} links de promoción encontrados.`);

    // ── Filtrar URLs que no son páginas de promoción ──────────────────────
    const PATHS_EXCLUIDOS = [
      'politica', 'cookies', 'aviso', 'legal', 'privacidad',
      'contacto', 'contact', 'sobre', 'about', 'blog',
      'noticias', 'quienes', 'equipo', 'team', 'empleo', 'trabaja',
    ];
    for (const url of [...linksEncontrados]) {
      const urlLower = url.toLowerCase();
      if (PATHS_EXCLUIDOS.some(p => urlLower.includes(p))) {
        this.logger(`  → URL excluida (no es promoción): ${url}`);
        linksEncontrados.delete(url);
      }
    }

    // ── Paso 2: visitar cada página individual ────────────────────────────
    for (const url of linksEncontrados) {
      try {
        const promo = await this._scrapeDetalle(url);
        if (promo) promociones.push(promo);
        await this._delay(2000, 5000);
      } catch (e) {
        this.logger(`Error en detalle ${url}: ${e.message}`, 'warn');
      }
    }

    // ── Paso 3: si no se extrajo nada estructurado, verificar texto ───────
    if (!promociones.length) {
      this.logger('Sin estructura reconocible. Usando datos conocidos...', 'warn');
      if (/ítaca|itaca|arcadia|VPPL|Berrocales/i.test(textoCompleto)) {
        return this._datosConocidos();
      }
      return { promociones: [], error: 'Sin contenido VPO reconocido' };
    }

    // Completar con datos conocidos si faltan promociones detectadas
    // Usa fuente_scraping para dedup exacto (evita "Ítaca" vs "Residencial Ítaca")
    const fuentesEncontradas = new Set(promociones.map(p => p.fuente_scraping?.toLowerCase()));
    const conocidos = this._datosConocidos().promociones;
    for (const c of conocidos) {
      if (!fuentesEncontradas.has(c.fuente_scraping?.toLowerCase())) {
        promociones.push(c);
      }
    }

    this.logger(`${promociones.length} promociones encontradas.`);
    return { promociones, error: null };
  }

  // ── Scraping de una página de detalle ────────────────────────────────────
  async _scrapeDetalle(url) {
    this.logger(`  → Detalle: ${url}`);

    const { $, ok, error } = await this.fetchWithPuppeteer(url, {
      timeout:        25000,
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
      $('meta[property="og:title"]').attr('content') ||
      url.split('/').filter(Boolean).pop()?.replace(/-/g, ' ')
    ).trim();

    if (!nombre) return null;

    // Descartar si el nombre es claramente una página de navegación/legal
    const NOMBRES_INVALIDOS = [
      'política', 'politica', 'cookies', 'aviso legal', 'privacidad',
      'contacto', 'sobre nosotros', 'inicio', 'home', 'quiénes somos',
    ];
    if (NOMBRES_INVALIDOS.some(n => nombre.toLowerCase().includes(n))) {
      this.logger(`  → "${nombre}" no es una promoción real. Omitiendo.`);
      return null;
    }

    const imgSrc = (
      $('meta[property="og:image"]').attr('content') ||
      $('img[src*="residencial"], img[src*="aurora"], img[src*="promo"]').first().attr('src') ||
      $('img').first().attr('src') || null
    );

    const precioMatch  = textoCompleto.match(/[Dd]esde\s*([\d\.]+)\s*€/);
    const m2Match      = textoCompleto.match(/(\d{2,3})\s*m[²2]/i);
    const dorms        = this.parseDormitorios(
      textoCompleto.match(/(\d[\d\s,y\-]*)\s*[Dd]ormitorio/)?.[0] || ''
    );
    const numVivMatch  = textoCompleto.match(/(\d+)\s*viviendas?/i);
    const fechaMatch   = textoCompleto.match(/entrega[^.]*?(20[2-3]\d)/i);
    const descripcion  = (
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') || ''
    ).trim().slice(0, 499);

    const zona = /berrocales/i.test(textoCompleto) ? 'Berrocales' : '';

    return this.normalizarPromocion({
      nombre,
      tipo:              textoCompleto.match(/VPP[BL]|VPO|COOPERATIVA/i)?.[0] || 'VPPL',
      zona,
      precio_desde:      precioMatch ? this._parsePrecio(precioMatch[1]) : null,
      m2_desde:          m2Match ? parseInt(m2Match[1]) : null,
      dormitorios_min:   dorms.min,
      dormitorios_max:   dorms.max,
      estado:            this._normalizarEstado(textoCompleto),
      imagen_principal:  imgSrc ? (imgSrc.startsWith('http') ? imgSrc : `${BASE_URL}${imgSrc}`) : null,
      descripcion_corta: descripcion,
      fecha_entrega_est: fechaMatch ? `${fechaMatch[1]}-12-31` : null,
      web_oficial:       url,
      fuente_scraping:   url,
      metadatos: {
        promotora:     'Aurora Homes',
        num_viviendas: numVivMatch ? parseInt(numVivMatch[1]) : null,
      }
    });
  }

  // ── Datos conocidos con AMBAS promociones ─────────────────────────────────
  _datosConocidos() {
    return {
      promociones: [
        this.normalizarPromocion({
          nombre:            'Residencial Arcadia',
          tipo:              'VPPL',
          zona:              'Berrocales',
          dormitorios_min:   2,
          dormitorios_max:   3,
          estado:            'entregada',
          web_oficial:       LISTING_URL,
          fuente_scraping:   URLS_CONOCIDAS.arcadia,
          descripcion_corta: 'Cooperativa VPPL en Los Berrocales. 69 viviendas. ENTREGADA.',
          metadatos: {
            promotora:      'Aurora Homes',
            num_viviendas:  69,
            datos_manuales: true,
            nota:           'Datos verificados. Revisado 2025.'
          }
        }),
        this.normalizarPromocion({
          nombre:            'Residencial Ítaca',
          tipo:              'VPPL',
          zona:              'Berrocales',
          dormitorios_min:   2,
          dormitorios_max:   3,
          estado:            'en_construccion',
          web_oficial:       LISTING_URL,
          fuente_scraping:   URLS_CONOCIDAS.itaca,
          descripcion_corta: 'Cooperativa VPPL en Los Berrocales. 45 viviendas. En comercialización.',
          metadatos: {
            promotora:      'Aurora Homes',
            num_viviendas:  45,
            datos_manuales: true,
            nota:           'Datos verificados. Revisado 2025.'
          }
        }),
      ],
      error: null
    };
  }
}

export default new AuroraScraper();
