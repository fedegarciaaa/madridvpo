-- =============================================================
-- MadridVPO — Migración inicial
-- Ejecutar: psql -U postgres -d madridvpo -f 001_initial.sql
-- =============================================================

-- ---------------------------------------------------------------
-- 1. PROMOTORAS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS promotoras (
  id                      SERIAL PRIMARY KEY,
  nombre                  VARCHAR(200) NOT NULL,
  web                     VARCHAR(500),
  logo_url                VARCHAR(500),
  descripcion             TEXT,
  activa                  BOOLEAN DEFAULT true,
  -- Scraping
  scraping_activo         BOOLEAN DEFAULT false,
  scraping_interval_horas INT DEFAULT 24,
  -- Configuración de formularios de interés
  form_url                VARCHAR(500),          -- URL del formulario de interés
  form_tipo               VARCHAR(50),           -- 'html', 'puppeteer', 'sharepoint'
  form_credenciales       JSONB,                 -- credenciales cifradas si requiere login
  -- Metadatos
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- 2. PROMOCIONES
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS promociones (
  id                SERIAL PRIMARY KEY,
  promotora_id      INT REFERENCES promotoras(id) ON DELETE SET NULL,
  nombre            VARCHAR(300) NOT NULL,
  slug              VARCHAR(350) UNIQUE,           -- para URLs amigables
  -- Tipo y clasificación
  tipo              VARCHAR(50) DEFAULT 'VPPL',    -- 'VPO', 'VPPL', 'cooperativa', 'libre'
  zona              VARCHAR(200),                  -- 'Berrocales', 'Valdecarros', 'Ahijones', etc.
  -- Ubicación
  direccion         TEXT,
  lat               DECIMAL(10,7),
  lng               DECIMAL(10,7),
  -- Precio
  precio_desde      INT,                           -- en euros
  precio_hasta      INT,
  precio_m2         INT,                           -- precio por m²
  -- Superficie
  m2_desde          INT,
  m2_hasta          INT,
  -- Dormitorios
  dormitorios_min   INT,
  dormitorios_max   INT,
  -- Características adicionales
  garaje_incluido   BOOLEAN,
  trastero_incluido BOOLEAN,
  ascensor          BOOLEAN,
  calificacion_energetica VARCHAR(5),             -- A, B, C, D...
  planta_min        INT,
  planta_max        INT,
  -- Estado de la promoción
  estado            VARCHAR(50) DEFAULT 'en_proyecto',
  -- Estados posibles:
  --   en_proyecto     → aprobada/planificada, sin obra iniciada
  --   en_construccion → obra en marcha
  --   lista_espera    → se puede apuntar a lista de espera
  --   sorteo          → próximo sorteo o sorteo en proceso
  --   adjudicada      → pisos adjudicados, posible lista de espera
  --   entregada       → llaves entregadas
  fecha_inicio_obra   DATE,
  fecha_entrega_est   DATE,                       -- estimada
  fecha_entrega_real  DATE,
  -- Contenido
  descripcion         TEXT,
  descripcion_corta   VARCHAR(500),
  imagen_principal    VARCHAR(500),
  imagenes            TEXT[],                      -- array de URLs
  -- Referencias
  web_oficial         VARCHAR(500),
  fuente_scraping     VARCHAR(500),               -- URL de donde se scrapeó
  -- Publicación y visibilidad
  publicada           BOOLEAN DEFAULT false,
  published_at        TIMESTAMPTZ,               -- cuándo se publicó (premium ve desde aquí)
  published_at_free   TIMESTAMPTZ,               -- published_at + FREE_TIER_DELAY (free ve desde aquí)
  destacada           BOOLEAN DEFAULT false,      -- para mostrar en landing
  -- Extras almacenados como JSON flexible
  metadatos           JSONB DEFAULT '{}',
  -- Timestamps
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- 3. HISTORIAL DE PRECIOS (para gráfico de evolución)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS precio_historico (
  id            SERIAL PRIMARY KEY,
  promocion_id  INT NOT NULL REFERENCES promociones(id) ON DELETE CASCADE,
  precio_desde  INT,
  precio_hasta  INT,
  precio_m2     INT,
  detectado_en  TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- 4. DOCUMENTOS (planos, memorias de calidades, dossiers)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documentos (
  id            SERIAL PRIMARY KEY,
  promocion_id  INT NOT NULL REFERENCES promociones(id) ON DELETE CASCADE,
  nombre        VARCHAR(300) NOT NULL,
  tipo          VARCHAR(50) DEFAULT 'otro',  -- 'plano', 'memoria', 'dossier', 'otro'
  fichero_path  VARCHAR(500),               -- ruta local en /uploads
  url_externa   VARCHAR(500),               -- o URL pública
  solo_premium  BOOLEAN DEFAULT true,
  tamano_bytes  INT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- 5. SEGUIMIENTO DE OBRA (fotos periódicas de progreso)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fotos_obra (
  id            SERIAL PRIMARY KEY,
  promocion_id  INT NOT NULL REFERENCES promociones(id) ON DELETE CASCADE,
  foto_path     VARCHAR(500) NOT NULL,
  descripcion   VARCHAR(500),
  fecha_foto    DATE DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- 6. USUARIOS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id                SERIAL PRIMARY KEY,
  email             VARCHAR(300) UNIQUE NOT NULL,
  nombre            VARCHAR(200),
  password_hash     VARCHAR(200),
  rol               VARCHAR(50) DEFAULT 'free',  -- 'free', 'premium', 'admin'
  plan              VARCHAR(50) DEFAULT 'free',  -- 'free', 'premium'
  plan_expira_en    TIMESTAMPTZ,                 -- NULL = sin expiración
  -- Telegram
  telegram_chat_id  VARCHAR(100),
  telegram_username VARCHAR(100),
  -- Preferencias de búsqueda (JSON flexible)
  preferencias      JSONB DEFAULT '{}',
  -- Expediente privado del usuario (su situación personal)
  expediente        JSONB DEFAULT '{}',
  -- Estado
  activo            BOOLEAN DEFAULT true,
  email_verificado  BOOLEAN DEFAULT false,
  -- Timestamps
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  last_login        TIMESTAMPTZ
);

-- ---------------------------------------------------------------
-- 7. REFRESH TOKENS (para rotación segura de JWT)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          SERIAL PRIMARY KEY,
  usuario_id  INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash  VARCHAR(200) UNIQUE NOT NULL,  -- hash SHA-256 del token
  expires_at  TIMESTAMPTZ NOT NULL,
  user_agent  VARCHAR(500),                  -- para auditoría
  ip          VARCHAR(50),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- 8. ALERTAS (configuración de notificaciones por usuario)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alertas (
  id              SERIAL PRIMARY KEY,
  usuario_id      INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre          VARCHAR(200) DEFAULT 'Mi alerta',
  -- Filtros de la alerta
  zonas           TEXT[],          -- ['Berrocales', 'Valdecarros']
  tipos           TEXT[],          -- ['VPO', 'VPPL', 'cooperativa']
  precio_max      INT,             -- precio máximo en euros
  dormitorios     INT[],           -- [2, 3]
  estados         TEXT[],          -- ['lista_espera', 'sorteo'] — alertar solo para estos estados
  -- Canales de notificación
  notif_email     BOOLEAN DEFAULT true,
  notif_telegram  BOOLEAN DEFAULT false,
  -- Estado
  activa          BOOLEAN DEFAULT true,
  ultima_notif    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- 9. HISTORIAL DE NOTIFICACIONES ENVIADAS (deduplicación)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notificaciones_enviadas (
  id            SERIAL PRIMARY KEY,
  alerta_id     INT NOT NULL REFERENCES alertas(id) ON DELETE CASCADE,
  promocion_id  INT NOT NULL REFERENCES promociones(id) ON DELETE CASCADE,
  canal         VARCHAR(50) NOT NULL,  -- 'email', 'telegram'
  enviado_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(alerta_id, promocion_id, canal)  -- evita duplicados
);

-- ---------------------------------------------------------------
-- 10. JOBS DE SCRAPING (configuración por URL)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scraping_jobs (
  id                  SERIAL PRIMARY KEY,
  promotora_id        INT REFERENCES promotoras(id) ON DELETE CASCADE,
  url                 VARCHAR(500) NOT NULL,
  descripcion         VARCHAR(300),               -- qué se espera encontrar en esta URL
  ultimo_check        TIMESTAMPTZ,
  proximo_check       TIMESTAMPTZ,
  estado              VARCHAR(50) DEFAULT 'pending',
  -- Estados: 'pending', 'running', 'ok', 'error', 'pausado'
  ultimo_hash         VARCHAR(64),                -- MD5 del último contenido extraído
  consecutivos_error  INT DEFAULT 0,
  ultimo_error        TEXT,                       -- mensaje del último error
  activo              BOOLEAN DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- 11. COLA DE REVISIÓN DE SCRAPING (pendiente de aprobación admin)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scraping_queue (
  id                SERIAL PRIMARY KEY,
  scraping_job_id   INT REFERENCES scraping_jobs(id) ON DELETE SET NULL,
  promocion_id      INT REFERENCES promociones(id) ON DELETE SET NULL,  -- NULL si es nueva
  tipo_cambio       VARCHAR(100),
  -- Tipos: 'nueva_promocion', 'cambio_precio', 'nueva_lista_espera',
  --        'cambio_estado', 'nueva_fecha_entrega', 'nuevo_documento'
  datos_scrapeados  JSONB NOT NULL,  -- datos tal como llegaron del scraper
  datos_actuales    JSONB,           -- datos actuales en BD (para diff)
  -- Revisión del admin
  estado            VARCHAR(50) DEFAULT 'pending',  -- 'pending', 'aprobado', 'rechazado'
  revisado_por      INT REFERENCES usuarios(id) ON DELETE SET NULL,
  revisado_at       TIMESTAMPTZ,
  notas_admin       TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- 12. AUTOMATIZACIÓN DE FORMULARIOS DE INTERÉS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS form_submissions (
  id                    SERIAL PRIMARY KEY,
  promocion_id          INT REFERENCES promociones(id) ON DELETE SET NULL,
  promotora_id          INT REFERENCES promotoras(id) ON DELETE SET NULL,
  nivel_usado           INT,       -- 1=cheerio, 2=puppeteer, 3=captcha, 4=sharepoint
  estado                VARCHAR(50) DEFAULT 'pendiente',
  -- Estados: 'pendiente', 'enviado', 'email_recibido', 'dossier_subido', 'error'
  datos_enviados        JSONB,     -- campos que se rellenaron
  respuesta_url         VARCHAR(500),
  respuesta_email_raw   TEXT,      -- contenido del email de respuesta
  documentos_obtenidos  TEXT[],    -- paths a documentos descargados
  intentos              INT DEFAULT 0,
  ultimo_intento        TIMESTAMPTZ,
  proximo_intento       TIMESTAMPTZ,
  error_msg             TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- 13. NOTICIAS (scraping de medios, RSS, BOE/BOCM)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS noticias (
  id                  SERIAL PRIMARY KEY,
  titulo              VARCHAR(500) NOT NULL,
  resumen             TEXT,
  contenido           TEXT,
  url_original        VARCHAR(1000) UNIQUE NOT NULL,
  fuente              VARCHAR(200),    -- 'idealista', 'bocm', 'boe', 'elconfidencial', etc.
  imagen_url          VARCHAR(500),
  fecha_publicacion   TIMESTAMPTZ,
  relevancia_score    INT DEFAULT 0,   -- calculado por keywords
  zonas_relacionadas  TEXT[],          -- zonas que menciona
  publicada           BOOLEAN DEFAULT false,
  destacada           BOOLEAN DEFAULT false,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- 14. COMENTARIOS / FORO POR PROMOCIÓN
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comentarios (
  id            SERIAL PRIMARY KEY,
  promocion_id  INT NOT NULL REFERENCES promociones(id) ON DELETE CASCADE,
  usuario_id    INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  contenido     TEXT NOT NULL,
  aprobado      BOOLEAN DEFAULT false,   -- moderación por admin
  parent_id     INT REFERENCES comentarios(id) ON DELETE CASCADE,  -- para hilos
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- 15. RADAR DE ACTIVIDAD (eventos públicos para la landing)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS actividad (
  id            SERIAL PRIMARY KEY,
  tipo          VARCHAR(100) NOT NULL,
  -- Tipos: 'nueva_promocion', 'cambio_precio', 'nueva_lista_espera', 'noticia_bocm',
  --        'scraping_detectado', 'dossier_obtenido', 'nuevo_comentario'
  titulo        VARCHAR(500) NOT NULL,
  descripcion   VARCHAR(1000),
  promocion_id  INT REFERENCES promociones(id) ON DELETE SET NULL,
  noticia_id    INT REFERENCES noticias(id) ON DELETE SET NULL,
  icono         VARCHAR(50),   -- nombre del icono Lucide
  color         VARCHAR(50),   -- clase de color Tailwind
  publica       BOOLEAN DEFAULT true,   -- si aparece en el Radar público
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- 16. ESTADÍSTICAS DE BÚSQUEDA (para mapa de calor y analytics admin)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS busquedas (
  id            SERIAL PRIMARY KEY,
  zona          VARCHAR(200),
  tipo          VARCHAR(50),
  precio_max    INT,
  dormitorios   INT,
  usuario_id    INT REFERENCES usuarios(id) ON DELETE SET NULL,
  ip_hash       VARCHAR(64),   -- hash de IP (privacidad)
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- 17. NEWSLETTER (historial de envíos)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS newsletter_envios (
  id              SERIAL PRIMARY KEY,
  asunto          VARCHAR(500),
  tipo            VARCHAR(50) DEFAULT 'semanal',  -- 'semanal', 'especial'
  destinatarios   INT,                            -- número de emails enviados
  aperturas       INT DEFAULT 0,
  clicks          INT DEFAULT 0,
  enviado_at      TIMESTAMPTZ DEFAULT NOW()
);
