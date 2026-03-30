import { Router } from 'express';
import PromocionService from '../services/PromocionService.js';
import { query } from '../config/db.js';

const router = Router();

const ok  = (res, data)          => res.json({ success: true, data });
const err = (res, msg, code=400) => res.status(code).json({ success: false, error: msg });

// ── GET /api/promotoras — listado público ──────────────────
router.get('/promotoras', async (req, res) => {
  try {
    ok(res, await PromocionService.listarPromotoras());
  } catch (e) { err(res, e.message, 500); }
});

// ── GET /api/promotoras/:id — detalle promotora ───────────
router.get('/promotoras/:id', async (req, res) => {
  try {
    const rows = await query(
      `SELECT p.*,
              COUNT(DISTINCT pr.id)::int AS total_promociones,
              COUNT(DISTINCT pr.id) FILTER (WHERE pr.publicada = true)::int AS promociones_activas
       FROM promotoras p
       LEFT JOIN promociones pr ON pr.promotora_id = p.id
       WHERE p.id = $1 AND p.activa = true
       GROUP BY p.id`,
      [req.params.id]
    );
    if (!rows.length) return err(res, 'Promotora no encontrada', 404);
    ok(res, rows[0]);
  } catch (e) { err(res, e.message, 500); }
});

export default router;
