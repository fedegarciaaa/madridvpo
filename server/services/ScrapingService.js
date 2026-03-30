import { query, queryOne, run } from '../config/db.js';
import BaseScraper from './scrapers/BaseScraper.js';
import config from '../config/config.js';

// Importar todos los scrapers
import IbosaScraper      from './scrapers/IbosaScraper.js';
import HercesaScraper    from './scrapers/HercesaScraper.js';
import SerprocollScraper from './scrapers/SerprocollScraper.js';
import PrygesaScraper    from './scrapers/PrygesaScraper.js';
import ImpulsaScraper    from './scrapers/ImpulsaScraper.js';
import AuroraScraper     from './scrapers/AuroraScraper.js';

// ──────────────────────────────────────────────────────────────────────────────
// ScrapingService — Orquestador de scrapers
//
// Flujo:
//   1. Lee scraping_jobs activos de la BD
//   2. Asocia cada job con su scraper por promotora_id
//   3. Ejecuta el scraper correspondiente
//   4. Compara hash del resultado con el último hash guardado
//   5. Si hay cambios → inserta en scraping_queue para revisión admin
//   6. Actualiza estado y contadores de error en scraping_jobs
//   7. Registra actividad en tabla actividad (radar público)
//
// NUNCA autopublica. Todo cambio va a la cola para aprobación del admin.
// ──────────────────────────────────────────────────────────────────────────────

// Mapa promotora_id → scraper (basado en el seed 003_seed_promotoras.sql)
const SCRAPERS_POR_PROMOTORA = {
  1: IbosaScraper,       // Grupo Ibosa
  2: SerprocollScraper,  // SERPROCOL / Libra Gestora
  3: AuroraScraper,      // Aurora Homes
  4: PrygesaScraper,     // Prygesa
  5: ImpulsaScraper,     // Grupo Impulsa
  // 6: Asentis — dominio parking, sin scraper
  7: HercesaScraper,     // Hercesa
  // 8: EMVS — eliminado (scraping de noticias en lugar de promociones reales)
};

class ScrapingService {
  constructor() {
    this.corriendo = false;
  }

  // ── Resetear jobs stuck en 'running' al arrancar (por reinicios abruptos) ─
  async init() {
    try {
      await run(`UPDATE scraping_jobs SET estado = 'pending' WHERE estado = 'running'`);
      console.log('[ScrapingService] Init: jobs "running" reseteados a "pending".');
    } catch (e) {
      console.error('[ScrapingService] Error en init():', e.message);
    }
    this.corriendo = false;
  }

  // ── Ejecutar todos los jobs activos ─────────────────────────────────────
  // forzar=true → ignora proximo_check (útil desde el panel admin)
  async runAll(forzar = false) {
    if (this.corriendo) {
      console.log('[ScrapingService] Ya hay una ejecución en curso. Saltando.');
      return { ok: false, razon: 'Ya en ejecución' };
    }

    this.corriendo = true;
    console.log(`[ScrapingService] Iniciando ciclo de scraping${forzar ? ' (FORZADO — ignora proximo_check)' : ''}...`);

    try {
      // Cuando se fuerza desde el admin, saltamos el filtro de tiempo
      // para que corran TODOS los jobs activos independientemente de cuándo tocaba
      const condProximo = forzar
        ? ''
        : 'AND (sj.proximo_check IS NULL OR sj.proximo_check <= NOW())';

      const jobs = await query(
        `SELECT sj.*, p.nombre AS promotora_nombre
         FROM scraping_jobs sj
         JOIN promotoras p ON p.id = sj.promotora_id
         WHERE sj.activo = true
           AND sj.estado != 'pausado'
           ${condProximo}
         ORDER BY sj.promotora_id, sj.id`
      );

      if (!jobs.length) {
        console.log('[ScrapingService] ⚠️  Sin jobs pendientes (todos pausados o inactivos).');
        return { ok: true, jobs: 0, cambios: 0 };
      }

      console.log(`[ScrapingService] ✅ ${jobs.length} jobs seleccionados:`);
      jobs.forEach(j => console.log(`   · Job #${j.id} — ${j.promotora_nombre} (activo=${j.activo}, estado=${j.estado}, proximo_check=${j.proximo_check})`));

      // Agrupar jobs por promotora para evitar múltiples ejecuciones del mismo scraper
      const porPromotora = {};
      for (const job of jobs) {
        if (!porPromotora[job.promotora_id]) porPromotora[job.promotora_id] = [];
        porPromotora[job.promotora_id].push(job);
      }

      let totalCambios = 0;

      for (const [promotora_id, jobsPromotora] of Object.entries(porPromotora)) {
        console.log(`\n[ScrapingService] ━━━ Procesando promotora_id=${promotora_id} (${jobsPromotora[0]?.promotora_nombre}) ━━━`);
        const cambios = await this._procesarPromotora(parseInt(promotora_id), jobsPromotora);
        totalCambios += cambios;
        console.log(`[ScrapingService] ━━━ Promotora ${jobsPromotora[0]?.promotora_nombre}: ${cambios} cambios ━━━\n`);

        // Pausa entre promotoras para no sobrecargar
        await this._delay(5000, 12000);
      }

      console.log(`[ScrapingService] 🏁 Ciclo completado. ${totalCambios} cambios detectados en total.`);
      return { ok: true, jobs: jobs.length, cambios: totalCambios };

    } catch (e) {
      console.error('[ScrapingService] Error en runAll:', e.message);
      return { ok: false, error: e.message };
    } finally {
      this.corriendo = false;
    }
  }

