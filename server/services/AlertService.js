import { query, queryOne, run } from '../config/db.js';
import EmailService from './EmailService.js';
import TelegramService from './TelegramService.js';
import config from '../config/config.js';

// ────────────────────────────────────────────────────────────────────
// AlertService — Motor de matching alertas ↔ promociones nuevas
//
// Flujo principal (llamado cada hora por SchedulerService):
//   1. Busca promociones publicadas en las últimas ~2h
//   2. Para cada alerta activa: filtra las que coinciden con sus criterios
//   3. Verifica que no se hayan enviado ya (tabla notificaciones_enviadas)
//   4. Envía por email y/o Telegram según preferencias del usuario
//   5. Registra el envío para evitar duplicados
// ────────────────────────────────────────────────────────────────────

class AlertService {

  // ── Punto de entrada del cron ───────────────────────────────────
  async checkAlertas() {
    const ahora = new Date().toLocaleTimeString('es-ES');
    console.log(`[AlertService] [${ahora}] Iniciando comprobación de alertas...`);

    try {
      // Ventana de 2h para compensar posibles retrasos en el scheduler
      const VENTANA_MINUTOS = 130;

      const nuevasPromociones = await query(
        `SELECT p.*,
                pr.nombre AS promotora_nombre
         FROM   promociones p
         LEFT JOIN promotoras pr ON pr.id = p.promotora_id
         WHERE  p.publicada = true
           AND  p.published_at > NOW() - INTERVAL '${VENTANA_MINUTOS} minutes'
         ORDER  BY p.published_at DESC`
      );

      if (!nuevasPromociones.length) {
        console.log('[AlertService] Sin promociones nuevas en el período.');
        return { checked: 0, notificaciones: 0 };
      }

      console.log(`[AlertService] ${nuevasPromociones.length} promociones nuevas.`);

      // Cargar todas las alertas activas con datos de usuario
      const alertas = await query(
        `SELECT a.*,
                u.email,
                u.nombre    AS usuario_nombre,
                u.plan,
                u.telegram_chat_id
         FROM   alertas a
         JOIN   usuarios u ON u.id = a.usuario_id
         WHERE  a.activa   = true
           AND  u.activo   = true`
      );

      if (!alertas.length) {
        console.log('[AlertService] Sin alertas activas.');
        return { checked: 0, notificaciones: 0 };
      }

      let totalNotif = 0;

      for (const alerta of alertas) {
        const notifEnviadas = await this._procesarAlerta(alerta, nuevasPromociones);
        totalNotif += notifEnviadas;
      }

      console.log(`[AlertService] Completado: ${totalNotif} notificaciones enviadas.`);
      return { checked: alertas.length, notificaciones: totalNotif };

    } catch (e) {
      console.error('[AlertService] Error en checkAlertas:', e.message);
      throw e;
    }
  }

