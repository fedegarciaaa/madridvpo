import cron from 'node-cron';
import AlertService    from './AlertService.js';
import AuthService     from './AuthService.js';
import ScrapingService from './ScrapingService.js';

// ────────────────────────────────────────────────────────────────────
// SchedulerService — Jobs periódicos con node-cron
//
// Jobs:
//   • Cada hora en punto        → checkAlertas (matching alertas ↔ nuevas VPO)
//   • Cada 6 horas (2,8,14,20h) → scraping de todas las promotoras
//   • Diariamente a las 03:00   → limpiar refresh tokens expirados
//   • Diariamente a las 04:00   → limpiar notificaciones antiguas (>90 días)
// ────────────────────────────────────────────────────────────────────

class SchedulerService {
  constructor() {
    this.jobs = [];
  }

  init() {
    if (!cron.validate('0 * * * *')) {
      console.error('[Scheduler] node-cron no disponible.');
      return;
    }

    // ── Job 1: Check alertas cada hora ─────────────────────────
    this.jobs.push(
      cron.schedule('0 * * * *', async () => {
        console.log('[Scheduler] → checkAlertas');
        try {
          const { checked, notificaciones } = await AlertService.checkAlertas();
          console.log(`[Scheduler] checkAlertas OK — alertas: ${checked}, notif: ${notificaciones}`);
        } catch (e) {
          console.error('[Scheduler] Error en checkAlertas:', e.message);
        }
      }, { timezone: 'Europe/Madrid' })
    );

    // ── Job 2: Limpiar tokens expirados a las 03:00 ─────────────
    this.jobs.push(
      cron.schedule('0 3 * * *', async () => {
        console.log('[Scheduler] → cleanExpiredTokens');
        try {
          const deleted = await AuthService.cleanExpiredTokens();
          console.log(`[Scheduler] Tokens eliminados: ${deleted}`);
        } catch (e) {
          console.error('[Scheduler] Error en cleanExpiredTokens:', e.message);
        }
      }, { timezone: 'Europe/Madrid' })
    );

    // ── Job 3: Limpiar notificaciones antiguas a las 04:00 ──────
    this.jobs.push(
      cron.schedule('0 4 * * *', async () => {
        console.log('[Scheduler] → cleanOldNotifications');
        try {
          const deleted = await AlertService.cleanOldNotifications(90);
          console.log(`[Scheduler] Notificaciones antiguas eliminadas: ${deleted}`);
        } catch (e) {
          console.error('[Scheduler] Error en cleanOldNotifications:', e.message);
        }
      }, { timezone: 'Europe/Madrid' })
    );

    // ── Job 4: Scraping cada 6 horas ───────────────────────────
    this.jobs.push(
      cron.schedule('0 2,8,14,20 * * *', async () => {
        console.log('[Scheduler] → ScrapingService.runAll');
        try {
          const { ok, jobs, cambios, error } = await ScrapingService.runAll();
          if (ok) console.log(`[Scheduler] Scraping OK — jobs: ${jobs}, cambios: ${cambios}`);
          else    console.warn(`[Scheduler] Scraping abortado: ${error}`);
        } catch (e) {
          console.error('[Scheduler] Error en scraping:', e.message);
        }
      }, { timezone: 'Europe/Madrid' })
    );

    console.log(`[Scheduler] ${this.jobs.length} jobs activos (zona: Europe/Madrid).`);

    // Ejecutar checkAlertas una vez al arrancar (pasados 30s para que la BD esté lista)
    setTimeout(async () => {
      console.log('[Scheduler] Ejecución inicial de checkAlertas...');
      try {
        await AlertService.checkAlertas();
      } catch (e) {
        console.error('[Scheduler] Error en ejecución inicial:', e.message);
      }
    }, 30_000);
  }

  // ── Parar todos los jobs (para graceful shutdown) ───────────────
  stop() {
    this.jobs.forEach(job => job.stop());
    this.jobs = [];
    console.log('[Scheduler] Jobs detenidos.');
  }
}

export default new SchedulerService();
