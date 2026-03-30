import BaseScraper from './BaseScraper.js';

// ──────────────────────────────────────────────────────────────────────────────
// HercesaScraper — Hercesa (hercesa.com)
//
// Tecnología: WordPress custom → fetch + Cheerio
// URL base: https://hercesa.com
// Clase CSS clave: .b-publi-card (confirmada)
//
// Estrategia:
//   1. Cargar /obra-nueva/ con fetch estático
//   2. Extraer todas las tarjetas (.b-publi-card)
//   3. Visitar cada página individual para obtener precio, m², descripción
//   4. Filtrar solo promociones VPO/VPPL o en zonas VPO de Madrid
//
// NOTA: Hercesa tiene principalmente vivienda libre, pero monitoriza porque:
//       a) Tiene promociones en Los Berrocales (zona VPO)
//       b) Sus precios sirven como referencia de mercado
//       c) Puede incorporar VPO en el futuro
// ──────────────────────────────────────────────────────────────────────────────

const BASE_URL    = 'https://hercesa.com';
const LISTING_URL = `${BASE_URL}/obra-nueva/`;

// Zonas de Madrid con actividad VPO donde Hercesa opera
const ZONAS_VPO_MADRID = [
  'Berrocales', 'Valdecarros', 'Ahijones', 'Cerros', 'Valdebebas', 'Los Cerros'
];

class HercesaScraper extends BaseScraper {
  constructor() {
    super('HercesaScraper');
  }

  async scrape() {
    this.logger(`Iniciando scraping → ${LISTING_URL}`);

    const { $, ok, error } = await this.fetchHtml(LISTING_URL);
    if (!ok) {
      this.logger(`Error al cargar listado: ${error}`, 'error');
      return { promociones: [], error };
    }

    // ── Paso 1: Extraer tarjetas y sus URLs ───────────────────────────────
    const tarjetas = this._extraerTarjetas($);
    this.logger(`${tarjetas.length} tarjetas encontradas en listado.`);

    if (!tarjetas.length) {
      return { promociones: [], error: 'Sin tarjetas en listado (posible cambio estructural)' };
    }

    // ── Paso 2: Visitar cada página individual ────────────────────────────
    const promociones = [];
    for (const tarjeta of tarjetas) {
      try {
        const promo = await this._scrapeDetalle(tarjeta);
        if (promo) promociones.push(promo);
        await this._delay(2000, 5000);
      } catch (e) {
        this.logger(`Error en detalle "${tarjeta.nombre}": ${e.message}`, 'warn');
        // Guardar igual con datos parciales del listado
        if (tarjeta.nombre) {
          promociones.push(this._construirDesdeListado(tarjeta));
        }
      }
    }

    this.logger(`Scraping completado. ${promociones.length} promociones.`);
    return { promociones, error: null };
  }

  // ── Extraer tarjetas del listado ──────────────────────────────────────────
  _extraerTarjetas($) {
    const tarjetas = [];

    const selectores = ['.b-publi-card', '.publi-card', '.promo-card', '.promocion-card'];
    let selector = null;
    for (const s of selectores) {
      if ($(s).length) { selector = s; break; }
    }

    if (!selector) {
      // Fallback: enlaces a /promocion/[slug]/
      this.logger('Clase .b-publi-card no encontrada, usando fallback por enlaces.', 'warn');

      $('a[href*="/promocion/"]').each((_, el) => {
        const $el  = $(el);
        const href = $el.attr('href') || '';
        if (!href || href === '#') return;

        const url    = href.startsWith('http') ? href : `${BASE_URL}${href}`;
        const nombre = $el.text().trim() ||
                       url.split('/').filter(Boolean).pop()?.replace(/-/g, ' ');

        if (nombre && url !== BASE_URL + '/') {
          tarjetas.push({
            nombre,
            url,
            tipo_raw:     '',
            zona:         '',
            precio_desde: null,
            imagen:       null,
            dorms:        { min: null, max: null },
            texto:        $el.closest('div, article, li').text().trim(),
          });
        }
      });

      return tarjetas;
    }

    $(selector).each((_, el) => {
      const $card = $(el);
      const href  = $card.find('a').first().attr('href') ||
                    $card.closest('a').attr('href') || '';
      if (!href || href === BASE_URL + '/') return;

      const url    = href.startsWith('http') ? href : `${BASE_URL}${href}`;
      const texto  = $card.text();
      const nombre = (
        $card.find('h2, h3, .title, [class*="title"], [class*="name"]').first().text() ||
        url.split('/').filter(Boolean).pop()?.replace(/-/g, ' ')
      )?.trim();

      if (!nombre) return;

      const precioMatch = texto.match(/[Dd]esde\s*([\d\.]+)\s*€/);
      const imagen      = $card.find('img').first().attr('src') ||
                          $card.find('img').first().attr('data-src') || null;
      const dorms       = this.parseDormitorios(
        texto.match(/(\d[\d\s,y\-]*)\s*[Dd]ormitorio/)?.[0] || ''
      );
      const zona = this._detectarZona(texto + ' ' + url);

      tarjetas.push({
        nombre,
        url,
        tipo_raw:     texto.match(/VPP[BL]|VPO|LIBRE|PISO/i)?.[0] || '',
        zona,
        precio_desde: precioMatch ? this._parsePrecio(precioMatch[1]) : null,
        imagen:       imagen ? (imagen.startsWith('http') ? imagen : `${BASE_URL}${imagen}`) : null,
        dorms,
        texto,
      });
    });

    return tarjetas;
  }

