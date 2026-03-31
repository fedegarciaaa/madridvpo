# Guía de colaboración — MadridVPO

## Quién trabaja qué

### Tú (frontend + app)
| Directorio / Archivo | Descripción |
|---|---|
| `public/` | Todo el frontend: HTML, CSS, JS del cliente |
| `server/routes/` | Rutas de la API (auth, promociones, alertas, usuarios, docs) |
| `server/services/AuthService.js` | Lógica de registro, login, JWT |
| `server/services/AlertService.js` | Motor de alertas y notificaciones por email |
| `server/services/EmailService.js` | Plantillas y envío de emails |
| `server/services/PromocionService.js` | Listado, detalle y filtros de promociones |

### Tu amigo (scraping + automatización)
| Directorio / Archivo | Descripción |
|---|---|
| `server/services/scrapers/` | Todos los scrapers individuales |
| `server/services/ScrapingService.js` | Orquestador de scraping y cola de revisión |
| `server/services/SchedulerService.js` | Jobs cron (scraping, alertas, limpieza) |
| `server/services/TelegramService.js` | Bot de Telegram |

### Zona compartida — coordinar antes de tocar
| Archivo | Por qué coordinar |
|---|---|
| `server/index.js` | Registro de rutas y arranque de servicios |
| `data/migrations/` | Cambios de schema de BD |
| `package.json` | Dependencias npm |

---

## Git workflow

```
main  ←  rama principal, siempre funcional
  ├── feature/frontend-[descripcion]     ← tú
  └── feature/scraping-[descripcion]     ← amigo
```

### Reglas
1. **Nunca push directo a `main`** — trabajar siempre en branches
2. Nombrar branches: `feature/[quién]-[qué]` (ej: `feature/frontend-mapa-filtros`)
3. Antes de empezar: `git pull origin main`
4. Cuando esté listo: PR o merge a `main`
5. Avisar al otro si vas a tocar la **zona compartida**

---

## Base de datos compartida (Supabase)

Ambos conectáis al mismo Supabase. Cada uno tiene su propio `.env` local (no subir a git).

Añadir al `.env` local:
```env
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
```

El connection string está en: **Supabase Dashboard → Settings → Database → Connection string → URI**

---

## Cambios de schema (migraciones)

Cuando necesites cambiar la BD:
1. Crear un nuevo archivo en `data/migrations/` (ej: `004_nueva_tabla.sql`)
2. Avisarle al otro **antes** de aplicarlo
3. Aplicar en Supabase: Dashboard → SQL Editor → pegar y ejecutar
4. Commit del archivo `.sql` junto con el código que lo usa
