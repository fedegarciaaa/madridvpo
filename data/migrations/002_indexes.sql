-- =============================================================
-- MadridVPO — Índices de rendimiento
-- Ejecutar después de 001_initial.sql
-- =============================================================

-- Promociones: las queries más frecuentes
CREATE INDEX IF NOT EXISTS idx_promociones_publicada     ON promociones(publicada, published_at_free) WHERE publicada = true;
CREATE INDEX IF NOT EXISTS idx_promociones_zona          ON promociones(zona);
CREATE INDEX IF NOT EXISTS idx_promociones_tipo          ON promociones(tipo);
CREATE INDEX IF NOT EXISTS idx_promociones_estado        ON promociones(estado);
CREATE INDEX IF NOT EXISTS idx_promociones_precio        ON promociones(precio_desde, precio_hasta);
CREATE INDEX IF NOT EXISTS idx_promociones_promotora     ON promociones(promotora_id);
CREATE INDEX IF NOT EXISTS idx_promociones_destacada     ON promociones(destacada) WHERE destacada = true;
CREATE INDEX IF NOT EXISTS idx_promociones_coords        ON promociones(lat, lng) WHERE lat IS NOT NULL;

-- Usuarios
CREATE INDEX IF NOT EXISTS idx_usuarios_email            ON usuarios(email);
CREATE INDEX IF NOT EXISTS idx_usuarios_rol              ON usuarios(rol);
CREATE INDEX IF NOT EXISTS idx_usuarios_telegram         ON usuarios(telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;

-- Refresh tokens
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash       ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_usuario    ON refresh_tokens(usuario_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires    ON refresh_tokens(expires_at);

-- Alertas
CREATE INDEX IF NOT EXISTS idx_alertas_usuario           ON alertas(usuario_id, activa);

-- Notificaciones (deduplicación)
CREATE INDEX IF NOT EXISTS idx_notif_alerta_promo        ON notificaciones_enviadas(alerta_id, promocion_id);

-- Scraping
CREATE INDEX IF NOT EXISTS idx_scraping_jobs_promotora   ON scraping_jobs(promotora_id, activo);
CREATE INDEX IF NOT EXISTS idx_scraping_jobs_proximo     ON scraping_jobs(proximo_check) WHERE activo = true;
CREATE INDEX IF NOT EXISTS idx_scraping_queue_estado     ON scraping_queue(estado, created_at);

-- Form submissions
CREATE INDEX IF NOT EXISTS idx_form_sub_promocion        ON form_submissions(promocion_id, estado);

-- Noticias
CREATE INDEX IF NOT EXISTS idx_noticias_fuente           ON noticias(fuente, fecha_publicacion);
CREATE INDEX IF NOT EXISTS idx_noticias_publicada        ON noticias(publicada, relevancia_score DESC);
CREATE INDEX IF NOT EXISTS idx_noticias_url              ON noticias(url_original);

-- Comentarios
CREATE INDEX IF NOT EXISTS idx_comentarios_promocion     ON comentarios(promocion_id, aprobado);

-- Actividad (Radar)
CREATE INDEX IF NOT EXISTS idx_actividad_publica         ON actividad(publica, created_at DESC);

-- Búsquedas (analytics)
CREATE INDEX IF NOT EXISTS idx_busquedas_zona            ON busquedas(zona, created_at);

-- Precio histórico
CREATE INDEX IF NOT EXISTS idx_precio_hist_promocion     ON precio_historico(promocion_id, detectado_en DESC);

-- Fotos de obra
CREATE INDEX IF NOT EXISTS idx_fotos_promocion           ON fotos_obra(promocion_id, fecha_foto DESC);
