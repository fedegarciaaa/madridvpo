import { Router } from 'express';
import { query, queryOne, run } from '../../config/db.js';
import { verifyJWT, requireAuth, requireRole } from '../../middleware/auth.js';
import ScrapingService from '../../services/ScrapingService.js';

const router  = Router();
const ok      = (res, data)           => res.json({ success: true, data });
const err     = (res, msg, code = 400) => res.status(code).json({ success: false, error: msg });
const esAdmin = [verifyJWT, requireAuth, requireRole('admin')];

// ── GET /api/admin/scraping/jobs ────────────────────────────────────────────
// Lista todos los jobs con estado y estadísticas
router.get('/scraping/jobs', esAdmin, async (req, res) => {
  try {
    const jobs = await query(
      `SELECT sj.*,
              p.nombre   AS promotora_nombre,
              p.web      AS promotora_web,
              (SELECT COUNT(*) FROM scraping_queue sq
               WHERE sq.scraping_job_id = sj.id AND sq.estado = 'pending') AS pendientes_cola
       FROM scraping_jobs sj
       LEFT JOIN promotoras p ON p.id = sj.promotora_id
       ORDER BY sj.promotora_id, sj.id`
    );
    ok(res, jobs);
  } catch (e) {
    err(res, 'Error interno', 500);
  }
});

// ── GET /api/admin/scraping/jobs/:id ────────────────────────────────────────
router.get('/scraping/jobs/:id', esAdmin, async (req, res) => {
  try {
    const job = await queryOne(
      `SELECT sj.*, p.nombre AS promotora_nombre
       FROM scraping_jobs sj
       LEFT JOIN promotoras p ON p.id = sj.promotora_id
       WHERE sj.id = $1`,
      [req.params.id]
    );
    if (!job) return err(res, 'Job no encontrado', 404);
    ok(res, job);
  } catch (e) {
    err(res, 'Error interno', 500);
  }
});

// ── PATCH /api/admin/scraping/jobs/:id/toggle ───────────────────────────────
// Activar/pausar un job
router.patch('/scraping/jobs/:id/toggle', esAdmin, async (req, res) => {
  try {
    const job = await queryOne('SELECT id, activo FROM scraping_jobs WHERE id = $1', [req.params.id]);
    if (!job) return err(res, 'Job no encontrado', 404);

    const updated = await queryOne(
      `UPDATE scraping_jobs
       SET activo = $1,
           estado = $2
       WHERE id = $3 RETURNING *`,
      [!job.activo, !job.activo ? 'pending' : 'pausado', job.id]
    );
    ok(res, updated);
  } catch (e) {
    err(res, 'Error interno', 500);
  }
});

// ── POST /api/admin/scraping/run/:id ────────────────────────────────────────
// Forzar ejecución inmediata de un job concreto (fire-and-forget)
// El panel admin hace polling cada 5s para ver el progreso
router.post('/scraping/run/:id', esAdmin, async (req, res) => {
  try {
    const job = await queryOne('SELECT id FROM scraping_jobs WHERE id = $1', [req.params.id]);
    if (!job) return err(res, 'Job no encontrado', 404);

    // No bloqueamos la petición HTTP — el scraping corre en background
    ScrapingService.runJob(parseInt(req.params.id))
      .catch(e => console.error('[adminScraping] runJob error:', e.message));

    ok(res, { iniciado: true });
  } catch (e) {
    err(res, e.message, 500);
  }
});

// ── POST /api/admin/scraping/run-all ────────────────────────────────────────
// Forzar ejecución de TODOS los jobs activos (ignora proximo_check)
// Fire-and-forget: responde inmediatamente, el scraping sigue en background
router.post('/scraping/run-all', esAdmin, async (req, res) => {
  try {
    if (ScrapingService.corriendo) {
      return ok(res, { ok: false, razon: 'Ya hay una ejecución en curso' });
    }
    // forzar=true → salta el filtro proximo_check, corre TODOS los jobs
    ScrapingService.runAll(true)
      .catch(e => console.error('[adminScraping] runAll error:', e.message));

    ok(res, { iniciado: true });
  } catch (e) {
    err(res, e.message, 500);
  }
});

