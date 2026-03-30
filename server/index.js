import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config/config.js';
import { checkConnection } from './config/db.js';
import TelegramService  from './services/TelegramService.js';
import SchedulerService  from './services/SchedulerService.js';
import ScrapingService   from './services/ScrapingService.js';

// Rutas API
import statusRoutes    from './routes/status.js';
import authRoutes      from './routes/auth.js';
import promocionesRoutes from './routes/promociones.js';
import promotorasRoutes  from './routes/promotoras.js';
import noticiasRoutes  from './routes/noticias.js';
import alertasRoutes   from './routes/alertas.js';
import usuariosRoutes  from './routes/usuarios.js';
import documentosRoutes from './routes/documentos.js';
// Admin
import adminPromocionesRoutes from './routes/admin/adminPromociones.js';
import adminScrapingRoutes    from './routes/admin/adminScraping.js';
import adminUsuariosRoutes    from './routes/admin/adminUsuarios.js';
import adminTestRoutes        from './routes/admin/adminTest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// ── Middlewares globales ───────────────────────────────────────
app.use(cors());

// Helmet: cabeceras de seguridad HTTP
// CSP permisiva para desarrollo: Tailwind CDN, Mapbox, Lucide, inline handlers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:    ["'self'"],
      scriptSrc:     ["'self'", "'unsafe-inline'", "cdn.tailwindcss.com", "unpkg.com", "api.mapbox.com"],
      // unsafe-inline necesario para onclick/onsubmit en los HTML; en producción migrar a addEventListener
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:      ["'self'", "'unsafe-inline'", "cdn.tailwindcss.com", "api.mapbox.com", "fonts.googleapis.com"],
      fontSrc:       ["'self'", "fonts.gstatic.com"],
      imgSrc:        ["'self'", "data:", "blob:", "*.mapbox.com", "*.tile.openstreetmap.org"],
      connectSrc:    ["'self'", "api.mapbox.com", "events.mapbox.com", "*.mapbox.com", "unpkg.com"],
      workerSrc:     ["'self'", "blob:"],
      frameSrc:      ["'none'"]
    }
  }
}));

app.use(express.json({ type: ['application/json', 'text/plain'] }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Request Logger ─────────────────────────────────────────────
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - t0;
    const color = res.statusCode >= 500 ? '\x1b[31m'   // rojo
                : res.statusCode >= 400 ? '\x1b[33m'   // amarillo
                : res.statusCode >= 300 ? '\x1b[36m'   // cyan
                : '\x1b[32m';                            // verde
    console.log(`${color}[${new Date().toLocaleTimeString('es-ES')}] ${req.method} ${req.path} → ${res.statusCode} (${ms}ms)\x1b[0m`);
  });
  next();
});

// ── Archivos estáticos del frontend ───────────────────────────
app.use(express.static(config.PUBLIC_DIR));

// ── API Routes ─────────────────────────────────────────────────
app.use('/api',       statusRoutes);
app.use('/api/auth',  authRoutes);
app.use('/api',       promocionesRoutes);
app.use('/api',       promotorasRoutes);
app.use('/api',       noticiasRoutes);
app.use('/api',       alertasRoutes);
app.use('/api',       usuariosRoutes);
app.use('/api',       documentosRoutes);
// Admin (protegidas por requireRole('admin') internamente)
app.use('/api/admin', adminPromocionesRoutes);
app.use('/api/admin', adminScrapingRoutes);
app.use('/api/admin', adminUsuariosRoutes);
app.use('/api/admin', adminTestRoutes);

// ── Error handler global ───────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);
  if (config.NODE_ENV === 'development') console.error(err.stack);
  res.status(500).json({ success: false, error: 'Error interno del servidor' });
});

// ── SPA Fallback (rutas del frontend) ─────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(config.PUBLIC_DIR, 'index.html'));
});

// ── Handlers de proceso (estabilidad) ─────────────────────────
process.on('uncaughtException', (err) => {
  console.error('\x1b[31m[uncaughtException]\x1b[0m', err.message, err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('\x1b[31m[unhandledRejection]\x1b[0m', reason);
});

// ── Arrancar servidor ──────────────────────────────────────────
const server = app.listen(config.PORT, async () => {
  const dbOk = await checkConnection();

  console.log('');
  console.log('\x1b[35m╔══════════════════════════════════════════╗\x1b[0m');
  console.log('\x1b[35m║         MadridVPO  —  v1.0.0             ║\x1b[0m');
  console.log('\x1b[35m║   Vivienda protegida VPO/VPPL en Madrid  ║\x1b[0m');
  console.log('\x1b[35m╠══════════════════════════════════════════╣\x1b[0m');
  console.log(`\x1b[35m║  🌐 http://localhost:${config.PORT}                 ║\x1b[0m`);
  console.log(`\x1b[35m║  🗄️  PostgreSQL: ${dbOk ? '\x1b[32mConectado\x1b[35m         ' : '\x1b[31mERROR\x1b[35m             '}║\x1b[0m`);
  console.log(`\x1b[35m║  🔧 Entorno: ${config.NODE_ENV.padEnd(28)}║\x1b[0m`);
  console.log('\x1b[35m╚══════════════════════════════════════════╝\x1b[0m');
  console.log('');

  if (!dbOk) {
    console.error('\x1b[31m[AVISO] PostgreSQL no disponible. Verifica tu .env y que el servicio esté corriendo.\x1b[0m');
  }

  // ── Fase 4–5: Iniciar servicios de notificaciones y scraping ──
  if (dbOk) {
    await ScrapingService.init(); // resetea jobs stuck antes de arrancar scheduler
    TelegramService.init();
    SchedulerService.init();
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\x1b[31m[ERROR] Puerto ${config.PORT} ya está en uso. Cierra el proceso anterior.\x1b[0m`);
    process.exit(1);
  } else {
    console.error('\x1b[31m[server error]\x1b[0m', err.message);
  }
});

// ── Graceful shutdown ──────────────────────────────────────────
const shutdown = async (signal) => {
  console.log(`\n[${signal}] Apagando servidor...`);
  SchedulerService.stop();
  TelegramService.stop();
  await ScrapingService.shutdown(); // cierra Puppeteer si estaba abierto
  server.close(() => process.exit(0));
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

export default app;
