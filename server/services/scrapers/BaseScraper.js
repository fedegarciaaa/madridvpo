import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import crypto from 'crypto';
import config from '../../config/config.js';

// ──────────────────────────────────────────────────────────────────────────────
// BaseScraper — Clase base para todos los scrapers de MadridVPO
//
// Características:
//  • Dos estrategias: fetch+cheerio (rápido) ó Puppeteer (JS rendering/anti-bot)
//  • Reintento automático con backoff exponencial (3 intentos)
//  • User-Agent rotation realista
//  • Bloqueo de recursos innecesarios en Puppeteer (imágenes, fuentes, CSS)
//  • Hash MD5 del contenido normalizado para detectar cambios
//  • Parsers de texto reutilizables (precio, dormitorios, m2, estado)
// ──────────────────────────────────────────────────────────────────────────────

// Pool de instancias Puppeteer compartido entre todos los scrapers
let _browserInstance = null;
let _browserUses     = 0;
const MAX_BROWSER_USES = 50; // Reciclar Chrome cada 50 usos para evitar memory leaks

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
];

class BaseScraper {
  constructor(nombre) {
    this.nombre = nombre;
    this.logger = (msg, level = 'info') => {
      const prefix = `[${this.nombre}]`;
      if (level === 'error') console.error(prefix, msg);
      else if (level === 'warn')  console.warn(prefix, msg);
      else                        console.log(prefix, msg);
    };
  }

