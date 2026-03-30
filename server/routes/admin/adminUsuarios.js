import { Router } from 'express';
import { verifyJWT, requireRole } from '../../middleware/auth.js';
import { query, queryOne, run } from '../../config/db.js';

const router = Router();
router.use(verifyJWT, requireRole('admin'));

const ok  = (res, data)          => res.json({ success: true, data });
const err = (res, msg, code=400) => res.status(code).json({ success: false, error: msg });

// GET /api/admin/usuarios
router.get('/usuarios', async (req, res) => {
  try {
    const { pagina = 1, limite = 50, plan, rol, buscar } = req.query;
    const conditions = [];
    const params = [];
    let i = 1;

    if (plan)   { conditions.push(`plan = $${i++}`);  params.push(plan); }
    if (rol)    { conditions.push(`rol = $${i++}`);   params.push(rol); }
    if (buscar) { conditions.push(`(email ILIKE $${i} OR nombre ILIKE $${i})`); params.push(`%${buscar}%`); i++; }

    const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (parseInt(pagina) - 1) * parseInt(limite);

    const [filas, total] = await Promise.all([
      query(
        `SELECT id, email, nombre, rol, plan, activo, email_verificado,
                telegram_chat_id, created_at, last_login
         FROM usuarios ${where} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`,
        [...params, parseInt(limite), offset]
      ),
      queryOne(`SELECT COUNT(*)::int AS total FROM usuarios ${where}`, params)
    ]);

    ok(res, { usuarios: filas, total: total?.total || 0, pagina: parseInt(pagina) });
  } catch (e) { err(res, e.message, 500); }
});

// PUT /api/admin/usuarios/:id/plan
router.put('/usuarios/:id/plan', async (req, res) => {
  try {
    const { plan } = req.body;
    if (!['free', 'premium'].includes(plan)) return err(res, 'Plan inválido');
    const u = await queryOne(
      'UPDATE usuarios SET plan = $1, rol = $2, updated_at = NOW() WHERE id = $3 RETURNING id, email, nombre, rol, plan',
      [plan, plan === 'premium' ? 'premium' : 'free', req.params.id]
    );
    if (!u) return err(res, 'Usuario no encontrado', 404);
    ok(res, u);
  } catch (e) { err(res, e.message); }
});

// PUT /api/admin/usuarios/:id/activar
router.put('/usuarios/:id/activar', async (req, res) => {
  try {
    const { activo } = req.body;
    const u = await queryOne(
      'UPDATE usuarios SET activo = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, nombre, activo',
      [!!activo, req.params.id]
    );
    if (!u) return err(res, 'Usuario no encontrado', 404);
    ok(res, u);
  } catch (e) { err(res, e.message); }
});

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  try {
    const [usuarios, promociones, alertas] = await Promise.all([
      queryOne(`SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE plan = 'premium')::int AS premium,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS nuevos_semana
        FROM usuarios`),
      queryOne(`SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE publicada = true)::int AS publicadas,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS nuevas_semana
        FROM promociones`),
      queryOne('SELECT COUNT(*)::int AS total FROM alertas WHERE activa = true')
    ]);
    ok(res, { usuarios, promociones, alertas });
  } catch (e) { err(res, e.message, 500); }
});

export default router;
