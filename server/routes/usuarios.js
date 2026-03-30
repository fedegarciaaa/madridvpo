import { Router } from 'express';
import bcrypt from 'bcrypt';
import { query, queryOne, run } from '../config/db.js';
import { verifyJWT, requireAuth } from '../middleware/auth.js';

const router = Router();

const ok  = (res, data)          => res.json({ success: true, data });
const err = (res, msg, code=400) => res.status(code).json({ success: false, error: msg });

// ── GET /api/usuarios/me ───────────────────────────────────────
router.get('/usuarios/me', verifyJWT, requireAuth, async (req, res) => {
  try {
    const u = await queryOne(
      `SELECT id, email, nombre, rol, telegram_chat_id, preferencias, expediente, activo, created_at
         FROM usuarios WHERE id = $1`,
      [req.user.id]
    );
    if (!u) return err(res, 'Usuario no encontrado', 404);
    ok(res, u);
  } catch (e) {
    console.error('[GET /me]', e.message);
    err(res, 'Error interno', 500);
  }
});

// ── PUT /api/usuarios/me ───────────────────────────────────────
router.put('/usuarios/me', verifyJWT, requireAuth, async (req, res) => {
  try {
    const { nombre, telegram_chat_id } = req.body;
    const campos = [];
    const vals   = [];
    let i = 1;

    if (nombre !== undefined)           { campos.push(`nombre = $${i++}`);           vals.push(nombre); }
    if (telegram_chat_id !== undefined) { campos.push(`telegram_chat_id = $${i++}`); vals.push(telegram_chat_id); }

    if (!campos.length) return err(res, 'Sin campos para actualizar');

    vals.push(req.user.id);
    const u = await queryOne(
      `UPDATE usuarios SET ${campos.join(', ')} WHERE id = $${i}
       RETURNING id, email, nombre, rol, telegram_chat_id, preferencias, expediente`,
      vals
    );
    ok(res, u);
  } catch (e) {
    console.error('[PUT /me]', e.message);
    err(res, 'Error interno', 500);
  }
});

// ── PUT /api/usuarios/me/preferencias ─────────────────────────
router.put('/usuarios/me/preferencias', verifyJWT, requireAuth, async (req, res) => {
  try {
    const patch = req.body;
    if (!patch || typeof patch !== 'object') return err(res, 'Body inválido');

    const u = await queryOne(
      `UPDATE usuarios
          SET preferencias = preferencias || $1::jsonb
        WHERE id = $2
        RETURNING id, preferencias`,
      [JSON.stringify(patch), req.user.id]
    );
    ok(res, u);
  } catch (e) {
    console.error('[PUT /me/preferencias]', e.message);
    err(res, 'Error interno', 500);
  }
});

// ── PUT /api/usuarios/me/expediente ───────────────────────────
router.put('/usuarios/me/expediente', verifyJWT, requireAuth, async (req, res) => {
  try {
    const patch = req.body;
    if (!patch || typeof patch !== 'object') return err(res, 'Body inválido');

    const u = await queryOne(
      `UPDATE usuarios
          SET expediente = expediente || $1::jsonb
        WHERE id = $2
        RETURNING id, expediente`,
      [JSON.stringify(patch), req.user.id]
    );
    ok(res, u);
  } catch (e) {
    console.error('[PUT /me/expediente]', e.message);
    err(res, 'Error interno', 500);
  }
});

// ── PUT /api/usuarios/me/password ─────────────────────────────
router.put('/usuarios/me/password', verifyJWT, requireAuth, async (req, res) => {
  try {
    const { password_actual, password_nueva } = req.body;
    if (!password_actual || !password_nueva) return err(res, 'Faltan campos');
    if (password_nueva.length < 8) return err(res, 'La nueva contraseña debe tener al menos 8 caracteres');

    const u = await queryOne('SELECT password_hash FROM usuarios WHERE id = $1', [req.user.id]);
    if (!u) return err(res, 'Usuario no encontrado', 404);

    const ok_pass = await bcrypt.compare(password_actual, u.password_hash);
    if (!ok_pass) return err(res, 'Contraseña actual incorrecta', 401);

    const hash = await bcrypt.hash(password_nueva, 12);
    await run('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);

    ok(res, { message: 'Contraseña actualizada' });
  } catch (e) {
    console.error('[PUT /me/password]', e.message);
    err(res, 'Error interno', 500);
  }
});

export default router;