  // ── Fetch estático con Cheerio (más rápido, sin JavaScript) ──────────────
  async fetchHtml(url, opciones = {}) {
    const {
      timeout   = 20000,
      reintentos = 3,
      headers   = {}
    } = opciones;

    const ua = this._randomUA();

    for (let intento = 1; intento <= reintentos; intento++) {
      try {
        await this._delay(
          config.SCRAPING.delayMin * intento,
          config.SCRAPING.delayMax * intento
        );

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent':      ua,
            'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control':   'no-cache',
            'DNT':             '1',
            ...headers
          }
        });
        clearTimeout(timer);

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }

        const html = await res.text();
        return { html, $: cheerio.load(html), ok: true };

      } catch (e) {
        this.logger(`Intento ${intento}/${reintentos} fallido para ${url}: ${e.message}`, 'warn');
        if (intento === reintentos) {
          return { html: null, $: null, ok: false, error: e.message };
        }
        await this._delay(2000 * intento, 5000 * intento); // backoff
      }
    }
  }

  // ── Fetch con Puppeteer (para JS-rendered o sitios con anti-bot) ─────────
  async fetchWithPuppeteer(url, opciones = {}) {
    const {
      timeout       = 30000,
      reintentos    = 3,
      waitForSelector = null,
      blockResources  = true  // bloquear imágenes/fuentes para acelerar
    } = opciones;

    for (let intento = 1; intento <= reintentos; intento++) {
      let page = null;
      try {
        await this._delay(
          config.SCRAPING.delayMin * intento,
          config.SCRAPING.delayMax * intento
        );

        const browser = await this._getBrowser();
        page = await browser.newPage();

        // User-Agent real
        await page.setUserAgent(this._randomUA());
        await page.setExtraHTTPHeaders({
          'Accept-Language': 'es-ES,es;q=0.9',
          'DNT': '1'
        });

        // Bloquear recursos innecesarios (acelera 3-5x)
        if (blockResources) {
          await page.setRequestInterception(true);
          page.on('request', (req) => {
            const tipo = req.resourceType();
            if (['image', 'stylesheet', 'font', 'media'].includes(tipo)) {
              req.abort();
            } else {
              req.continue();
            }
          });
        }

        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout
        });

        // Esperar selector específico si se indica
        if (waitForSelector) {
          await page.waitForSelector(waitForSelector, { timeout: 10000 })
            .catch(() => {}); // no fallar si no aparece
        }

        const html = await page.content();
        await page.close();

        return { html, $: cheerio.load(html), ok: true };

      } catch (e) {
        if (page) await page.close().catch(() => {});
        this.logger(`Puppeteer intento ${intento}/${reintentos} fallido: ${e.message}`, 'warn');
        if (intento === reintentos) {
          return { html: null, $: null, ok: false, error: e.message };
        }
        await this._delay(3000 * intento, 8000 * intento);
      }
    }
  }

  // ── Hash MD5 del contenido (para detectar cambios) ───────────────────────
  hashContent(obj) {
    const str = JSON.stringify(obj, Object.keys(obj).sort());
    return crypto.createHash('md5').update(str).digest('hex');
  }

  // ── Normalizar datos de una promoción al esquema de BD ───────────────────
  normalizarPromocion(raw) {
    return {
      nombre:           this._limpiar(raw.nombre)         || null,
      tipo:             this._normalizarTipo(raw.tipo)    || null,
      zona:             this._limpiar(raw.zona)            || null,
      direccion:        this._limpiar(raw.direccion)       || null,
      precio_desde:     this._parsePrecio(raw.precio_desde) || null,
      precio_hasta:     this._parsePrecio(raw.precio_hasta) || null,
      precio_m2:        this._parsePrecio(raw.precio_m2)    || null,
      m2_desde:         this._parseEntero(raw.m2_desde)     || null,
      m2_hasta:         this._parseEntero(raw.m2_hasta)     || null,
      dormitorios_min:  this._parseEntero(raw.dormitorios_min) || null,
      dormitorios_max:  this._parseEntero(raw.dormitorios_max) || null,
      estado:           this._normalizarEstado(raw.estado) || 'en_proyecto',
      descripcion_corta: this._limpiar(raw.descripcion_corta)?.slice(0, 499) || null,
      imagen_principal: raw.imagen_principal || null,
      web_oficial:      raw.web_oficial      || null,
      fuente_scraping:  raw.fuente_scraping  || null,
      garaje_incluido:  raw.garaje_incluido  ?? null,
      trastero_incluido: raw.trastero_incluido ?? null,
      fecha_entrega_est: raw.fecha_entrega_est || null,
      metadatos:        raw.metadatos || {}
    };
  }

  // ── Parsers de texto ─────────────────────────────────────────────────────

  // Extrae precio de texto: "Desde 185.000 €" → 185000
  _parsePrecio(texto) {
    if (!texto) return null;
    if (typeof texto === 'number') return Math.round(texto);
    const match = String(texto).replace(/\./g, '').replace(/,/g, '.').match(/(\d+(?:\.\d+)?)/);
    return match ? Math.round(parseFloat(match[1])) : null;
  }

  // Extrae entero de texto: "95 m²" → 95
  _parseEntero(texto) {
    if (!texto) return null;
    if (typeof texto === 'number') return Math.round(texto);
    const match = String(texto).match(/(\d+)/);
    return match ? parseInt(match[1]) : null;
  }

  // "2 y 3 Dormitorios" | "2-4 dorm" | "2, 3 y 4" → { min: 2, max: 4 }
  parseDormitorios(texto) {
    if (!texto) return { min: null, max: null };
    const nums = String(texto).match(/\d+/g)?.map(Number) || [];
    if (!nums.length) return { min: null, max: null };
    return { min: Math.min(...nums), max: Math.max(...nums) };
  }

  // Normalizar tipo de vivienda al enum del sistema
  _normalizarTipo(texto) {
    if (!texto) return null;
    const t = String(texto).toUpperCase();
    if (t.includes('VPPL'))        return 'VPPL';
    if (t.includes('VPPB'))        return 'VPPB';
    if (t.includes('VPO'))         return 'VPO';
    if (t.includes('COOPERATIVA')) return 'cooperativa';
    if (t.includes('LIBRE'))       return 'libre';
    if (t.includes('PROTEGIDA'))   return 'VPPL'; // fallback genérico
    return null;
  }

  // Normalizar estado al enum del sistema
  _normalizarEstado(texto) {
    if (!texto) return null;
    const t = String(texto).toLowerCase();
    if (t.includes('entrega')  || t.includes('llave'))        return 'entregada';
    if (t.includes('adjudica') || t.includes('comercializ'))  return 'adjudicada';
    if (t.includes('sorteo'))                                  return 'sorteo';
    if (t.includes('lista') && t.includes('espera'))          return 'lista_espera';
    if (t.includes('construc') || t.includes('obra'))         return 'en_construccion';
    if (t.includes('proyecto') || t.includes('próximo') || t.includes('proximo')) return 'en_proyecto';
    return 'en_proyecto';
  }

  _limpiar(str) {
    if (!str) return null;
    return String(str).replace(/\s+/g, ' ').trim();
  }

  _randomUA() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  }

  // Delay aleatorio entre min y max ms
  async _delay(min = 1000, max = 3000) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(r => setTimeout(r, ms));
  }

  // ── Pool de Puppeteer ────────────────────────────────────────────────────
  async _getBrowser() {
    if (_browserInstance && _browserUses < MAX_BROWSER_USES) {
      // Verificar que sigue vivo
      try {
        await _browserInstance.version();
        _browserUses++;
        return _browserInstance;
      } catch {
        _browserInstance = null;
      }
    }

    // Crear nueva instancia
    if (_browserInstance) {
      await _browserInstance.close().catch(() => {});
    }

    _browserInstance = await puppeteer.launch({
      headless:       'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1366,768',
        '--lang=es-ES',
      ],
      defaultViewport: { width: 1366, height: 768 }
    });

    _browserUses = 1;
    this.logger('Nuevo navegador Puppeteer iniciado.', 'info');
    return _browserInstance;
  }

  // Llamar al apagar el servidor
  static async closeBrowser() {
    if (_browserInstance) {
      await _browserInstance.close().catch(() => {});
      _browserInstance = null;
      console.log('[BaseScraper] Navegador Puppeteer cerrado.');
    }
  }

  // ── Método abstracto — cada scraper lo implementa ────────────────────────
  // Debe devolver: { promociones: [PromocionNormalizada], fuente: string }
  async scrape() {
    throw new Error(`${this.nombre}: scrape() no implementado`);
  }
}

export default BaseScraper;
