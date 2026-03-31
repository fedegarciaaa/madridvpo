import { config as dotenvConfig } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __file = fileURLToPath(import.meta.url);
// Cargar .env desde la raíz del proyecto (dos niveles arriba de server/config/)
dotenvConfig({ path: path.resolve(path.dirname(__file), '../../.env') });

const __dirname = path.dirname(__file);

export default {
  PORT: parseInt(process.env.PORT) || 3004,
  NODE_ENV: process.env.NODE_ENV || 'development',

  // Base de datos PostgreSQL
  // Si se define DATABASE_URL (Supabase, Railway, etc.) se usa directamente;
  // si no, se construye a partir de las variables individuales (local).
  DB: process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000
      }
    : {
        host:     process.env.DB_HOST     || 'localhost',
        port:     parseInt(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME     || 'madridvpo',
        user:     process.env.DB_USER     || 'postgres',
        password: process.env.DB_PASSWORD || '',
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000
      },

  // JWT
  JWT_SECRET:               process.env.JWT_SECRET || 'dev_secret_inseguro',
  JWT_EXPIRES_IN:           process.env.JWT_EXPIRES_IN || '15m',
  REFRESH_TOKEN_EXPIRES_IN: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
  REFRESH_TOKEN_DAYS: 7,

  // Mapbox
  MAPBOX_TOKEN: process.env.MAPBOX_TOKEN || '',

  // Email SMTP
  EMAIL: {
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT) || 587,
    user: process.env.EMAIL_USER || '',
    pass: process.env.EMAIL_PASS || '',
    from: process.env.EMAIL_FROM || 'MadridVPO <noreply@madridvpo.com>'
  },

  // IMAP (lectura de respuestas de promotoras)
  IMAP: {
    host: process.env.EMAIL_IMAP_HOST || 'imap.gmail.com',
    port: parseInt(process.env.EMAIL_IMAP_PORT) || 993,
    user: process.env.EMAIL_USER || '',
    pass: process.env.EMAIL_PASS || ''
  },

  // Telegram Bot
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',

  // Freemium
  FREE_TIER_DELAY_HOURS: parseInt(process.env.FREE_TIER_DELAY_HOURS) || 24,

  // Scraping
  SCRAPING: {
    delayMin: parseInt(process.env.SCRAPING_DELAY_MIN) || 5000,
    delayMax: parseInt(process.env.SCRAPING_DELAY_MAX) || 15000,
    captchaApiKey: process.env.CAPTCHA_API_KEY || '',
    maxConsecutiveErrors: 3,   // alertar al admin tras N errores seguidos
    puppeteerPoolSize: 2       // máx instancias Chromium simultáneas
  },

  // Admin
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || '',

  // Google OAuth
  GOOGLE: {
    client_id:     process.env.GOOGLE_CLIENT_ID     || '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
  },
  BASE_URL: process.env.BASE_URL || 'http://localhost:3004',

  // Rutas
  UPLOADS_DIR: path.join(__dirname, '../../uploads'),
  GEOJSON_DIR: path.join(__dirname, '../../data/geojson'),
  PUBLIC_DIR:  path.join(__dirname, '../../public')
};
