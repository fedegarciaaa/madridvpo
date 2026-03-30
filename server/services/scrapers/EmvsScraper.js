import BaseScraper from './BaseScraper.js';

// ──────────────────────────────────────────────────────────────────────────────
// EmvsScraper — EMVS Madrid (emvs.es)
//
// Tecnología: SharePoint 2019 + JavaScript → usamos Puppeteer
//
// EMVS es la Empresa Municipal de la Vivienda de Madrid.
// Es la fuente MÁS IMPORTANTE para sorteos y adjudicaciones VPO oficiales.
//
// Estrategia de monitoreo:
//   1. Cargar páginas clave con Puppeteer (SharePoint necesita JS)
//   2. Extraer todos los links relevantes de VPO
//   3. Visitar cada subpágina para obtener detalles completos
//   4. Deduplicar por URL individual
//
// Páginas monitorizadas:
//   - /Proyectos       → promociones activas
//   - /Vivienda        → programas de acceso a vivienda
//   - /Comunicacion    → noticias y sorteos
// ──────────────────────────────────────────────────────────────────────────────

const BASE_URL = 'https://www.emvs.es';

const PAGINAS = [
  { url: `${BASE_URL}/Proyectos`,    descripcion: 'Promociones EMVS' },
  { url: `${BASE_URL}/Vivienda`,     descripcion: 'Programas de vivienda' },
  { url: `${BASE_URL}/Comunicacion`, descripcion: 'Noticias y sorteos' },
];

// Palabras clave que indican contenido relevante VPO
const KEYWORDS_VPO = [
  'sorteo', 'vpo', 'vppl', 'vppb', 'vivienda protegida',
  'adjudicación', 'adjudicacion', 'convocatoria', 'precio tasado',
  'vivienda pública', 'vivienda publica', 'alquiler asequible'
];

// Máximo de subpáginas a visitar por página principal (evita timeouts con SharePoint)
const MAX_LINKS_POR_PAGINA = 12;

class EmvsScraper extends BaseScraper {
  constructor() {
    super('EmvsScraper');
  }

  async scrape() {
    this.logger('Iniciando monitoreo de EMVS...');

    const resultados    = [];
    const urlsVisitadas = new Set();

    // ── Paso 1: Procesar cada página principal ────────────────────────────
    for (const pagina of PAGINAS) {
      try {
        const links = await this._extraerLinks(pagina);
        for (const link of links) {
          if (!urlsVisitadas.has(link.url)) {
            urlsVisitadas.add(link.url);
            resultados.push(...link.datos);
          }
        }
        await this._delay(4000, 8000);
      } catch (e) {
        this.logger(`Error en página ${pagina.url}: ${e.message}`, 'warn');
      }
    }

    // Deduplicar por URL + nombre
    const deduplicados = resultados.filter((p, i, arr) =>
      arr.findIndex(x => x.fuente_scraping === p.fuente_scraping &&
                         x.nombre === p.nombre) === i
    );

    this.logger(`Monitoreo EMVS completado. ${deduplicados.length} elementos encontrados.`);
    return { promociones: deduplicados, error: null };
  }

