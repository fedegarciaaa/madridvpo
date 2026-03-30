import TelegramBot from 'node-telegram-bot-api';
import crypto from 'crypto';
import { run, queryOne } from '../config/db.js';
import config from '../config/config.js';

// ────────────────────────────────────────────────────────────────────
// TelegramService — Bot de Telegram para notificaciones de VPO
//
// Flujo de vinculación:
//   1. Usuario pide token desde /api/auth/telegram-link (GET, autenticado)
//   2. Backend guarda token en preferencias.telegram_token (expira en 30 min)
//   3. Se devuelve deep-link: t.me/BotName?start=TOKEN
//   4. Usuario abre el enlace → le llega /start TOKEN al bot
//   5. Bot busca el usuario por token, guarda telegram_chat_id
// ────────────────────────────────────────────────────────────────────

const BASE_URL = process.env.BASE_URL || 'https://madridvpo.com';

class TelegramService {
  constructor() {
    this.bot      = null;
    this.enabled  = false;
    this.username = null; // nombre público del bot (@MadridVPOBot)
  }

  // ── Inicializar bot ─────────────────────────────────────────────
  init() {
    if (!config.TELEGRAM_BOT_TOKEN) {
      console.warn('[TelegramService] TELEGRAM_BOT_TOKEN no configurado. Bot desactivado.');
      return;
    }

    this._stopped = false;

    try {
      this.bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, {
        polling: {
          interval:   2000,
          autoStart:  true,
          params:     { timeout: 10 }
        }
      });

      // Obtener info del bot para construir deep-links
      this.bot.getMe().then(info => {
        this.username = info.username;
        this.enabled  = true;
        console.log(`[TelegramService] Bot @${info.username} iniciado correctamente.`);
      }).catch(e => {
        console.error('[TelegramService] Error al obtener info del bot:', e.message);
        this.enabled = false;
      });

      // ── Comando /start con token de vinculación ─────────────────
      this.bot.onText(/\/start ([a-f0-9]{48})/, async (msg, match) => {
        await this._handleStartLink(msg.chat.id, msg.from?.username, match[1]);
      });

      // ── Comando /start sin token (bienvenida) ───────────────────
      this.bot.onText(/^\/start$/, async (msg) => {
        await this._sendWelcome(msg.chat.id);
      });

      // ── Comando /estado ─────────────────────────────────────────
      this.bot.onText(/\/estado/, async (msg) => {
        const usuario = await queryOne(
          'SELECT nombre, plan FROM usuarios WHERE telegram_chat_id = $1',
          [msg.chat.id.toString()]
        );
        if (!usuario) {
          await this.bot.sendMessage(msg.chat.id,
            '❌ Tu cuenta de Telegram no está vinculada.\n\n' +
            `Vincúlala en ${BASE_URL}/perfil.html`
          );
          return;
        }
        await this.bot.sendMessage(msg.chat.id,
          `✅ <b>Cuenta vinculada</b>\n` +
          `👤 ${usuario.nombre || 'Sin nombre'}\n` +
          `🎖 Plan: ${usuario.plan}`,
          { parse_mode: 'HTML' }
        );
      });

      // ── Comando /id ────────────────────────────────────────────
      this.bot.onText(/\/id/, async (msg) => {
        await this.bot.sendMessage(msg.chat.id,
          `🪪 Tu chat ID es: <code>${msg.chat.id}</code>\n\nCópialo para usarlo en el panel de admin.`,
          { parse_mode: 'HTML' }
        );
      });

      // ── Comando /desvincular ────────────────────────────────────
      this.bot.onText(/\/desvincular/, async (msg) => {
        const result = await run(
          `UPDATE usuarios SET telegram_chat_id = NULL, telegram_username = NULL,
           updated_at = NOW() WHERE telegram_chat_id = $1`,
          [msg.chat.id.toString()]
        );
        if (result.rowCount > 0) {
          await this.bot.sendMessage(msg.chat.id,
            '✅ Cuenta desvinculada. Ya no recibirás notificaciones en Telegram.'
          );
        } else {
          await this.bot.sendMessage(msg.chat.id,
            '⚠️ Esta cuenta de Telegram no estaba vinculada a ningún usuario de MadridVPO.'
          );
        }
      });

      // ── Errores de polling ──────────────────────────────────────
      this.bot.on('polling_error', (err) => {
        // 401 = token inválido | EFATAL = error fatal → parar definitivamente
        const is401 = err.response?.statusCode === 401 || err.message?.includes('401');
        if (err.code === 'EFATAL' || is401) {
          if (!this._stopped) {
            this._stopped = true;
            console.error('[TelegramService] Token inválido (401). Bot desactivado.');
            this.enabled = false;
            this.bot.stopPolling().catch(() => {});
          }
          return;
        }
        // Errores de red son transitorios, solo loguear
        console.warn('[TelegramService] Polling error (transitorio):', err.message);
      });

    } catch (e) {
      console.error('[TelegramService] Error al inicializar bot:', e.message);
    }
  }

  // ── Vincular cuenta por token ───────────────────────────────────
  async _handleStartLink(chatId, username, token) {
    // Buscar usuario con ese token que no haya expirado
    const usuario = await queryOne(
      `SELECT id, email, nombre
       FROM usuarios
       WHERE preferencias->>'telegram_token' = $1
         AND (preferencias->>'telegram_token_expiry')::timestamptz > NOW()`,
      [token]
    );

    if (!usuario) {
      await this.bot.sendMessage(chatId,
        '❌ <b>Enlace inválido o expirado.</b>\n\n' +
        'Genera un nuevo enlace desde tu perfil en MadridVPO.',
        { parse_mode: 'HTML' }
      );
      return;
    }

    // Guardar chat_id y limpiar token
    await run(
      `UPDATE usuarios
       SET telegram_chat_id   = $1,
           telegram_username  = $2,
           preferencias       = preferencias
                                  - 'telegram_token'
                                  - 'telegram_token_expiry',
           updated_at         = NOW()
       WHERE id = $3`,
      [chatId.toString(), username || null, usuario.id]
    );

    await this.bot.sendMessage(chatId,
      `✅ <b>¡Cuenta vinculada!</b>\n\n` +
      `Hola, <b>${usuario.nombre || usuario.email}</b>.\n\n` +
      `A partir de ahora recibirás tus alertas de VPO directamente aquí.\n\n` +
      `Comandos disponibles:\n` +
      `  /estado — ver tu cuenta\n` +
      `  /desvincular — desconectar Telegram\n\n` +
      `Gestiona tus alertas en ${BASE_URL}/perfil.html`,
      { parse_mode: 'HTML' }
    );
  }

  // ── Mensaje de bienvenida genérico ──────────────────────────────
  async _sendWelcome(chatId) {
    await this.bot.sendMessage(chatId,
      `🏠 <b>Bienvenido/a al bot de MadridVPO</b>\n\n` +
      `Te aviso cuando aparezcan nuevas VPO en Madrid que coincidan con tus alertas.\n\n` +
      `Para empezar, vincula tu cuenta en:\n${BASE_URL}/perfil.html\n\n` +
      `Comandos:\n` +
      `  /estado — ver cuenta vinculada\n` +
      `  /desvincular — desconectar Telegram`,
      { parse_mode: 'HTML' }
    );
  }

  // ── Enviar mensaje genérico ─────────────────────────────────────
  async sendMessage(chatId, text, options = {}) {
    if (!this.enabled || !this.bot) return { ok: false, reason: 'Bot no disponible' };
    try {
      await this.bot.sendMessage(chatId, text, { parse_mode: 'HTML', ...options });
      return { ok: true };
    } catch (e) {
      // chat no encontrado / bloqueado → loguear pero no lanzar excepción
      console.error(`[TelegramService] Error enviando a ${chatId}:`, e.message);
      return { ok: false, reason: e.message };
    }
  }

  // ── Enviar notificación de alerta formateada ────────────────────
  async sendAlertMessage(chatId, alerta, promociones) {
    if (!this.enabled || !this.bot) return { ok: false, reason: 'Bot no disponible' };

    const num  = promociones.length;
    const sing = num === 1;
    const lines = [
      `🏠 <b>${num} ${sing ? 'nueva VPO detectada' : 'nuevas VPO detectadas'}</b>`,
      `🔔 Alerta: <i>"${alerta.nombre}"</i>`,
      ''
    ];

    for (const p of promociones.slice(0, 5)) {
      const estadoEmoji = {
        en_proyecto:      '📐',
        en_construccion:  '🏗',
        lista_espera:     '📋',
        sorteo:           '🎲',
        adjudicada:       '🔒',
        entregada:        '🔑'
      }[p.estado] || '🏠';

      lines.push(`${estadoEmoji} <b>${p.nombre}</b>`);
      if (p.zona)        lines.push(`   📍 ${p.zona}`);
      if (p.tipo)        lines.push(`   🏷 ${p.tipo}`);
      if (p.precio_desde) lines.push(`   💰 Desde ${p.precio_desde.toLocaleString('es-ES')} €`);
      if (p.dormitorios_min) {
        const dMax = p.dormitorios_max && p.dormitorios_max !== p.dormitorios_min
          ? `–${p.dormitorios_max}`
          : '';
        lines.push(`   🛏 ${p.dormitorios_min}${dMax} dormitorios`);
      }
      if (p.slug) lines.push(`   🔗 <a href="${BASE_URL}/promocion/${p.slug}">Ver detalles</a>`);
      lines.push('');
    }

    if (num > 5) {
      lines.push(`<i>... y ${num - 5} más. <a href="${BASE_URL}/app.html">Ver todas</a></i>`);
    }

    return this.sendMessage(chatId, lines.join('\n'));
  }

  // ── Generar token de vinculación ────────────────────────────────
  // Devuelve { token, deepLink } para guardar en BD y mostrar al usuario
  generateLinkToken() {
    return crypto.randomBytes(24).toString('hex'); // 48 hex chars
  }

  // ── Obtener deep-link del bot ───────────────────────────────────
  getLinkUrl(token) {
    if (!this.username) return null;
    return `https://t.me/${this.username}?start=${token}`;
  }

  // ── Parar polling (para graceful shutdown) ──────────────────────
  stop() {
    if (this.bot) {
      this.bot.stopPolling();
      console.log('[TelegramService] Bot detenido.');
    }
  }
}

export default new TelegramService();
