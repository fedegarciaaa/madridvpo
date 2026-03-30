import { Router } from 'express';
import { verifyJWT, requireRole } from '../../middleware/auth.js';
import PromocionService from '../../services/PromocionService.js';

const router = Router();
router.use(verifyJWT, requireRole('admin'));

const ok  = (res, data)          => res.json({ success: true, data });
const err = (res, msg, code=400) => res.status(code).json({ success: false, error: msg });

// ── PROMOTORAS ─────────────────────────────────────────────

// GET  /api/admin/promotoras
router.get('/promotoras', async (req, res) => {
  try { ok(res, await PromocionService.adminListarPromotoras()); }
  catch (e) { err(res, e.message, 500); }
});

// POST /api/admin/promotoras
router.post('/promotoras', async (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre) return err(res, 'El nombre es obligatorio');
    ok(res, await PromocionService.crearPromotora(req.body));
  } catch (e) { err(res, e.message); }
});

// PUT  /api/admin/promotoras/:id
router.put('/promotoras/:id', async (req, res) => {
  try { ok(res, await PromocionService.actualizarPromotora(req.params.id, req.body)); }
  catch (e) { err(res, e.message); }
});

// ── PROMOCIONES ────────────────────────────────────────────

// GET  /api/admin/promociones
router.get('/promociones', async (req, res) => {
  try {
    const { pagina, limite, publicada, zona, tipo } = req.query;
    ok(res, await PromocionService.adminListar({ pagina, limite, publicada, zona, tipo }));
  } catch (e) { err(res, e.message, 500); }
});

// GET  /api/admin/promociones/:id
router.get('/promociones/:id', async (req, res) => {
  try {
    const p = await PromocionService.adminDetalle(req.params.id);
    if (!p) return err(res, 'Promoción no encontrada', 404);
    ok(res, p);
  } catch (e) { err(res, e.message, 500); }
});

// POST /api/admin/promociones
router.post('/promociones', async (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre) return err(res, 'El nombre de la promoción es obligatorio');
    ok(res, await PromocionService.crear(req.body));
  } catch (e) { err(res, e.message); }
});

// PUT  /api/admin/promociones/:id
router.put('/promociones/:id', async (req, res) => {
  try { ok(res, await PromocionService.actualizar(req.params.id, req.body)); }
  catch (e) { err(res, e.message); }
});

// POST /api/admin/promociones/:id/publicar
router.post('/promociones/:id/publicar', async (req, res) => {
  try {
    const p = await PromocionService.publicar(req.params.id);
    if (!p) return err(res, 'Promoción no encontrada', 404);
    // Registrar en el Radar de Actividad
    await PromocionService.registrarActividad({
      tipo: 'nueva_promocion',
      titulo: `Nueva promoción publicada: ${p.nombre}`,
      descripcion: `${p.zona || ''} · ${p.tipo}`,
      promocion_id: p.id,
      icono: 'building-2',
      color: 'blue'
    });
    ok(res, p);
  } catch (e) { err(res, e.message); }
});

// POST /api/admin/promociones/:id/despublicar
router.post('/promociones/:id/despublicar', async (req, res) => {
  try {
    const p = await PromocionService.despublicar(req.params.id);
    if (!p) return err(res, 'Promoción no encontrada', 404);
    ok(res, p);
  } catch (e) { err(res, e.message); }
});

// DELETE /api/admin/promociones/:id
router.delete('/promociones/:id', async (req, res) => {
  try {
    await PromocionService.eliminar(req.params.id);
    ok(res, { mensaje: 'Promoción eliminada' });
  } catch (e) { err(res, e.message); }
});

export default router;