// ── GET /api/admin/scraping/queue ───────────────────────────────────────────
// Cola de cambios pendientes de revisión
router.get('/scraping/queue', esAdmin, async (req, res) => {
  try {
    const { estado = 'pending', page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const items = await query(
      `SELECT sq.*,
              sj.url AS job_url,
              p.nombre AS promotora_nombre,
              pro.nombre AS promocion_nombre_actual,
              u.nombre AS revisado_por_nombre
       FROM scraping_queue sq
       LEFT JOIN scraping_jobs  sj  ON sj.id  = sq.scraping_job_id
       LEFT JOIN promotoras     p   ON p.id   = sj.promotora_id
       LEFT JOIN promociones    pro ON pro.id = sq.promocion_id
       LEFT JOIN usuarios       u   ON u.id   = sq.revisado_por
       WHERE sq.estado = $1
       ORDER BY sq.created_at DESC
       LIMIT $2 OFFSET $3`,
      [estado, parseInt(limit), offset]
    );

    const total = await queryOne(
      'SELECT COUNT(*) AS n FROM scraping_queue WHERE estado = $1',
      [estado]
    );

    ok(res, { items, total: parseInt(total.n), page: parseInt(page), limit: parseInt(limit) });
  } catch (e) {
    err(res, 'Error interno', 500);
  }
});

// ── POST /api/admin/scraping/queue/:id/aprobar ──────────────────────────────
// Aprobar un cambio: crea/actualiza la promoción en la BD
router.post('/scraping/queue/:id/aprobar', esAdmin, async (req, res) => {
  try {
    const resultado = await ScrapingService.aprobarCola(parseInt(req.params.id), req.user.id);
    ok(res, resultado);
  } catch (e) {
    console.error('[adminScraping] Error aprobando:', e.message);
    err(res, e.message, 500);
  }
});

// ── POST /api/admin/scraping/queue/:id/rechazar ─────────────────────────────
router.post('/scraping/queue/:id/rechazar', esAdmin, async (req, res) => {
  try {
    const { notas = '' } = req.body;
    const resultado = await ScrapingService.rechazarCola(parseInt(req.params.id), req.user.id, notas);
    ok(res, resultado);
  } catch (e) {
    err(res, e.message, 500);
  }
});

// ── GET /api/admin/scraping/stats ───────────────────────────────────────────
// Estadísticas generales del sistema de scraping
router.get('/scraping/stats', esAdmin, async (req, res) => {
  try {
    const [jobs, cola, errores] = await Promise.all([
      queryOne(`SELECT
        COUNT(*) FILTER (WHERE activo = true)  AS activos,
        COUNT(*) FILTER (WHERE estado = 'ok')  AS ok,
        COUNT(*) FILTER (WHERE estado = 'error') AS con_error,
        COUNT(*) FILTER (WHERE estado = 'running') AS corriendo,
        COUNT(*) AS total
        FROM scraping_jobs`),
      queryOne(`SELECT
        COUNT(*) FILTER (WHERE estado = 'pending')  AS pendientes,
        COUNT(*) FILTER (WHERE estado = 'aprobado') AS aprobados,
        COUNT(*) FILTER (WHERE estado = 'rechazado') AS rechazados
        FROM scraping_queue`),
      query(`SELECT sj.id, p.nombre, sj.consecutivos_error, sj.ultimo_error, sj.ultimo_check
             FROM scraping_jobs sj
             JOIN promotoras p ON p.id = sj.promotora_id
             WHERE sj.consecutivos_error > 0
             ORDER BY sj.consecutivos_error DESC
             LIMIT 5`)
    ]);

    // corriendo_servicio: flag en memoria del proceso Node.js
    // Necesario para que el cliente detecte el inicio antes de que la BD se actualice
    ok(res, {
      jobs:               { ...jobs, corriendo_servicio: ScrapingService.corriendo },
      cola,
      errores_recientes:  errores
    });
  } catch (e) {
    err(res, 'Error interno', 500);
  }
});

export default router;
