import BaseScraper from './BaseScraper.js';

// ──────────────────────────────────────────────────────────────────────────────
// IbosaScraper — Grupo Ibosa (grupoibosa.com)
//
// Tecnología: Joomla CMS, renderizado server-side → fetch + Cheerio
// URL base: https://www.grupoibosa.com
//
// Estructura de URLs de Ibosa:
//   Listado en curso:    /nuestras-promociones/promociones-encurso.html
//   Página individual:   /nuestras-promociones/promociones-encurso/[zona]/[nombre].html
//                         ↑ 4 path segments (profundidad >= 3 bajo raíz)
//
// Estrategia:
//   1. Cargar la página de en-curso con fetch estático (Joomla es SSR)
//   2. Extraer TODOS los enlaces con ≥ 3 segmentos bajo /nuestras-promociones/
//      (esto excluye automáticamente los listados /nuestras-promociones/xxx.html)
//   3. Visitar cada página individual con fetch estático
//   4. Filtrar solo VPPL/VPPB/VPO — descartar vivienda libre
//   5. Extraer: nombre, tipo, zona, precio_desde, m2, dormitorios, estado
//   6. Bonus: extraer precios de planos si están en la sección de viviendas
// ──────────────────────────────────────────────────────────────────────────────

const BASE_URL    = 'https://www.grupoibosa.com';
const LISTING_URL = `${BASE_URL}/nuestras-promociones/promociones-encurso.html`;

// Páginas de listado a recorrer (en-curso es la principal, futuras como extra)
const LISTING_URLS = [
  `${BASE_URL}/nuestras-promociones/promociones-encurso.html`,
];

// Solo VPO/VPPL/VPPB — descartar vivienda libre
const RE_VPO = /VPPL|VPPB|VPO|VIVIENDA\s+PROTEGIDA|PRECIO\s+TASADO|COOPERATIVA/i;

// Zonas VPO donde Ibosa opera
const ZONAS_VPO = [
  'Berrocales', 'Valdecarros', 'Ahijones', 'Los Cerros', 'Cerros',
  'Valdebebas', 'Usera', 'Carabanchel', 'Latina', 'Tetuán',
  'Chamartín', 'Arturo Soria', 'Montecarmelo', 'Las Tablas', 'Vicálvaro',
];

class IbosaScraper extends BaseScraper {
  constructor() {
    super('IbosaScraper');
  }

  async scrape() {
    this.logger(`Iniciando scraping de Grupo Ibosa...`);

    const linksPromos = new Set();

    // ── Paso 1: Cargar cada página de listado ─────────────────────────────
    for (const listingUrl of LISTING_URLS) {
      this.logger(`  Cargando listado: ${listingUrl}`);

      // Primero con fetch estático (Joomla es SSR, más fiable y rápido)
      let $ = null;
      const r = await this.fetchHtml(listingUrl, { reintentos: 3, timeout: 25000 });
      if (r.ok) {
        $ = r.$;
      } else {
        // Fallback: Puppeteer
        this.logger(`  Fetch estático falló, probando Puppeteer...`, 'warn');
        const rp = await this.fetchWithPuppeteer(listingUrl, {
          timeout: 35000, reintentos: 2, blockResources: true
        });
        if (rp.ok) $ = rp.$;
      }

      if (!$) {
        this.logger(`  No se pudo cargar ${listingUrl}`, 'warn');
        continue;
      }

      // Extraer links individuales
      const encontrados = this._extraerLinksIndividuales($, listingUrl);
      encontrados.forEach(u => linksPromos.add(u));
      this.logger(`  ${encontrados.size} links individuales en ${listingUrl}`);
    }

    if (!linksPromos.size) {
      this.logger('Sin links de promociones individuales. Devolviendo vacío.', 'warn');
      return { promociones: [], error: 'No se encontraron links de promociones en Ibosa.' };
    }

    this.logger(`Total: ${linksPromos.size} páginas de promoción a visitar.`);

    // ── Paso 2: Visitar cada página individual ────────────────────────────
    const promociones = [];
    for (const url of linksPromos) {
      try {
        const promo = await this._scrapeDetalle(url);
        if (promo) promociones.push(promo);
        await this._delay(2000, 5000);
      } catch (e) {
        this.logger(`Error en "${url}": ${e.message}`, 'warn');
      }
    }

    this.logger(`Scraping completado. ${promociones.length} VPO extraídas.`);
    return { promociones, error: null };
  }

