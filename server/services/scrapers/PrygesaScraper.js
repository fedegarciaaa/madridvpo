import BaseScraper from './BaseScraper.js';

// ──────────────────────────────────────────────────────────────────────────────
// PrygesaScraper — Prygesa (prygesa.es)
//
// Tecnología: WordPress + Bridge/Qode → fetch + Cheerio
// Promoción conocida: Los Ahijones Plaza (83 pisos VPPL, 2-3 dorm.)
//
// Estrategia:
//   1. Intentar scraping del listado /obra-nueva/
//   2. Para cada proyecto VPO encontrado, visitar su URL individual
//   3. Fallback garantizado: Los Ahijones Plaza (datos verificados)
// ──────────────────────────────────────────────────────────────────────────────

const BASE_URL     = 'https://www.prygesa.es';

// Listado filtrado directamente por Madrid — evita traer Valencia, Alicante, etc.
// Prygesa organiza su catálogo por provincia en la URL: /obra-nueva/[provincia]/[municipio]/[proyecto]
const LISTING_URL  = `${BASE_URL}/obra-nueva/madrid/`;

// URL específica de la promoción conocida
const URL_AHIJONES = `${BASE_URL}/obra-nueva/madrid/vicalvaro/los-ahijones`;

// Municipios de Madrid y limítrofes relevantes aceptados (para validación extra)
const MUNICIPIOS_MADRID = [
  'madrid', 'vicalvaro', 'vicálvaro', 'vallecas', 'parla', 'getafe', 'alcorcon',
  'leganes', 'mostoles', 'alcala', 'torrejon', 'pozuelo', 'las-rozas', 'cantizal',
  'villanueva', 'rivas', 'arganda', 'coslada', 'san-fernando', 'majadahonda',
  'boadilla', 'arroyomolinos', 'fuenlabrada', 'pinto', 'valdemoro', 'ciempozuelos',
];

class PrygesaScraper extends BaseScraper {
  constructor() {
    super('PrygesaScraper');
  }

  async scrape() {
    this.logger(`Iniciando scraping → ${LISTING_URL}`);

    const promociones = [];

    // ── Paso 1: Scraping del listado para encontrar proyectos ─────────────
    const linksProyectos = await this._extraerLinksListado();
    this.logger(`${linksProyectos.size} links de proyectos encontrados.`);

    // ── Paso 2: Visitar cada proyecto individual ──────────────────────────
    for (const url of linksProyectos) {
      try {
        const resultado = await this._scrapePagina(url);
        if (resultado) promociones.push(...resultado);
        await this._delay(3000, 7000);
      } catch (e) {
        this.logger(`Error en ${url}: ${e.message}`, 'warn');
      }
    }

    // Deduplicar por nombre
    const unicos = promociones.filter((p, i, arr) =>
      arr.findIndex(x => x.nombre === p.nombre) === i
    );

    // ── Paso 3: Completar con datos conocidos si no se encontraron ────────
    const resultado = this._completarConConocidas(unicos);

    this.logger(`${resultado.length} promociones encontradas.`);
    return { promociones: resultado, error: null };
  }

