import nodemailer from 'nodemailer';
import config from '../config/config.js';

// ────────────────────────────────────────────────────────────────────
// EmailService — Nodemailer SMTP + plantillas HTML de alertas
// ────────────────────────────────────────────────────────────────────

class EmailService {
  constructor() {
    this.transporter = null;
    this.enabled = false;
    this._init();
  }

  _init() {
    if (!config.EMAIL.user || !config.EMAIL.pass) {
      console.warn('[EmailService] Credenciales SMTP no configuradas. Emails desactivados.');
      return;
    }
    this.transporter = nodemailer.createTransport({
      host:   config.EMAIL.host,
      port:   config.EMAIL.port,
      secure: config.EMAIL.port === 465,
      auth:   { user: config.EMAIL.user, pass: config.EMAIL.pass },
      tls:    { rejectUnauthorized: config.NODE_ENV === 'production' }
    });
    this.enabled = true;
    console.log('[EmailService] Transporter SMTP configurado.');
  }

  // ── Verificar conexión SMTP ─────────────────────────────────────
  async verify() {
    if (!this.enabled) return false;
    try {
      await this.transporter.verify();
      return true;
    } catch (e) {
      console.error('[EmailService] Fallo al verificar SMTP:', e.message);
      return false;
    }
  }

  // ── Enviar alerta de nuevas promociones ─────────────────────────
  async sendAlertEmail(usuario, alerta, promociones) {
    if (!this.enabled) return { ok: false, reason: 'SMTP no configurado' };
    if (!promociones.length) return { ok: false, reason: 'Sin promociones' };

    const num  = promociones.length;
    const sing = num === 1;

    try {
      await this.transporter.sendMail({
        from:    config.EMAIL.from,
        to:      usuario.email,
        subject: `🏠 ${num} ${sing ? 'nueva' : 'nuevas'} VPO detectada${sing ? '' : 's'}: "${alerta.nombre}"`,
        html:    this._buildAlertHTML(usuario, alerta, promociones)
      });
      return { ok: true };
    } catch (e) {
      console.error('[EmailService] Error enviando alerta email:', e.message);
      return { ok: false, reason: e.message };
    }
  }

  // ── Email de bienvenida ─────────────────────────────────────────
  async sendWelcomeEmail(usuario) {
    if (!this.enabled) return;
    try {
      await this.transporter.sendMail({
        from:    config.EMAIL.from,
        to:      usuario.email,
        subject: '¡Bienvenido/a a MadridVPO!',
        html:    this._buildWelcomeHTML(usuario)
      });
    } catch (e) {
      console.error('[EmailService] Error enviando welcome email:', e.message);
    }
  }

  // ── Envío genérico (para reutilizar desde otros servicios) ──────
  async send({ to, subject, html }) {
    if (!this.enabled) return { ok: false, reason: 'SMTP no configurado' };
    try {
      await this.transporter.sendMail({ from: config.EMAIL.from, to, subject, html });
      return { ok: true };
    } catch (e) {
      console.error('[EmailService] Error en send():', e.message);
      return { ok: false, reason: e.message };
    }
  }