  // ── Extraer links de páginas de promoción individual ──────────────────────
  // Clave: una página individual tiene ≥ 3 segmentos bajo /nuestras-promociones/
  //   Listado:    /nuestras-promociones/promociones-encurso.html     → 2 segmentos
  //   Individual: /nuestras-promociones/promociones-encurso/valdecarros/residencial-nashira.html → 4 segmentos
  _extraerLinksIndividuales($, sourceUrl) {
    const links = new Set();

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (!href || !href.includes('/nuestras-promociones/') || !href.endsWith('.html')) return;

      // Construir URL completa
      const url = href.startsWith('http') ? href : `${BASE_URL}${href}`;

      // Contar segmentos de path para distinguir listados de páginas individuales
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      const segmentos = path.split('/').filter(Boolean);
      // Individual: ['nuestras-promociones', 'promociones-encurso', 'valdecarros', 'residencial-nashira.html'] → 4
      // Listado:    ['nuestras-promociones', 'promociones-encurso.html'] → 2
      if (segmentos.length < 3) return;

      // Excluir páginas de navegación genéricas
      const urlLower = url.toLowerCase();
      if (urlLower.includes('contacto') || urlLower.includes('aviso') ||
          urlLower.includes('privacidad') || urlLower.includes('cookies') ||
          urlLower.includes('blog') || urlLower.includes('quienes-somos')) return;

      if (url !== sourceUrl) links.add(url);
    });

    return links;
  }

  // ── Scraping de página de promoción individual ─────────────────────────────
  async _scrapeDetalle(url) {
    this.logger(`  → ${url}`);

    const { $, ok, error } = await this.fetchHtml(url, { reintentos: 2, timeout: 20000 });
    if (!ok) {
      this.logger(`  ! Error: ${error}`, 'warn');
      return null;
    }

    const textoCompleto = $('body').text();

    // ── Nombre ─────────────────────────────────────────────────────────────
    const nombre = (
      $('h1').first().text() ||
      $('meta[property="og:title"]').attr('content') ||
      $('h2').first().text() ||
      url.split('/').pop()?.replace('.html', '').replace(/-/g, ' ')
    ).trim();

    if (!nombre || nombre.length < 4) return null;

    // Descartar si es una página de sección/navegación
    if (/tour virtual|en curso|entregadas|futuras|contacto|aviso legal|política|inicio/i.test(nombre)) {
      this.logger(`  → "${nombre}" es sección de navegación. Omitiendo.`);
      return null;
    }

    // ── Filtro VPO: solo VPPL/VPPB/VPO, descartar vivienda libre ──────────
    const esVPO = RE_VPO.test(textoCompleto);
    if (!esVPO) {
      this.logger(`  → "${nombre}" no menciona VPO/VPPL/VPPB. Omitiendo.`);
      return null;
    }

    // ── Tipo de protección ─────────────────────────────────────────────────
    const tipo = textoCompleto.match(/VPPL|VPPB|VPO/i)?.[0]?.toUpperCase() || 'VPO';

    // ── Zona ───────────────────────────────────────────────────────────────
    // La URL ya codifica la zona: /promociones-encurso/[zona]/[nombre].html
    const urlParts = url.replace(BASE_URL, '').split('/').filter(Boolean);
    const zonaUrl  = urlParts.length >= 3 ? urlParts[urlParts.length - 2].replace(/-/g, ' ') : '';
    const zona = this._detectarZona(textoCompleto + ' ' + zonaUrl) || zonaUrl;

    // ── Precio ─────────────────────────────────────────────────────────────
    // Buscar "Desde X €" en la página (puede estar en planos o texto)
    let precio_desde = null;
    const precioPatterns = [
      /[Dd]esde\s*([\d\.]+)\s*€/,
      /[Pp]recio[^:]*:\s*([\d\.]+)\s*€/,
      /PVP[^:]*:\s*([\d\.]+)\s*€/,
    ];
    for (const pat of precioPatterns) {
      const m = textoCompleto.match(pat);
      if (m) {
        precio_desde = this._parsePrecio(m[1]);
        if (precio_desde > 50000) break; // Ignorar montos muy pequeños (probablemente m²)
      }
    }

    // ── Dormitorios ────────────────────────────────────────────────────────
    const dormTexto = textoCompleto.match(/(\d[\d\s,y\-]+)\s*[Dd]ormitorio/)?.[0] || '';
    const dorms     = this.parseDormitorios(dormTexto);

    // ── m² ─────────────────────────────────────────────────────────────────
    const m2Match = textoCompleto.match(/[Ss]uperficie[^0-9]*(\d{2,3})\s*m|(\d{2,3})\s*m[²2]\s+[Cc]onstrui/);
    const m2 = m2Match ? parseInt(m2Match[1] || m2Match[2]) : null;

    // ── Número de viviendas ────────────────────────────────────────────────
    const vivMatch = textoCompleto.match(/(\d+)\s*viviendas?/i);

    // ── Fecha de entrega ───────────────────────────────────────────────────
    const fechaMatch = textoCompleto.match(/[Ee]ntrega[^.]*?(20[2-3]\d)|[Pp]lazo[^.]*?(20[2-3]\d)/);

    // ── Estado ─────────────────────────────────────────────────────────────
    const estado = this._detectarEstado(textoCompleto);

    // ── Imagen ─────────────────────────────────────────────────────────────
    const imagen = (
      $('meta[property="og:image"]').attr('content') ||
      $('img[src*="promocion"], img[src*="residencial"], img[src*="nuestras"]').first().attr('src') ||
      $('article img').first().attr('src') || null
    );

    // ── Descripción ────────────────────────────────────────────────────────
    const descripcion = (
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      $('article p, .article-text p').first().text() || ''
    ).trim().slice(0, 499);

    this.logger(`  ✓ "${nombre}" — tipo=${tipo} zona=${zona} precio=${precio_desde ?? 'N/D'}`);

    return this.normalizarPromocion({
      nombre,
      tipo,
      zona,
      precio_desde,
      m2_desde:          m2,
      dormitorios_min:   dorms.min,
      dormitorios_max:   dorms.max,
      estado,
      descripcion_corta: descripcion,
      imagen_principal:  imagen ? (imagen.startsWith('http') ? imagen : `${BASE_URL}${imagen}`) : null,
      web_oficial:       url,
      fuente_scraping:   url,
      fecha_entrega_est: fechaMatch ? `${(fechaMatch[1] || fechaMatch[2])}-12-31` : null,
      metadatos: {
        promotora:     'Grupo Ibosa',
        num_viviendas: vivMatch ? parseInt(vivMatch[1]) : null,
        url_listado:   LISTING_URL,
        zona_url:      zonaUrl,
      }
    });
  }

  _detectarEstado(texto) {
    const t = texto.toLowerCase();
    if (t.includes('entregad') || t.includes('llaves'))               return 'entregada';
    if (t.includes('adjudicad') || t.includes('100% comercializ'))    return 'adjudicada';
    if (t.includes('sorteo'))                                          return 'sorteo';
    if (t.includes('lista de espera'))                                 return 'lista_espera';
    if (t.includes('en construcci') || t.includes('obra iniciada') ||
        t.includes('obras iniciadas'))                                  return 'en_construccion';
    return 'en_proyecto';
  }

  _detectarZona(texto) {
    const t = texto.toLowerCase();
    for (const z of ZONAS_VPO) {
      if (t.includes(z.toLowerCase())) return z;
    }
    return '';
  }
}

export default new IbosaScraper();
