-- =============================================================
-- MadridVPO — Seed: Promotoras iniciales
-- Basado en el estudio de mercado VPO/VPPL Madrid
-- =============================================================

INSERT INTO promotoras (nombre, web, descripcion, activa, scraping_activo, scraping_interval_horas, form_url, form_tipo) VALUES

('Grupo Ibosa',
 'https://www.grupoibosa.com',
 'Especialista en cooperativas de VPO/VPPL. Proyectos activos en Los Berrocales y Valdecarros. Uno de los promotores más activos de vivienda protegida en el sureste de Madrid.',
 true, true, 12,
 'https://www.grupoibosa.com/contacto',
 'puppeteer'),

('SERPROCOL / Libra Gestora',
 'https://www.serprocolinmobiliaria.com',
 'Gestión de cooperativas VPO/VPPL. Proyectos en Los Berrocales (El Brezal), Ahijones y Valdecarros. Expertos en gestión cooperativa con foco en calidad e innovación.',
 true, true, 24,
 'https://www.serprocolinmobiliaria.com/contacto',
 'html'),

('Aurora Homes',
 'https://aurora-homes.es',
 'Enfocada en cooperativas de vivienda protegida. Ha entregado Residencial Arcadia (69 VPPL en Berrocales). Actualmente comercializa Residencial Ítaca (45 viviendas, Berrocales).',
 true, true, 24,
 'https://aurora-homes.es',
 'html'),

('Prygesa',
 'https://www.prygesa.es',
 'Actúa mediante cooperativas. Desarrolla Los Ahijones Plaza (83 pisos VPPL, 2-3 dorm.). Aporta experiencia en promociones públicas mediante cooperativas.',
 true, true, 24,
 'https://www.prygesa.es/contacto',
 'html'),

('Grupo Impulsa',
 'https://www.impulsaproyectos.com',
 'Lidera cooperativas locales. Gestiona Cooperativa Valdecarros (VPPL plurifamiliar) y comercializa Cerasus-Ahijones (64 VPPB). Orientado a apoyo institucional y sostenibilidad.',
 true, true, 24,
 'https://www.impulsaproyectos.com/contacto',
 'html'),

('Asentis (Grupo ISO)',
 'https://www.asentis.com',
 'Comercializa promociones protegidas en cooperativa. Ahijones Horizon II (50 viviendas VPPL, 2-3 dorm., con garaje y trastero incluidos). Facilita acceso a precios limitados.',
 true, true, 24,
 'https://www.asentis.com',
 'puppeteer'),

('Hercesa',
 'https://hercesa.com',
 'Promotora con proyectos en Los Berrocales. Referencia en obra nueva de calidad en los nuevos desarrollos del sureste de Madrid.',
 true, true, 24,
 'https://hercesa.com/contacto',
 'html'),

('EMVS Madrid',
 'https://www.emvs.es',
 'Empresa Municipal de la Vivienda y Suelo de Madrid. Gestiona el acceso a vivienda pública del Ayuntamiento. Fuente oficial de convocatorias VPO y sorteos en Madrid capital.',
 true, true, 6,
 'https://www.emvs.es/Paginas/inicio.aspx',
 'html');

-- Jobs de scraping iniciales (uno por promotora)
-- Ibosa: solo el listado general (incluye Berrocales y Valdecarros)
-- EMVS: sin job (no hay scraper activo para EMVS)
INSERT INTO scraping_jobs (promotora_id, url, descripcion, activo) VALUES
(1, 'https://www.grupoibosa.com/nuestras-promociones/', 'Listado de promociones activas de Ibosa', true),
(2, 'https://www.serprocolinmobiliaria.com/', 'Serprocol — Página principal', true),
(3, 'https://aurora-homes.es/promociones/', 'Aurora Homes — Promociones', true),
(4, 'https://www.prygesa.es/obra-nueva/madrid/vicalvaro/los-ahijones', 'Prygesa — Ahijones', true),
(5, 'https://www.impulsaproyectos.com/proyectos/', 'Grupo Impulsa — Proyectos', true),
(6, 'https://www.asentis.com', 'Asentis — Web principal', true),
(7, 'https://hercesa.com/promocion/berrocales/', 'Hercesa — Berrocales', true);

-- Seed: Admin por defecto (password: Admin1234! — CAMBIAR INMEDIATAMENTE)
-- bcrypt hash de 'Admin1234!' con rounds=12
-- En producción: crear admin desde el endpoint /api/auth/register con rol admin
INSERT INTO usuarios (email, nombre, password_hash, rol, plan, activo, email_verificado) VALUES
('admin@madridvpo.com', 'Administrador', '$2b$12$Fp9VljA3GII7mR7Hu/dxHeXqtey/z3V1BtAsiMlDSlGI93Uuti7pW', 'admin', 'premium', true, true)
ON CONFLICT (email) DO NOTHING;
