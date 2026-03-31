-- ── 003_google_auth.sql ───────────────────────────────────────
-- Google OAuth + campos de perfil extendido

-- Columnas para Google OAuth
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS google_id    VARCHAR(255);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS avatar_url   TEXT;

-- true = perfil completo; false = usuario nuevo de Google que debe rellenar datos
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS perfil_completo BOOLEAN NOT NULL DEFAULT TRUE;

-- Campos de perfil extendido (usados en registro Google y perfil)
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS apellidos        VARCHAR(100);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telefono         VARCHAR(30);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS direccion_perfil VARCHAR(255);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ciudad           VARCHAR(100);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS provincia        VARCHAR(100);

-- Índice único parcial: solo para usuarios con google_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_google_id
  ON usuarios(google_id)
  WHERE google_id IS NOT NULL;

-- Los usuarios existentes (con contraseña) ya tienen el perfil completo
UPDATE usuarios SET perfil_completo = TRUE WHERE password_hash IS NOT NULL;