  // ── Extraer links de proyectos del listado ────────────────────────────────
  async _extraerLinksListado() {
    const links = new Set();

    // Cargar el listado de Madrid (ya filtrado por provincia en la URL)
    for (const url of [LISTING_URL, URL_AHIJONES]) {
      const { $, ok } = await this.fetchHtml(url, { reintentos: 2 });
      if (!ok) continue;

      // WordPress Bridge/Qode — selectores de proyectos
      const selectores = [
        '.qode-portfolio-item', '.portfolio-item',
        '.qode-post-content', '.post-item',
        'article', '.project'
      ];

      for (const sel of selectores) {
        if (!$(sel).length) continue;

        $(sel).each((_, el) => {
          const href = $(el).find('a').first().attr('href') || '';
          if (!href || href === '#') return;
          const pUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
          // Solo URLs de Prygesa en la Comunidad de Madrid
          if (pUrl.includes('prygesa.es') && pUrl !== LISTING_URL &&
              this._esMadrid(pUrl)) {
            links.add(pUrl);
          }
        });

        if (links.size) break;
      }

      // Fallback: cualquier enlace a /obra-nueva/madrid/[subpath]
      if (!links.size) {
        $('a[href*="/obra-nueva/madrid/"]').each((_, el) => {
          const href = $(el).attr('href') || '';
          const pUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
          if (pUrl !== LISTING_URL && pUrl.length > LISTING_URL.length) {
            links.add(pUrl);
          }
        });
      }

      if (links.size) break;
      await this._delay(2000, 4000);
    }

    // Siempre incluir la URL de Los Ahijones como fallback directo
    links.add(URL_AHIJONES);

    return links;
  }

  // ── Scraping de una página (listado o detalle) ────────────────────────────
  async _scrapePagina(url) {
    const { $, ok, error } = await this.fetchHtml(url, { reintentos: 3 });
    if (!ok) {
      this.logger(`Error: ${error}`, 'warn');
      return [];
    }

    const textoCompleto = $('body').text();
    const promociones   = [];

    // WordPress Bridge/Qode — selectores de proyectos
    const selectores = [
      '.qode-portfolio-item', '.portfolio-item',
      '.qode-post-content', '.post-item',
      'article', '.project'
    ];

    let encontrado = false;
    for (const sel of selectores) {
      if (!$(sel).length) continue;
      encontrado = true;

      $(sel).each((_, el) => {
        const $el    = $(el);
        const href   = $el.find('a').first().attr('href') || '';
        const nombre = $el.find('h2, h3, h4, .title').first().text().trim();
        if (!nombre) return;

        const texto     = $el.text();
        const tipo      = texto.match(/VPP[BL]|VPO|PROTEGIDA/i)?.[0] || 'VPPL';
        const dorms     = this.parseDormitorios(texto);
        const precio    = this._parsePrecio(texto.match(/[Dd]esde\s*([\d\.]+)\s*€/)?.[1]);
        const zona      = this._detectarZona(texto + ' ' + (href || ''));
        const imgSrc    = $el.find('img').first().attr('src') ||
                          $el.find('img').first().attr('data-src');
        const vivMatch  = texto.match(/(\d+)\s*viviendas?/i);
        const m2Match   = texto.match(/(\d{2,3})\s*m[²2]/i);
        const pUrl      = href.startsWith('http') ? href : (href ? `${BASE_URL}${href}` : url);

        promociones.push(this.normalizarPromocion({
          nombre,
          tipo,
          zona,
          precio_desde:      precio,
          m2_desde:          m2Match ? parseInt(m2Match[1]) : null,
          dormitorios_min:   dorms.min,
          dormitorios_max:   dorms.max,
          estado:            this._normalizarEstado(texto),
          imagen_principal:  imgSrc ? (imgSrc.startsWith('http') ? imgSrc : `${BASE_URL}${imgSrc}`) : null,
          web_oficial:       pUrl,
          fuente_scraping:   pUrl,
          metadatos: {
            promotora:     'Prygesa',
            num_viviendas: vivMatch ? parseInt(vivMatch[1]) : null,
          }
        }));
      });
      break;
    }

    // Fallback: si la página tiene datos de una promoción específica (página de detalle)
    if (!encontrado || !promociones.length) {
      const nombre = (
        $('h1').first().text() ||
        $('meta[property="og:title"]').attr('content') || ''
      ).trim();

      if (nombre && /ahijones|prygesa|VPPL|VPO|obra nueva/i.test(nombre + ' ' + textoCompleto)) {
        const precioMatch = textoCompleto.match(/[Dd]esde\s*([\d\.]+)\s*€/);
        const dorms       = this.parseDormitorios(
          textoCompleto.match(/(\d[\d\s,y\-]*)\s*[Dd]ormitorio/)?.[0] || ''
        );
        const vivMatch    = textoCompleto.match(/(\d+)\s*viviendas?/i);
        const m2Match     = textoCompleto.match(/(\d{2,3})\s*m[²2]/i);
        const imagen      = $('meta[property="og:image"]').attr('content') ||
                            $('img[src*="ahijones"], img[src*="prygesa"]').first().attr('src');

        promociones.push(this.normalizarPromocion({
          nombre: nombre || 'Los Ahijones Plaza (Prygesa)',
          tipo:   'VPPL',
          zona:   this._detectarZona(nombre + ' ' + textoCompleto),
          precio_desde:      precioMatch ? this._parsePrecio(precioMatch[1]) : null,
          m2_desde:          m2Match ? parseInt(m2Match[1]) : null,
          dormitorios_min:   dorms.min,
          dormitorios_max:   dorms.max,
          estado:            this._normalizarEstado(textoCompleto),
          imagen_principal:  imagen || null,
          web_oficial:       url,
          fuente_scraping:   url,
          descripcion_corta: ($('meta[name="description"]').attr('content') || '').slice(0, 499),
          metadatos: {
            promotora:     'Prygesa',
            num_viviendas: vivMatch ? parseInt(vivMatch[1]) : null,
          }
        }));
      }
    }

    return promociones;
  }

