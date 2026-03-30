import { Router } from 'express';
import { query, queryOne, run } from '../config/db.js';
import { verifyJWT, requireAuth } from '../middleware/auth.js';

const router = Router();

const ok  = (res, data)          => res.json({ success: true, data });
const err = (res, msg, code=400) => res.status(code).json({ success: false, error: msg });

// ── GET /api/alertas ───────────────────────────────────────────
router.get('/alertas', verifyJWT, requireAuth, async (req, res) => {
  try {
    const alertas = await query(
      `SELECT * FROM alertas WHERE usuario_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    ok(res, alertas);
  } catch (e) {
    console.error('[GET /alertas]', e.message);
    err(res, 'Error interno', 500);
  }
});

// ── POST /api/alertas ──────────────────────────────────────────
router.post('/alertas', verifyJWT, requireAuth, async (req, res) => {
  try {
    const {
      nombre,
      zonas        = [],
      tipos        = [],
      precio_max   = null,
      dormitorios  = [],
      notif_email  = true,
      notif_telegram = false
    } = req.body;

    if (!nombre?.trim()) return err(res, 'El nombre es obligatorio');

    const alerta = await queryOne(
      `INSERT INTO alertas
         (usuario_id, nombre, zonas, tipos, precio_max, dormitorios, notif_email, notif_telegram)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [req.user.id, nombre.trim(), zonas, tipos, precio_max, dormitorios, notif_email, notif_telegram]
    );
    ok(res, alerta);
  } catch (e) {
    console.error('[POST /alertas]', e.message);
    err(res, 'Error interno', 500);
  }
});

// ── PUT /api/alertas/:id ───────────────────────────────────────
router.put('/alertas/:id', verifyJWT, requireAuth, async (req, res) => {
  try {
    const existing = await queryOne(
      'SELECT id FROM alertas WHERE id = $1 AND usuario_id = $2',
      [req.params.id, req.user.id]
    );
    if (!existing) return err(res, 'Alerta no encontrada', 404);

    const {
      nombre,
      zonas,
      tipos,
      precio_max,
      dormitorios,
      notif_email,
      notif_telegram
    } = req.body;

    const campos = [];
    const vals   = [];
    let i = 1;

    if (nombre         !== undefined) { campos.push(`nombre = $${i++}`);         vals.push(nombre); }
    if (zonas          !== undefined) { campos.push(`zonas = $${i++}`);          vals.push(zonas); }
    if (tipos          !== undefined) { campos.push(`tipos = $${i++}`);          vals.push(tipos); }
    if (precio_max     !== undefined) { campos.push(`precio_max = $${i++}`);     vals.push(precio_max); }
    if (dormitorios    !== undefined) { campos.push(`dormitorios = $${i++}`);    vals.push(dormitorios); }
    if (notif_email    !== undefined) { campos.push(`notif_email = $${i++}`);    vals.push(notif_email); }
    if (notif_telegram !== undefined) { campos.push(`notif_telegram = $${i++}`); vals.push(notif_telegram); }

    if (!campos.length) return err(res, 'Sin campos para actualizar');

    vals.push(req.params.id);
    const alerta = await queryOne(
      `UPDATE alertas SET ${campos.join(', ')} WHERE id = $${i} RETURNING *`,
      vals
    );
    ok(res, alerta);
  } catch (e) {
    console.error('[PUT /alertas/:id]', e.message);
    err(res, 'Error interno', 500);
  }
});

// ── DELETE /api/alertas/:id ────────────────────────────────────
router.delete('/alertas/:id', verifyJWT, requireAuth, async (req, res) => {
  try {
    const existing = await queryOne(
      'SELECT id FROM alertas WHERE id = $1 AND usuario_id = $2',
      [req.params.id, req.user.id]
    );
    if (!existing) return err(res, 'Alerta no encontrada', 404);

    await run('DELETE FROM alertas WHERE id = $1', [req.params.id]);
    ok(res, { deleted: true });
  } catch (e) {
    console.error('[DELETE /alertas/:id]', e.message);
    err(res, 'Error interno', 500);
  }
});

// ── PATCH /api/alertas/:id/toggle ─────────────────────────────
router.patch('/alertas/:id/toggle', verifyJWT, requireAuth, async (req, res) => {
  try {
    const alerta = await queryOne(
      'SELECT id, activa FROM alertas WHERE id = $1 AND usuario_id = $2',
      [req.params.id, req.user.id]
    );
    if (!alerta) return err(res, 'Alerta no encontrada', 404);

    const updated = await queryOne(
      'UPDATE alertas SET activa = $1 WHERE id = $2 RETURNING *',
      [!alerta.activa, req.params.id]
    );
    ok(res, updated);
  } catch (e) {
    console.error('[PATCH /alertas/:id/toggle]', e.message);
    err(res, 'Error interno', 500);
  }
});

export default router;
