import { Router } from 'express';
import crypto from 'crypto';
import { verifyJWT } from '../middleware/auth.js';
import PromocionService from '../services/PromocionService.js';
import { run } from '../config/db.js';

const router = Router();

const ok  = (res, data)          => res.json({ success: true, data });
const err = (res, msg, code=400) => res.status(code).json({ success: false, error: msg });

// ── GET /api/promociones — listado público con filtros ─────
router.get('/promociones', verifyJWT, async (req, res) => {
  try {
    const { zona, tipo, estado, precioMax, dormitorios, pagina, limite } = req.query;

    // Registrar búsqueda para analytics / mapa de calor (anónima)
    if (zona || tipo) {
      const ipHash = req.ip ? crypto.createHash('md5').update(req.ip).digest('hex') : null;
      run(
        'INSERT INTO busquedas (zona, tipo, precio_max, dormitorios, usuario_id, ip_hash) VALUES ($1,$2,$3,$4,$5,$6)',
        [zona || null, tipo || null, precioMax ? parseInt(precioMax) : null,
         dormitorios ? parseInt(dormitorios) : null,
         req.user?.id || null, ipHash]
      ).catch(() => {}); // No bloquear la respuesta si falla
    }

    ok(res, await PromocionService.listar({
      zona, tipo, estado, precioMax, dormitorios, pagina, limite,
      usuario: req.user
    }));
  } catch (e) { err(res, e.message, 500); }
});

// ── GET /api/promociones/geojson — datos para Mapbox ──────
router.get('/promociones/geojson', async (req, res) => {
  try {
    ok(res, await PromocionService.geojson());
  } catch (e) { err(res, e.message, 500); }
});

// ── GET /api/promociones/actividad — Radar de Actividad ───
router.get('/promociones/actividad', async (req, res) => {
  try {
    const limite = Math.min(parseInt(req.query.limite) || 20, 50);
    ok(res, await PromocionService.getActividad(limite));
  } catch (e) { err(res, e.message, 500); }
});

// ── GET /api/promociones/:idOrSlug — detalle ──────────────
router.get('/promociones/:idOrSlug', verifyJWT, async (req, res) => {
  try {
    const p = await PromocionService.detalle(req.params.idOrSlug, req.user);
    if (!p) return err(res, 'Promoción no encontrada o no disponible', 404);
    ok(res, p);
  } catch (e) { err(res, e.message, 500); }
});

// ── POST /api/promociones/:id/comentarios ─────────────────
router.post('/promociones/:id/comentarios', verifyJWT, async (req, res) => {
  try {
    if (!req.user) return err(res, 'Debes iniciar sesión para comentar', 401);
    const { contenido, parent_id } = req.body;
    if (!contenido?.trim()) return err(res, 'El comentario no puede estar vacío');
    if (contenido.length > 2000) return err(res, 'Comentario demasiado largo (máx. 2000 caracteres)');

    const { queryOne: qOne } = await import('../config/db.js');
    const c = await qOne(
      `INSERT INTO comentarios (promocion_id, usuario_id, contenido, parent_id, aprobado)
       VALUES ($1, $2, $3, $4, false) RETURNING id, contenido, created_at`,
      [req.params.id, req.user.id, contenido.trim(), parent_id || null]
    );
    ok(res, { ...c, mensaje: 'Comentario enviado. Pendiente de moderación.' });
  } catch (e) { err(res, e.message, 500); }
});

export default router;