  // ── Extraer todos los links relevantes de una página ──────────────────────
  async _extraerLinks(pagina) {
    this.logger(`  → ${pagina.descripcion}: ${pagina.url}`);

    const { $, ok, error } = await this.fetchWithPuppeteer(pagina.url, {
      timeout:        35000,
      reintentos:     1,    // Reducido: si SharePoint falla una vez, no reintentar
      blockResources: true  // Bloquear imágenes/fuentes para acelerar carga
    });

    if (!ok) {
      this.logger(`  ! Error: ${error}`, 'warn');
      return [];
    }

    const textoCompleto = $('body').text().toLowerCase();
    const esRelevante   = KEYWORDS_VPO.some(kw => textoCompleto.includes(kw));

    if (!esRelevante) {
      this.logger(`  → Sin contenido VPO relevante en ${pagina.url}`);
      return [];
    }

    // ── Extraer links individuales de proyectos/programas ─────────────────
    const linksRelevantes = new Map(); // url → texto del enlace

    const selectoresLinks = [
      'a[href*="/Proyectos/"]',
      'a[href*="/Vivienda/"]',
      'a[href*="sorteo"]',
      'a[href*="convocatoria"]',
      'a[href*="adjudicacion"]',
      'a[href*="vivienda"]',
      '.ms-rtestate-field a',
      '.ms-webpart-zone a',
      'article a',
    ];

    for (const sel of selectoresLinks) {
      $(sel).each((_, el) => {
        const $a       = $(el);
        const href     = $a.attr('href') || '';
        const txt      = $a.text().trim();
        if (!txt || txt.length < 4) return;

        const txtLower  = txt.toLowerCase();
        const hrefLower = href.toLowerCase();
        const esVPO = KEYWORDS_VPO.some(kw => txtLower.includes(kw)) ||
                      hrefLower.includes('vivienda') ||
                      hrefLower.includes('sorteo')   ||
                      hrefLower.includes('adjudic')  ||
                      hrefLower.includes('protegida');

        if (!esVPO) return;

        const url = href.startsWith('http') ? href :
                    (href.startsWith('/') ? `${BASE_URL}${href}` : null);
        if (!url || url === pagina.url) return;

        if (!linksRelevantes.has(url)) {
          linksRelevantes.set(url, txt);
        }
      });
    }

    this.logger(`  → ${linksRelevantes.size} links relevantes en ${pagina.descripcion}`);

    // Limitar a MAX_LINKS_POR_PAGINA para evitar timeouts con SharePoint
    if (linksRelevantes.size > MAX_LINKS_POR_PAGINA) {
      this.logger(`  → Limitando a ${MAX_LINKS_POR_PAGINA} links (había ${linksRelevantes.size})`, 'warn');
      const entradas = [...linksRelevantes.entries()].slice(0, MAX_LINKS_POR_PAGINA);
      linksRelevantes.clear();
      entradas.forEach(([k, v]) => linksRelevantes.set(k, v));
    }

    // ── Si no hay links individuales, crear entrada de la página completa ──
    if (!linksRelevantes.size) {
      const datos = [];
      const sorteoMatch = textoCompleto.match(/sorteo\s+de\s+(\d+)\s+viviendas?/gi);

      if (sorteoMatch) {
        this.logger(`  🎲 SORTEO detectado: ${sorteoMatch.join(', ')}`);
        datos.push(this.normalizarPromocion({
          nombre:            (sorteoMatch[0].charAt(0).toUpperCase() + sorteoMatch[0].slice(1)).slice(0, 299),
          tipo:              'VPO',
          zona:              'Madrid',
          estado:            'sorteo',
          web_oficial:       pagina.url,
          fuente_scraping:   pagina.url,
          descripcion_corta: `EMVS — ${pagina.descripcion}: ${sorteoMatch.join(', ')}`.slice(0, 499),
          metadatos: {
            promotora: 'EMVS Madrid',
            es_sorteo: true,
            texto_raw: sorteoMatch.join(', ')
          }
        }));
      }

      return [{ url: pagina.url, datos }];
    }

    // ── Visitar cada link para obtener detalles ────────────────────────────
    const resultado = [];
    for (const [url, txt] of linksRelevantes) {
      try {
        const datos = await this._scrapeSubpagina(url, txt, pagina);
        resultado.push({ url, datos });
        await this._delay(2000, 5000);
      } catch (e) {
        this.logger(`  ! Error en subpágina ${url}: ${e.message}`, 'warn');
        resultado.push({ url, datos: [this._crearEntradaLink(url, txt, pagina)] });
      }
    }

    return resultado;
  }

