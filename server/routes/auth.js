import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { run, queryOne } from '../config/db.js';
import AuthService from '../services/AuthService.js';
import TelegramService from '../services/TelegramService.js';
import { verifyJWT, requireAuth } from '../middleware/auth.js';

const router = Router();

const ok  = (res, data)          => res.json({ success: true, data });
const err = (res, msg, code=400) => {
  console.error(`[Auth] ${code} — ${msg}`);
  return res.status(code).json({ success: false, error: msg });
};

// Rate limiting: máx 5 intentos de login por IP cada 15 minutos
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, error: 'Demasiados intentos. Espera 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiting más permisivo para registro
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'Demasiados intentos de registro.' }
});

// ── POST /api/auth/register ────────────────────────────────
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { email, nombre, password } = req.body;
    if (!email || !password)  return err(res, 'Email y contraseña son obligatorios');
    if (password.length < 8)  return err(res, 'La contraseña debe tener al menos 8 caracteres');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err(res, 'Email inválido');

    const { usuario, accessToken, refreshToken } = await AuthService.register({ email, nombre, password });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    ok(res, { usuario, accessToken });
  } catch (e) { err(res, e.message); }
});

// ── POST /api/auth/login ───────────────────────────────────
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return err(res, 'Email y contraseña son obligatorios');

    const { usuario, accessToken, refreshToken } = await AuthService.login({ email, password });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    ok(res, { usuario, accessToken });
  } catch (e) { err(res, e.message, 401); }
});

// ── POST /api/auth/refresh ─────────────────────────────────
router.post('/refresh', async (req, res) => {
  try {
    const rawToken = req.cookies?.refreshToken;
    const { usuario, accessToken, refreshToken } = await AuthService.refresh(rawToken);

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    ok(res, { usuario, accessToken });
  } catch (e) {
    res.clearCookie('refreshToken');
    err(res, e.message, 401);
  }
});

// ── POST /api/auth/logout ──────────────────────────────────
router.post('/logout', async (req, res) => {
  try {
    await AuthService.logout(req.cookies?.refreshToken);
    res.clearCookie('refreshToken');
    ok(res, { message: 'Sesión cerrada correctamente' });
  } catch (e) { err(res, e.message); }
});

// ── POST /api/auth/logout-all ──────────────────────────────
router.post('/logout-all', verifyJWT, requireAuth, async (req, res) => {
  try {
    await AuthService.logoutAll(req.user.id);
    res.clearCookie('refreshToken');
    ok(res, { message: 'Todas las sesiones cerradas' });
  } catch (e) { err(res, e.message); }
});

// ── POST /api/auth/change-password ────────────────────────
router.post('/change-password', verifyJWT, requireAuth, async (req, res) => {
  try {
    const { passwordActual, passwordNueva } = req.body;
    if (!passwordActual || !passwordNueva) return err(res, 'Campos obligatorios');
    if (passwordNueva.length < 8) return err(res, 'Mínimo 8 caracteres');

    await AuthService.changePassword(req.user.id, { passwordActual, passwordNueva });
    res.clearCookie('refreshToken');
    ok(res, { message: 'Contraseña actualizada. Inicia sesión de nuevo.' });
  } catch (e) { err(res, e.message); }
});

// ── GET /api/auth/me ───────────────────────────────────────
router.get('/me', verifyJWT, requireAuth, async (req, res) => {
  try {
    ok(res, { id: req.user.id, email: req.user.email, rol: req.user.rol, plan: req.user.plan });
  } catch (e) { err(res, e.message); }
});

// ── GET /api/auth/telegram-link ────────────────────────────
// Genera un deep-link de vinculación con token de 30 minutos
router.get('/telegram-link', verifyJWT, requireAuth, async (req, res) => {
  try {
    // Verificar que el bot está activo
    if (!TelegramService.enabled) {
      return err(res, 'Bot de Telegram no configurado en este servidor', 503);
    }

    // Generar token de 48 hex chars
    const token  = TelegramService.generateLinkToken();
    const expiry = new Date(Date.now() + 30 * 60 * 1000); // 30 min

    // Guardar token en preferencias del usuario (merge con JSONB existente)
    await run(
      `UPDATE usuarios
       SET preferencias = preferencias ||
             jsonb_build_object(
               'telegram_token',         $1::text,
               'telegram_token_expiry',  $2::text
             ),
           updated_at = NOW()
       WHERE id = $3`,
      [token, expiry.toISOString(), req.user.id]
    );

    const deepLink = TelegramService.getLinkUrl(token);
    ok(res, { deepLink, expira_en: expiry });
  } catch (e) {
    console.error('[GET /telegram-link]', e.message);
    err(res, 'Error interno', 500);
  }
});

// ── GET /api/auth/telegram-status ──────────────────────────
// Devuelve si el usuario ya tiene Telegram vinculado
router.get('/telegram-status', verifyJWT, requireAuth, async (req, res) => {
  try {
    const usuario = await queryOne(
      'SELECT telegram_chat_id, telegram_username FROM usuarios WHERE id = $1',
      [req.user.id]
    );
    ok(res, {
      vinculado: !!usuario?.telegram_chat_id,
      username:  usuario?.telegram_username || null
    });
  } catch (e) {
    err(res, 'Error interno', 500);
  }
});

// ── DELETE /api/auth/telegram-link ─────────────────────────
// Desvincular Telegram desde la web (sin necesidad del bot)
router.delete('/telegram-link', verifyJWT, requireAuth, async (req, res) => {
  try {
    await run(
      `UPDATE usuarios
       SET telegram_chat_id  = NULL,
           telegram_username = NULL,
           updated_at        = NOW()
       WHERE id = $1`,
      [req.user.id]
    );
    ok(res, { desvinculado: true });
  } catch (e) {
    err(res, 'Error interno', 500);
  }
});

export default router;