  // ── Ejecutar un job específico (para el panel admin) ────────────────────
  async runJob(jobId) {
    const job = await queryOne(
      `SELECT sj.*, p.nombre AS promotora_nombre
       FROM scraping_jobs sj
       JOIN promotoras p ON p.id = sj.promotora_id
       WHERE sj.id = $1`,
      [jobId]
    );

    if (!job) throw new Error(`Job ${jobId} no encontrado`);
    return this._procesarPromotora(job.promotora_id, [job]);
  }

  // ── Procesar todos los jobs de una promotora ─────────────────────────────
  async _procesarPromotora(promotora_id, jobs) {
    const scraper = SCRAPERS_POR_PROMOTORA[promotora_id];
    const promotora_nombre = jobs[0]?.promotora_nombre || `Promotora ${promotora_id}`;

    if (!scraper) {
      console.warn(`[ScrapingService] Sin scraper para promotora_id=${promotora_id}. Saltando.`);
      return 0;
    }

    // Marcar todos sus jobs como "running"
    for (const job of jobs) {
      await run(`UPDATE scraping_jobs SET estado = 'running', ultimo_check = NOW() WHERE id = $1`, [job.id]);
    }

    let cambios = 0;
    let errorMsg = null;

    // Tiempo máximo por scraper — evita que EMVS u otros bloqueen el ciclo completo
    const TIMEOUT_MS = 12 * 60 * 1000; // 12 minutos por promotora

    try {
      console.log(`[ScrapingService] Ejecutando ${scraper.nombre} para "${promotora_nombre}"...`);
      const { promociones, error } = await Promise.race([
        scraper.scrape(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`Timeout: ${scraper.nombre} tardó más de 12 minutos`)),
            TIMEOUT_MS
          )
        ),
      ]);

      if (error && !promociones.length) {
        throw new Error(error);
      }

      console.log(`[ScrapingService] ${scraper.nombre}: ${promociones.length} promociones obtenidas.`);

      // Procesar cada promoción encontrada
      for (const promo of promociones) {
        if (!promo?.nombre) continue;
        const hayCambio = await this._procesarPromocion(promo, promotora_id, jobs[0]);
        if (hayCambio) cambios++;
      }

      // Marcar jobs como OK
      const proxCheck = this._calcularProximoCheck(jobs[0]);
      for (const job of jobs) {
        await run(
          `UPDATE scraping_jobs
           SET estado = 'ok', consecutivos_error = 0,
               ultimo_error = NULL, proximo_check = $1
           WHERE id = $2`,
          [proxCheck, job.id]
        );
      }

    } catch (e) {
      errorMsg = e.message;
      console.error(`[ScrapingService] Error en ${scraper.nombre}:`, e.message);

      for (const job of jobs) {
        const consecutivos = (job.consecutivos_error || 0) + 1;
        await run(
          `UPDATE scraping_jobs
           SET estado = 'error', consecutivos_error = $1,
               ultimo_error = $2, proximo_check = $3
           WHERE id = $4`,
          [
            consecutivos,
            errorMsg.slice(0, 1000),
            this._calcularProximoCheckError(consecutivos),
            job.id
          ]
        );

        // Alertar al admin si supera el umbral de errores consecutivos
        if (consecutivos >= config.SCRAPING.maxConsecutiveErrors) {
          await this._alertarAdmin(promotora_nombre, consecutivos, errorMsg);
        }
      }
    }

    return cambios;
  }

  // ── Procesar una promoción individual: detectar si es nueva o ha cambiado ─
  async _procesarPromocion(promo, promotora_id, job) {
    // Calcular hash del contenido normalizado
    const hashActual = BaseScraper.prototype.hashContent.call({ nombre: 'hash' }, promo);

    // Buscar si ya existe esta promoción en la BD (por nombre + promotora o por fuente)
    const existente = await queryOne(
      `SELECT id, nombre FROM promociones
       WHERE (nombre ILIKE $1 OR fuente_scraping = $2)
         AND promotora_id = $3
       LIMIT 1`,
      [`%${promo.nombre?.slice(0, 50)}%`, promo.fuente_scraping, promotora_id]
    );

    if (!existente) {
      // ── NUEVA PROMOCIÓN → queue para revisión admin ──────────────────────
      console.log(`  [LOG] "${promo.nombre}" → NO existe en BD. Intentando encolar como nueva_promocion.`);
      console.log(`        fuente_scraping="${promo.fuente_scraping}" job_id=${job.id} hash=${hashActual.slice(0,8)}...`);

      await this._insertarEnCola({
        scraping_job_id: job.id,
        promocion_id:    null,
        tipo_cambio:     'nueva_promocion',
        datos_scrapeados: { ...promo, promotora_id, hash: hashActual },
        datos_actuales:  null
      });

      // Actualizar hash del job
      await run(`UPDATE scraping_jobs SET ultimo_hash = $1 WHERE id = $2`, [hashActual, job.id]);
      console.log(`  [+] Nueva promoción encolada: "${promo.nombre}"`);
      return true;

    } else {
      // ── PROMOCIÓN EXISTENTE → comparar con datos actuales ───────────────
      const actual = await queryOne(
        `SELECT precio_desde, precio_hasta, estado, dormitorios_min, dormitorios_max,
                published_at, publicada
         FROM promociones WHERE id = $1`,
        [existente.id]
      );

      // Detectar tipo de cambio
      const tipoCambio = this._detectarTipoCambio(actual, promo);

      console.log(`  [LOG] "${promo.nombre}" → EXISTS en BD (id=${existente.id}).`);
      console.log(`        tipoCambio=${tipoCambio || 'null(sin cambio)'} | hash_job=${job.ultimo_hash?.slice(0,8)} vs hash_actual=${hashActual.slice(0,8)}`);

      if (!tipoCambio) {
        console.log(`  [=]  Sin cambio relevante en "${promo.nombre}". Skipping.`);
        return false;
      }

      // Solo encolar si el hash es diferente al del job
      if (job.ultimo_hash === hashActual) {
        console.log(`  [=]  Hash idéntico al último run. Skipping (ya encolado antes).`);
        return false;
      }

      await this._insertarEnCola({
        scraping_job_id:  job.id,
        promocion_id:     existente.id,
        tipo_cambio:      tipoCambio,
        datos_scrapeados: { ...promo, hash: hashActual },
        datos_actuales:   actual
      });

      await run(`UPDATE scraping_jobs SET ultimo_hash = $1 WHERE id = $2`, [hashActual, job.id]);
      console.log(`  [~] Cambio encolado en "${existente.nombre}": ${tipoCambio}`);
      return true;
    }
  }

  // ── Detectar qué tipo de cambio ha ocurrido ──────────────────────────────
  _detectarTipoCambio(actual, nuevo) {
    if (!actual) return 'nueva_promocion';

    // Cambio de precio significativo (>1%)
    if (nuevo.precio_desde && actual.precio_desde) {
      const diff = Math.abs(nuevo.precio_desde - actual.precio_desde);
      if (diff / actual.precio_desde > 0.01) return 'cambio_precio';
    }

    // Cambio de estado
    if (nuevo.estado && actual.estado && nuevo.estado !== actual.estado) {
      if (nuevo.estado === 'lista_espera') return 'nueva_lista_espera';
      if (nuevo.estado === 'sorteo')       return 'sorteo';
      return 'cambio_estado';
    }

    // Si no hubo cambio relevante
    return null;
  }

  // ── Insertar en scraping_queue ────────────────────────────────────────────
  async _insertarEnCola({ scraping_job_id, promocion_id, tipo_cambio, datos_scrapeados, datos_actuales }) {
    try {
      // No duplicar si ya existe una entrada pendiente del mismo tipo para la misma promo.
      // Para nueva_promocion (promocion_id=null) usamos el nombre en datos_scrapeados
      // para diferenciar cada promoción; si usáramos solo IS NULL matchearíamos TODAS las
      // nuevas del mismo job y solo se insertaría la primera.
      const nombreScrapeado = datos_scrapeados?.nombre || '';
      const existente = await queryOne(
        `SELECT id FROM scraping_queue
         WHERE scraping_job_id = $1
           AND tipo_cambio = $3
           AND estado = 'pending'
           AND (
             ($2::int IS NOT NULL AND promocion_id = $2)
             OR
             ($2::int IS NULL AND datos_scrapeados->>'nombre' = $4)
           )`,
        [scraping_job_id, promocion_id, tipo_cambio, nombreScrapeado]
      );
      if (existente) {
        console.log(`  [SKIP-COLA] Duplicado pendiente para "${nombreScrapeado}" (tipo=${tipo_cambio}). Ya en queue id=${existente.id}`);
        return;
      }

      await run(
        `INSERT INTO scraping_queue
           (scraping_job_id, promocion_id, tipo_cambio, datos_scrapeados, datos_actuales)
         VALUES ($1, $2, $3, $4, $5)`,
        [scraping_job_id, promocion_id, tipo_cambio,
         JSON.stringify(datos_scrapeados), datos_actuales ? JSON.stringify(datos_actuales) : null]
      );

      // Registrar en radar de actividad
      await this._registrarActividad(tipo_cambio, datos_scrapeados, promocion_id);

    } catch (e) {
      console.error('[ScrapingService] Error insertando en cola:', e.message);
    }
  }

  // ── Registrar en tabla actividad (radar público de la landing) ───────────
  async _registrarActividad(tipo_cambio, datos, promocion_id) {
    const config_actividad = {
      nueva_promocion:   { titulo: `Nueva VPO detectada: ${datos.nombre}`,         icono: 'home',       color: 'text-green-500'  },
      cambio_precio:     { titulo: `Cambio de precio en: ${datos.nombre}`,          icono: 'tag',        color: 'text-yellow-500' },
      nueva_lista_espera:{ titulo: `Nueva lista de espera: ${datos.nombre}`,        icono: 'list',       color: 'text-purple-500' },
      sorteo:            { titulo: `¡Sorteo detectado! ${datos.nombre}`,            icono: 'dice-6',     color: 'text-pink-500'   },
      cambio_estado:     { titulo: `Cambio de estado en: ${datos.nombre}`,          icono: 'refresh-cw', color: 'text-blue-500'   },
    };

    const cfg = config_actividad[tipo_cambio];
    if (!cfg) return;

    try {
      await run(
        `INSERT INTO actividad (tipo, titulo, descripcion, promocion_id, icono, color, publica)
         VALUES ($1, $2, $3, $4, $5, $6, false)`,
        // publica=false hasta que el admin apruebe la entrada en la cola
        [tipo_cambio, cfg.titulo.slice(0, 499),
         `Detectado en ${datos.fuente_scraping || datos.web_oficial}`.slice(0, 999),
         promocion_id || null, cfg.icono, cfg.color]
      );
    } catch (e) {
      // No crítico si falla el radar
    }
  }

  // ── Alertar al admin por email si hay demasiados errores consecutivos ────
  async _alertarAdmin(promotora, consecutivos, errorMsg) {
    try {
      const { default: EmailService } = await import('./EmailService.js');
      if (!config.ADMIN_EMAIL) return;
      await EmailService.send({
        to:      config.ADMIN_EMAIL,
        subject: `⚠️ MadridVPO — Scraper con errores: ${promotora}`,
        html: `
          <div style="font-family:sans-serif;padding:24px">
            <h2 style="color:#dc2626">⚠️ Error en scraper</h2>
            <p><strong>Promotora:</strong> ${promotora}</p>
            <p><strong>Errores consecutivos:</strong> ${consecutivos}</p>
            <p><strong>Último error:</strong> ${errorMsg}</p>
            <p>Revisa el panel de administración → Sección Scraping.</p>
          </div>`
      });
    } catch (e) {
      console.error('[ScrapingService] Error enviando alerta admin:', e.message);
    }
  }

  // ── Calcular próximo check según el intervalo del job ────────────────────
  _calcularProximoCheck(job) {
    const horas = job.scraping_interval_horas || 24;
    const next  = new Date();
    next.setHours(next.getHours() + horas);
    return next;
  }

  // Backoff exponencial para errores (máx 48h)
  _calcularProximoCheckError(consecutivos) {
    const horasBase = Math.min(2 ** consecutivos, 48);
    const next = new Date();
    next.setHours(next.getHours() + horasBase);
    return next;
  }

  async _delay(min, max) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(r => setTimeout(r, ms));
  }

  // ── Aprobar un elemento de la cola: crear/actualizar promoción en BD ─────
  async aprobarCola(colaId, adminId) {
    const item = await queryOne(
      'SELECT * FROM scraping_queue WHERE id = $1 AND estado = $2',
      [colaId, 'pending']
    );
    if (!item) throw new Error('Elemento no encontrado o ya procesado');

    const datos = item.datos_scrapeados;
    const promotora_id = datos.promotora_id;

    if (item.tipo_cambio === 'nueva_promocion') {
      // Crear nueva promoción (no publicada — admin decide cuándo publicar)
      const slug = this._generarSlug(datos.nombre);
      await run(
        `INSERT INTO promociones
           (promotora_id, nombre, slug, tipo, zona, direccion,
            precio_desde, precio_hasta, precio_m2,
            m2_desde, m2_hasta, dormitorios_min, dormitorios_max,
            estado, descripcion_corta, imagen_principal,
            web_oficial, fuente_scraping, publicada,
            garaje_incluido, trastero_incluido, metadatos)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,false,$19,$20,$21)
         ON CONFLICT (slug) DO NOTHING`,
        [
          promotora_id || null,
          datos.nombre, slug, datos.tipo, datos.zona, datos.direccion,
          datos.precio_desde, datos.precio_hasta, datos.precio_m2,
          datos.m2_desde, datos.m2_hasta, datos.dormitorios_min, datos.dormitorios_max,
          datos.estado || 'en_proyecto',
          datos.descripcion_corta, datos.imagen_principal,
          datos.web_oficial, datos.fuente_scraping,
          datos.garaje_incluido, datos.trastero_incluido,
          JSON.stringify(datos.metadatos || {})
        ]
      );

    } else if (item.promocion_id) {
      // Actualizar promoción existente
      const campos = [];
      const vals   = [];
      let i = 1;

      const mapeo = {
        precio_desde: datos.precio_desde,
        precio_hasta: datos.precio_hasta,
        estado:       datos.estado,
        descripcion_corta: datos.descripcion_corta,
      };
      for (const [campo, valor] of Object.entries(mapeo)) {
        if (valor !== null && valor !== undefined) {
          campos.push(`${campo} = $${i++}`);
          vals.push(valor);
        }
      }
      if (campos.length) {
        campos.push(`updated_at = NOW()`);
        vals.push(item.promocion_id);
        await run(`UPDATE promociones SET ${campos.join(', ')} WHERE id = $${i}`, vals);
      }
    }

    // Marcar como aprobado
    await run(
      `UPDATE scraping_queue
       SET estado = 'aprobado', revisado_por = $1, revisado_at = NOW()
       WHERE id = $2`,
      [adminId, colaId]
    );

    return { ok: true };
  }

  // ── Rechazar un elemento de la cola ─────────────────────────────────────
  async rechazarCola(colaId, adminId, notas = '') {
    await run(
      `UPDATE scraping_queue
       SET estado = 'rechazado', revisado_por = $1, revisado_at = NOW(), notas_admin = $2
       WHERE id = $3 AND estado = 'pending'`,
      [adminId, notas, colaId]
    );
    return { ok: true };
  }

  _generarSlug(nombre) {
    return (nombre || 'promocion')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 340);
  }

  // Parar Puppeteer al apagar servidor
  async shutdown() {
    await BaseScraper.closeBrowser();
  }
}

export default new ScrapingService();