  // ── Procesar una alerta contra el lote de promociones ───────────
  async _procesarAlerta(alerta, promociones) {
    // 1. Filtrar promociones que coinciden con los criterios de la alerta
    let candidatas = promociones.filter(p => this._matchesAlerta(p, alerta));

    if (!candidatas.length) return 0;

    // 2. Aplicar retraso freemium: usuarios free solo ven promoted_at_free
    if (alerta.plan !== 'premium') {
      const ahora = new Date();
      candidatas = candidatas.filter(p =>
        p.published_at_free && new Date(p.published_at_free) <= ahora
      );
    }

    if (!candidatas.length) return 0;

    // 3. Para cada candidata y canal, verificar si ya fue notificada
    const canales = [];
    if (alerta.notif_email)    canales.push('email');
    if (alerta.notif_telegram && alerta.telegram_chat_id) canales.push('telegram');

    if (!canales.length) return 0;

    // Construir mapa: canal → [promociones sin notificar]
    const pendientes = { email: [], telegram: [] };

    for (const promo of candidatas) {
      for (const canal of canales) {
        const yaEnviado = await queryOne(
          `SELECT 1 FROM notificaciones_enviadas
           WHERE alerta_id = $1 AND promocion_id = $2 AND canal = $3`,
          [alerta.id, promo.id, canal]
        );
        if (!yaEnviado) pendientes[canal].push(promo);
      }
    }

    let enviados = 0;

    // 4a. Enviar email
    if (pendientes.email.length) {
      const result = await EmailService.sendAlertEmail(
        { email: alerta.email, nombre: alerta.usuario_nombre },
        alerta,
        pendientes.email
      );
      if (result.ok) {
        for (const promo of pendientes.email) {
          await this._registrarNotif(alerta.id, promo.id, 'email');
        }
        enviados++;
      }
    }

    // 4b. Enviar Telegram
    if (pendientes.telegram.length && alerta.telegram_chat_id) {
      const result = await TelegramService.sendAlertMessage(
        alerta.telegram_chat_id,
        alerta,
        pendientes.telegram
      );
      if (result.ok) {
        for (const promo of pendientes.telegram) {
          await this._registrarNotif(alerta.id, promo.id, 'telegram');
        }
        enviados++;
      }
    }

    // 5. Actualizar ultima_notif si enviamos algo
    if (enviados > 0) {
      await run('UPDATE alertas SET ultima_notif = NOW() WHERE id = $1', [alerta.id]);
    }

    return enviados;
  }

  // ── Lógica de matching ──────────────────────────────────────────
  // Devuelve true si la promoción cumple TODOS los filtros de la alerta
  _matchesAlerta(promo, alerta) {
    // Zona (array vacío = cualquier zona)
    if (alerta.zonas?.length) {
      if (!promo.zona || !alerta.zonas.includes(promo.zona)) return false;
    }

    // Tipo (VPO, VPPL, cooperativa, libre)
    if (alerta.tipos?.length) {
      if (!promo.tipo || !alerta.tipos.includes(promo.tipo)) return false;
    }

    // Precio máximo: precio_desde de la promo debe ser ≤ precio_max de la alerta
    if (alerta.precio_max) {
      if (promo.precio_desde && promo.precio_desde > alerta.precio_max) return false;
    }

    // Dormitorios: al menos uno de los dormitorios deseados entra en el rango de la promo
    if (alerta.dormitorios?.length) {
      const min = promo.dormitorios_min ?? 0;
      const max = promo.dormitorios_max ?? 99;
      const tieneMatch = alerta.dormitorios.some(d => d >= min && d <= max);
      if (!tieneMatch) return false;
    }

    // Estado (lista_espera, sorteo, etc.) — si vacío, cualquier estado
    if (alerta.estados?.length) {
      if (!promo.estado || !alerta.estados.includes(promo.estado)) return false;
    }

    return true;
  }

  // ── Registrar notificación enviada (evita duplicados) ───────────
  async _registrarNotif(alertaId, promocionId, canal) {
    try {
      await run(
        `INSERT INTO notificaciones_enviadas (alerta_id, promocion_id, canal)
         VALUES ($1, $2, $3)
         ON CONFLICT (alerta_id, promocion_id, canal) DO NOTHING`,
        [alertaId, promocionId, canal]
      );
    } catch (e) {
      console.error('[AlertService] Error registrando notificación:', e.message);
    }
  }

  // ── Limpieza de registros antiguos (llamada desde scheduler) ────
  async cleanOldNotifications(diasRetener = 90) {
    try {
      const result = await run(
        `DELETE FROM notificaciones_enviadas
         WHERE enviado_at < NOW() - ($1 || ' days')::INTERVAL`,
        [diasRetener]
      );
      return result.rowCount ?? 0;
    } catch (e) {
      console.error('[AlertService] Error en cleanOldNotifications:', e.message);
      return 0;
    }
  }

  // ── Test manual: forzar check ahora (útil desde admin) ──────────
  async triggerCheck() {
    return this.checkAlertas();
  }
}

export default new AlertService();