  // ── Scraping de una subpágina individual ──────────────────────────────────
  async _scrapeSubpagina(url, txtEnlace, pagina) {
    this.logger(`    → Subpágina: ${url}`);

    const { $, ok, error } = await this.fetchWithPuppeteer(url, {
      timeout:        25000,
      reintentos:     1,
      blockResources: true,
    });

    if (!ok) {
      this.logger(`    ! Error: ${error}`, 'warn');
      return [this._crearEntradaLink(url, txtEnlace, pagina)];
    }

    const textoCompleto = $('body').text();
    const nombre = (
      $('h1').first().text() ||
      $('h2').first().text() ||
      $('meta[property="og:title"]').attr('content') ||
      txtEnlace
    ).trim().slice(0, 299);

    if (!nombre) return [];

    const esVPO = KEYWORDS_VPO.some(kw =>
      (nombre + ' ' + textoCompleto.slice(0, 2000)).toLowerCase().includes(kw)
    );
    if (!esVPO) return [];

    const precioMatch = textoCompleto.match(/[Pp]recio[^:]*:\s*([\d\.]+)\s*€/);
    const dorms       = this.parseDormitorios(
      textoCompleto.match(/(\d[\d\s,y\-]*)\s*[Dd]ormitorio/)?.[0] || ''
    );
    const vivMatch    = textoCompleto.match(/(\d+)\s*viviendas?/i);
    const fechaMatch  = textoCompleto.match(/plazo[^.]*?(20[2-3]\d)|sorteo[^.]*?(20[2-3]\d)/i);
    const descripcion = (
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      $('p').first().text() || ''
    ).trim().slice(0, 499);

    return [this.normalizarPromocion({
      nombre,
      tipo:              this._detectarTipoVPO(nombre + ' ' + textoCompleto.slice(0, 1000)),
      zona:              this._detectarZona(nombre + ' ' + textoCompleto.slice(0, 1000)),
      precio_desde:      precioMatch ? this._parsePrecio(precioMatch[1]) : null,
      dormitorios_min:   dorms.min,
      dormitorios_max:   dorms.max,
      estado:            this._detectarEstado(nombre + ' ' + textoCompleto.slice(0, 1000)),
      descripcion_corta: descripcion,
      web_oficial:       url,
      fuente_scraping:   url,
      metadatos: {
        promotora:          'EMVS Madrid',
        pagina:             pagina.descripcion,
        num_viviendas:      vivMatch ? parseInt(vivMatch[1]) : null,
        es_sorteo:          /sorteo/i.test(nombre + textoCompleto.slice(0, 500)),
        fecha_convocatoria: fechaMatch ? (fechaMatch[1] || fechaMatch[2]) : null,
      }
    })];
  }

  // Crear entrada básica desde un link sin visitar
  _crearEntradaLink(url, txt, pagina) {
    return this.normalizarPromocion({
      nombre:            txt.slice(0, 299),
      tipo:              this._detectarTipoVPO(txt),
      zona:              this._detectarZona(txt),
      estado:            this._detectarEstado(txt),
      web_oficial:       url,
      fuente_scraping:   url,
      descripcion_corta: `EMVS — ${pagina.descripcion}: ${txt}`.slice(0, 499),
      metadatos: {
        promotora: 'EMVS Madrid',
        pagina:    pagina.descripcion,
        es_sorteo: txt.toLowerCase().includes('sorteo'),
      }
    });
  }

  _detectarTipoVPO(texto) {
    const t = texto.toUpperCase();
    if (t.includes('VPPL'))                                 return 'VPPL';
    if (t.includes('VPPB'))                                 return 'VPPB';
    if (t.includes('VPO'))                                  return 'VPO';
    if (t.includes('PROTEGIDA') || t.includes('ASEQUIBLE')) return 'VPO';
    return 'VPO'; // EMVS solo gestiona vivienda pública
  }

  _detectarZona(texto) {
    const zonas = [
      'Berrocales', 'Valdecarros', 'Ahijones', 'Cerros', 'Valdebebas',
      'Carabanchel', 'Latina', 'Villaverde', 'Vallecas', 'Hortaleza',
      'Fuencarral', 'Barajas', 'Vicálvaro', 'San Blas', 'Moratalaz',
      'Usera', 'Arganzuela', 'Retiro', 'Salamanca', 'Chamartín'
    ];
    for (const z of zonas) {
      if (texto.toLowerCase().includes(z.toLowerCase())) return z;
    }
    return 'Madrid';
  }

  _detectarEstado(texto) {
    const t = texto.toLowerCase();
    if (t.includes('sorteo'))          return 'sorteo';
    if (t.includes('adjudic'))         return 'adjudicada';
    if (t.includes('lista de espera')) return 'lista_espera';
    if (t.includes('entregad'))        return 'entregada';
    if (t.includes('construc'))        return 'en_construccion';
    return 'en_proyecto';
  }
}

export default new EmvsScraper();