  // ── Completar con datos conocidos que no aparezcan ────────────────────────
  _completarConConocidas(scrapeadas) {
    const nombresEncontrados = new Set(
      scrapeadas.map(p => p.nombre?.toLowerCase().replace(/\s+/g, ' '))
    );
    const conocidas = this._datosConocidos().promociones;

    for (const c of conocidas) {
      const cNombre = c.nombre?.toLowerCase();
      if (!cNombre) continue;
      const yaEsta = [...nombresEncontrados].some(n =>
        n.includes('ahijones') && cNombre.includes('ahijones')
      );
      if (!yaEsta) scrapeadas.push(c);
    }

    return scrapeadas;
  }

  // ── Datos conocidos garantizados ──────────────────────────────────────────
  _datosConocidos() {
    return {
      promociones: [
        this.normalizarPromocion({
          nombre:            'Los Ahijones Plaza',
          tipo:              'VPPL',
          zona:              'Ahijones',
          dormitorios_min:   2,
          dormitorios_max:   3,
          estado:            'en_construccion',
          web_oficial:       URL_AHIJONES,
          fuente_scraping:   URL_AHIJONES,
          descripcion_corta: 'Promoción VPPL de Prygesa en Los Ahijones (Vicálvaro). 83 viviendas protegidas.',
          metadatos: {
            promotora:      'Prygesa',
            num_viviendas:  83,
            datos_manuales: true,
            nota:           'Datos verificados. Revisado 2025.'
          }
        }),
      ],
      error: null
    };
  }

  _detectarZona(texto) {
    const zonas = [
      'Ahijones', 'Valdecarros', 'Berrocales', 'Cerros', 'Vicálvaro', 'Vicalvaro',
      'Parla', 'Cantizal', 'Las Rozas', 'Vallecas', 'Madrid'
    ];
    for (const z of zonas) {
      if (texto.toLowerCase().includes(z.toLowerCase())) return z;
    }
    return '';
  }

  // Comprueba si una URL de Prygesa corresponde a la Comunidad de Madrid
  _esMadrid(url) {
    const urlLower = url.toLowerCase();
    // La URL de Prygesa para Madrid es /obra-nueva/madrid/...
    if (urlLower.includes('/obra-nueva/madrid/')) return true;
    // También aceptar si el texto del path contiene un municipio madrileño conocido
    return MUNICIPIOS_MADRID.some(m => urlLower.includes(m));
  }
}

export default new PrygesaScraper();