  // ── Visitar página de detalle para enriquecer datos ───────────────────────
  async _scrapeDetalle(tarjeta) {
    if (!tarjeta.url || tarjeta.url === LISTING_URL) {
      return this._construirDesdeListado(tarjeta);
    }

    this.logger(`  → Detalle: ${tarjeta.nombre} (${tarjeta.url})`);

    const { $, ok, error } = await this.fetchHtml(tarjeta.url, { reintentos: 2 });
    if (!ok) {
      this.logger(`  ! Error: ${error}`, 'warn');
      return this._construirDesdeListado(tarjeta);
    }

    const textoCompleto = $('body').text();

    // Imagen principal
    const imagen = (
      $('meta[property="og:image"]').attr('content') ||
      tarjeta.imagen ||
      $('img[src*="promocion"], img[src*="residencial"]').first().attr('src') || null
    );

    // Precio
    const precioMatch  = textoCompleto.match(/[Dd]esde\s*([\d\.]+)\s*€/);
    const precioM2     = textoCompleto.match(/(\d{3,4})\s*€\s*\/\s*m[²2]/i);
    const precio_desde = precioMatch ? this._parsePrecio(precioMatch[1]) : tarjeta.precio_desde;

    // m²
    const m2Match  = textoCompleto.match(/(\d{2,3})\s*m[²2]/i);

    // Dormitorios
    const dormTexto = textoCompleto.match(/(\d[\d\s,y\-]*)\s*[Dd]ormitorio/)?.[0] || '';
    const dorms     = dormTexto ? this.parseDormitorios(dormTexto) : tarjeta.dorms;

    // Número de viviendas
    const vivMatch = textoCompleto.match(/(\d+)\s*viviendas?/i);

    // Fecha de entrega
    const fechaMatch = textoCompleto.match(/entrega[^.]*?(20[2-3]\d)/i);

    // Garaje / trastero
    const garaje   = /garaje incluido|con garaje/i.test(textoCompleto) ? true : null;
    const trastero = /trastero incluido|con trastero/i.test(textoCompleto) ? true : null;

    // Descripción corta
    const descripcion = (
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      $('p').first().text() || ''
    ).trim().slice(0, 499);

    // Tipo y zona
    const tipo = (textoCompleto + tarjeta.tipo_raw).match(/VPP[BL]|VPO|COOPERATIVA/i)?.[0] ||
                 tarjeta.tipo_raw || '';
    const zona = this._detectarZona(textoCompleto + ' ' + tarjeta.url) || tarjeta.zona;

    // FILTRO VPO: Hercesa tiene principalmente vivienda libre.
    // Solo incluir si tiene tipo VPO explícito O está en una zona VPO de Madrid.
    const enZonaVPO = ZONAS_VPO_MADRID.some(z => zona.toLowerCase().includes(z.toLowerCase()));
    const esTipoVPO = /VPP[BL]|VPO|COOPERATIVA/i.test(tipo);
    if (!esTipoVPO && !enZonaVPO) {
      this.logger(`  → "${tarjeta.nombre}" no es VPO ni está en zona VPO (zona="${zona}"). Omitiendo.`);
      return null;
    }

    return this.normalizarPromocion({
      nombre:            tarjeta.nombre,
      tipo,
      zona,
      precio_desde,
      precio_m2:         precioM2 ? this._parsePrecio(precioM2[1]) : null,
      m2_desde:          m2Match ? parseInt(m2Match[1]) : null,
      dormitorios_min:   dorms.min,
      dormitorios_max:   dorms.max,
      estado:            this._normalizarEstado(
        textoCompleto.match(/En comercialización|Novedad|Últimas viviendas|Obras iniciadas|Entregado/i)?.[0]
        || textoCompleto
      ),
      imagen_principal:  imagen ? (imagen.startsWith('http') ? imagen : `${BASE_URL}${imagen}`) : null,
      descripcion_corta: descripcion,
      fecha_entrega_est: fechaMatch ? `${fechaMatch[1]}-12-31` : null,
      garaje_incluido:   garaje,
      trastero_incluido: trastero,
      web_oficial:       tarjeta.url,
      fuente_scraping:   tarjeta.url,
      metadatos: {
        promotora:     'Hercesa',
        num_viviendas: vivMatch ? parseInt(vivMatch[1]) : null,
        url_listado:   LISTING_URL,
      }
    });
  }

  // Construir desde datos del listado cuando detalle falla
  _construirDesdeListado(tarjeta) {
    return this.normalizarPromocion({
      nombre:           tarjeta.nombre,
      tipo:             tarjeta.tipo_raw,
      zona:             tarjeta.zona,
      precio_desde:     tarjeta.precio_desde,
      dormitorios_min:  tarjeta.dorms.min,
      dormitorios_max:  tarjeta.dorms.max,
      estado:           this._normalizarEstado(tarjeta.texto),
      imagen_principal: tarjeta.imagen,
      web_oficial:      tarjeta.url,
      fuente_scraping:  tarjeta.url,
      metadatos: {
        promotora:   'Hercesa',
        url_listado: LISTING_URL,
      }
    });
  }

  _detectarZona(texto) {
    const t = texto.toLowerCase();
    for (const z of ZONAS_VPO_MADRID) {
      if (t.includes(z.toLowerCase())) return z;
    }
    const otras = ['Madrid', 'Guadalajara', 'Marchamalo', 'Paracuellos', 'Alcalá', 'Getafe'];
    for (const z of otras) {
      if (t.includes(z.toLowerCase())) return z;
    }
    return '';
  }
}

export default new HercesaScraper();
