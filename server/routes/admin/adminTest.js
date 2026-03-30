import { Router } from 'express';
import { verifyJWT, requireAuth, requireRole } from '../../middleware/auth.js';
import EmailService   from '../../services/EmailService.js';
import TelegramService from '../../services/TelegramService.js';
import AlertService   from '../../services/AlertService.js';

const router = Router();
const ok  = (res, data)          => res.json({ success: true, data });
const err = (res, msg, code=400) => res.status(code).json({ success: false, error: msg });

const esAdmin = [verifyJWT, requireAuth, requireRole('admin')];

// ── POST /api/admin/test/email ──────────────────────────────
// Envía un email de prueba al admin
router.post('/test/email', esAdmin, async (req, res) => {
  const { destinatario } = req.body;
  const para = destinatario || req.user.email;

  const result = await EmailService.send({
    to:      para,
    subject: '✅ Test MadridVPO — Email funcionando',
    html: `
      <div style="font-family:sans-serif;padding:32px;max-width:500px">
        <h2 style="color:#7c3aed;">🏠 MadridVPO — Test de email</h2>
        <p>El sistema de notificaciones por email está funcionando correctamente.</p>
        <p style="color:#6b7280;font-size:13px;">Enviado: ${new Date().toLocaleString('es-ES')}</p>
      </div>`
  });

  if (result.ok) ok(res, { enviado: true, destinatario: para });
  else err(res, `Error SMTP: ${result.reason}`, 502);
});

// ── POST /api/admin/test/telegram ──────────────────────────
// Envía un mensaje de prueba a un chat_id de Telegram
router.post('/test/telegram', esAdmin, async (req, res) => {
  const { chat_id } = req.body;
  if (!chat_id) return err(res, 'Falta chat_id');

  if (!TelegramService.enabled)
    return err(res, 'Bot de Telegram no está activo', 503);

  const result = await TelegramService.sendMessage(
    chat_id,
    `✅ <b>MadridVPO — Test de Telegram</b>\n\nEl bot está funcionando correctamente.\n\n<i>${new Date().toLocaleString('es-ES')}</i>`
  );

  if (result.ok) ok(res, { enviado: true, chat_id });
  else err(res, `Error Telegram: ${result.reason}`, 502);
});

// ── POST /api/admin/test/alertas ────────────────────────────
// Fuerza una comprobación de alertas ahora mismo
router.post('/test/alertas', esAdmin, async (req, res) => {
  try {
    const resultado = await AlertService.triggerCheck();
    ok(res, resultado);
  } catch (e) {
    err(res, e.message, 500);
  }
});

// ── GET /api/admin/test/status ──────────────────────────────
// Estado de todos los servicios de notificación
router.get('/test/status', esAdmin, async (req, res) => {
  const smtpOk = await EmailService.verify();
  ok(res, {
    email:    { activo: EmailService.enabled,    smtp_ok: smtpOk },
    telegram: { activo: TelegramService.enabled, username: TelegramService.username || null }
  });
});

export default router;