  // ── Plantilla HTML: alerta de nuevas promociones ────────────────
  _buildAlertHTML(usuario, alerta, promociones) {
    const BASE_URL = process.env.BASE_URL || 'https://madridvpo.com';
    const nombreUsuario = usuario.nombre || 'vecino/a';

    const tarjetas = promociones.map(p => {
      const precio = p.precio_desde
        ? `Desde <strong>${p.precio_desde.toLocaleString('es-ES')} €</strong>`
        : 'Precio no publicado';
      const dorms = (p.dormitorios_min && p.dormitorios_max)
        ? `${p.dormitorios_min}–${p.dormitorios_max} dormitorios`
        : p.dormitorios_min
          ? `${p.dormitorios_min}+ dormitorios`
          : '';
      const estadoColor = {
        en_proyecto:      '#f59e0b',
        en_construccion:  '#3b82f6',
        lista_espera:     '#8b5cf6',
        sorteo:           '#ec4899',
        adjudicada:       '#6b7280',
        entregada:        '#10b981'
      }[p.estado] || '#6b7280';

      return `
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;
                    padding:20px;margin-bottom:16px;">
          <div style="display:flex;align-items:center;margin-bottom:12px;">
            <span style="background:${estadoColor};color:#fff;font-size:11px;
                         font-weight:700;padding:3px 10px;border-radius:20px;
                         text-transform:uppercase;letter-spacing:0.05em;">
              ${p.estado?.replace(/_/g, ' ') || 'sin estado'}
            </span>
            ${p.tipo ? `<span style="margin-left:8px;background:#f3f4f6;color:#374151;
                         font-size:11px;font-weight:600;padding:3px 10px;
                         border-radius:20px;">${p.tipo}</span>` : ''}
          </div>
          <h3 style="margin:0 0 6px;font-size:17px;color:#111827;">${p.nombre}</h3>
          ${p.zona ? `<p style="margin:0 0 10px;color:#6b7280;font-size:13px;">
            📍 ${p.zona}${p.direccion ? ' — ' + p.direccion : ''}
          </p>` : ''}
          <p style="margin:0 0 10px;font-size:15px;color:#7c3aed;">${precio}</p>
          ${dorms ? `<p style="margin:0 0 12px;font-size:13px;color:#374151;">🛏 ${dorms}</p>` : ''}
          <a href="${BASE_URL}/promocion/${p.slug}"
             style="display:inline-block;background:#7c3aed;color:#fff;
                    padding:10px 20px;border-radius:8px;text-decoration:none;
                    font-size:14px;font-weight:600;">
            Ver detalles →
          </a>
        </div>`;
    }).join('');

    // Resumen de filtros de la alerta
    const filtros = [];
    if (alerta.zonas?.length)      filtros.push(`Zonas: ${alerta.zonas.join(', ')}`);
    if (alerta.tipos?.length)      filtros.push(`Tipos: ${alerta.tipos.join(', ')}`);
    if (alerta.precio_max)         filtros.push(`Precio máx: ${alerta.precio_max.toLocaleString('es-ES')} €`);
    if (alerta.dormitorios?.length) filtros.push(`Dormitorios: ${alerta.dormitorios.join(', ')}`);

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Nuevas VPO — MadridVPO</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Cabecera -->
        <tr><td style="background:#7c3aed;border-radius:12px 12px 0 0;padding:28px 32px;text-align:center;">
          <h1 style="margin:0;color:#fff;font-size:24px;font-weight:800;letter-spacing:-0.5px;">
            🏠 MadridVPO
          </h1>
          <p style="margin:6px 0 0;color:#e9d5ff;font-size:14px;">
            Vivienda protegida en Madrid
          </p>
        </td></tr>

        <!-- Cuerpo -->
        <tr><td style="background:#fff;padding:28px 32px;">
          <p style="margin:0 0 16px;font-size:16px;color:#374151;">
            Hola <strong>${nombreUsuario}</strong>,
          </p>
          <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
            Tu alerta <strong>"${alerta.nombre}"</strong> ha detectado
            <strong>${promociones.length} nueva${promociones.length > 1 ? 's' : ''} VPO</strong>
            que coincide${promociones.length === 1 ? '' : 'n'} con tus criterios:
          </p>

          ${filtros.length ? `
          <div style="background:#f5f3ff;border-left:4px solid #7c3aed;
                      border-radius:0 8px 8px 0;padding:12px 16px;margin-bottom:24px;">
            <p style="margin:0;font-size:13px;color:#5b21b6;">
              ${filtros.join(' &nbsp;·&nbsp; ')}
            </p>
          </div>` : ''}

          ${tarjetas}

          <div style="text-align:center;margin-top:28px;">
            <a href="${BASE_URL}/app.html"
               style="display:inline-block;background:#f3f4f6;color:#374151;
                      padding:12px 28px;border-radius:8px;text-decoration:none;
                      font-size:14px;font-weight:600;">
              Ver todas las promociones
            </a>
          </div>
        </td></tr>

        <!-- Pie -->
        <tr><td style="background:#f3f4f6;border-radius:0 0 12px 12px;padding:20px 32px;text-align:center;">
          <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
            Recibes este email porque tienes activa la alerta <strong>"${alerta.nombre}"</strong>.<br>
            Puedes <a href="${BASE_URL}/perfil.html" style="color:#7c3aed;">gestionar tus alertas</a>
            en tu perfil de MadridVPO.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  // ── Plantilla HTML: bienvenida ──────────────────────────────────
  _buildWelcomeHTML(usuario) {
    const BASE_URL = process.env.BASE_URL || 'https://madridvpo.com';
    const nombre = usuario.nombre || 'vecino/a';

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Bienvenido a MadridVPO</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr><td style="background:#7c3aed;border-radius:12px 12px 0 0;padding:28px 32px;text-align:center;">
          <h1 style="margin:0;color:#fff;font-size:24px;font-weight:800;">🏠 MadridVPO</h1>
          <p style="margin:6px 0 0;color:#e9d5ff;font-size:14px;">Vivienda protegida en Madrid</p>
        </td></tr>
        <tr><td style="background:#fff;padding:28px 32px;">
          <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">¡Bienvenido/a, ${nombre}!</h2>
          <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 20px;">
            Tu cuenta en MadridVPO está lista. Ahora puedes:
          </p>
          <ul style="color:#374151;font-size:15px;line-height:2;padding-left:20px;margin:0 0 24px;">
            <li>🔍 Buscar VPO en el <strong>mapa interactivo</strong></li>
            <li>🔔 Crear <strong>alertas personalizadas</strong> por zona, precio y dormitorios</li>
            <li>📋 Gestionar tu <strong>expediente personal</strong> de solicitud</li>
            <li>📱 Recibir notificaciones por <strong>email o Telegram</strong></li>
          </ul>
          <div style="text-align:center;">
            <a href="${BASE_URL}/app.html"
               style="display:inline-block;background:#7c3aed;color:#fff;
                      padding:14px 32px;border-radius:8px;text-decoration:none;
                      font-size:15px;font-weight:700;">
              Explorar VPO disponibles →
            </a>
          </div>
        </td></tr>
        <tr><td style="background:#f3f4f6;border-radius:0 0 12px 12px;padding:20px 32px;text-align:center;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">
            MadridVPO — Vivienda protegida en Madrid
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }
}

export default new EmailService();
