import { query, queryOne, run, transaction } from '../config/db.js';
import config from '../config/config.js';

class PromocionService {

  // ──────────────────────────────────────────────────────────
  // LISTADO PÚBLICO (con filtros y lógica freemium)
  // ──────────────────────────────────────────────────────────

  /**
   * Listado de promociones para el frontend público.
   * Aplica filtro de delay freemium según el rol del usuario.
   */
  async listar({ zona, tipo, estado, precioMax, dormitorios, pagina = 1, limite = 20, usuario = null }) {
    const conditions = ['p.publicada = true'];
    const params = [];
    let i = 1;

    // Filtro freemium: free/anónimo ven con delay, premium ven todo
    if (!usuario || usuario.plan === 'free') {
      conditions.push(`p.published_at_free <= NOW()`);
    } else {
      conditions.push(`p.published_at <= NOW()`);
    }

    if (zona)      { conditions.push(`p.zona = $${i++}`);             params.push(zona); }
    if (tipo)      { conditions.push(`p.tipo = $${i++}`);             params.push(tipo); }
    if (estado)    { conditions.push(`p.estado = $${i++}`);           params.push(estado); }
    if (precioMax) { conditions.push(`p.precio_desde <= $${i++}`);    params.push(parseInt(precioMax)); }
    if (dormitorios) {
      conditions.push(`p.dormitorios_min <= $${i} AND p.dormitorios_max >= $${i}`);
      params.push(parseInt(dormitorios)); i++;
    }

    const offset = (pagina - 1) * limite;
    const where  = conditions.join(' AND ');

    const [filas, total, nuevasSemana] = await Promise.all([
      query(
        `SELECT p.id, p.nombre, p.slug, p.tipo, p.zona, p.estado,
                p.precio_desde, p.precio_hasta, p.precio_m2,
                p.m2_desde, p.m2_hasta, p.dormitorios_min, p.dormitorios_max,
                p.lat, p.lng, p.imagen_principal, p.descripcion_corta,
                p.fecha_entrega_est, p.web_oficial, p.destacada,
                p.published_at, p.published_at_free,
                pr.nombre AS promotora_nombre, pr.logo_url AS promotora_logo
         FROM promociones p
         LEFT JOIN promotoras pr ON pr.id = p.promotora_id
         WHERE ${where}
         ORDER BY p.destacada DESC, p.published_at DESC
         LIMIT $${i++} OFFSET $${i++}`,
        [...params, limite, offset]
      ),
      queryOne(
        `SELECT COUNT(*)::int AS total FROM promociones p WHERE ${where}`,
        params
      ),
      queryOne(
        `SELECT COUNT(*)::int AS total FROM promociones p WHERE publicada = true AND created_at >= NOW() - INTERVAL '30 days'`
      )
    ]);

    return {
      promociones: filas,
      total: total?.total || 0,
      nuevas_semana: nuevasSemana?.total || 0,
      pagina,
      paginas: Math.ceil((total?.total || 0) / limite)
    };
  }

  /**
   * Detalle de una promoción por ID o slug.
   */
  async detalle(idOrSlug, usuario = null) {
    const isId = /^\d+$/.test(String(idOrSlug));
    const campo = isId ? 'p.id' : 'p.slug';

    const p = await queryOne(
      `SELECT p.*,
              pr.nombre AS promotora_nombre, pr.web AS promotora_web,
              pr.logo_url AS promotora_logo, pr.descripcion AS promotora_desc
       FROM promociones p
       LEFT JOIN promotoras pr ON pr.id = p.promotora_id
       WHERE ${campo} = $1 AND p.publicada = true`,
      [idOrSlug]
    );
    if (!p) return null;

    // Verificar acceso freemium
    const ahoraMismo = new Date();
    if (!usuario || usuario.plan === 'free') {
      if (!p.published_at_free || new Date(p.published_at_free) > ahoraMismo) return null;
    }

    // Documentos (solo premium los ve)
    const puedeVerDocs = usuario && (usuario.plan === 'premium' || usuario.rol === 'admin');
    const documentos = puedeVerDocs
      ? await query('SELECT id, nombre, tipo, tamano_bytes, solo_premium FROM documentos WHERE promocion_id = $1 ORDER BY tipo', [p.id])
      : await query('SELECT id, nombre, tipo, tamano_bytes, solo_premium FROM documentos WHERE promocion_id = $1 AND solo_premium = false ORDER BY tipo', [p.id]);

    // Historial de precios
    const precios = await query(
      'SELECT precio_desde, precio_hasta, precio_m2, detectado_en FROM precio_historico WHERE promocion_id = $1 ORDER BY detectado_en ASC',
      [p.id]
    );

    // Fotos de obra
    const fotos_obra = await query(
      'SELECT id, foto_path, descripcion, fecha_foto FROM fotos_obra WHERE promocion_id = $1 ORDER BY fecha_foto ASC',
      [p.id]
    );

    // Comentarios aprobados
    const comentarios = await query(
      `SELECT c.id, c.contenido, c.created_at, c.parent_id,
              u.nombre AS autor_nombre
       FROM comentarios c
       JOIN usuarios u ON u.id = c.usuario_id
       WHERE c.promocion_id = $1 AND c.aprobado = true
       ORDER BY c.created_at ASC`,
      [p.id]
    );

    return {
      ...p,
      documentos,
      precios,
      fotos_obra,
      comentarios,
      // Objeto promotora anidado para el frontend
      promotora: p.promotora_id ? {
        nombre: p.promotora_nombre,
        web:    p.promotora_web,
        logo:   p.promotora_logo,
        desc:   p.promotora_desc
      } : null
    };
  }

  // ──────────────────────────────────────────────────────────
  // PARA EL MAPA
  // ──────────────────────────────────────────────────────────

  /**
   * GeoJSON de todas las promociones publicadas (para Mapbox).
   * Devuelve solo los campos necesarios para el mapa (sin filtro freemium — posición es pública).
   */
  async geojson() {
    const rows = await query(
      `SELECT p.id, p.nombre, p.slug, p.tipo, p.estado, p.zona,
              p.precio_desde, p.lat, p.lng, p.imagen_principal,
              pr.nombre AS promotora
       FROM promociones p
       LEFT JOIN promotoras pr ON pr.id = p.promotora_id
       WHERE p.publicada = true AND p.lat IS NOT NULL AND p.lng IS NOT NULL`
    );

    return {
      type: 'FeatureCollection',
      features: rows.map(r => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [parseFloat(r.lng), parseFloat(r.lat)] },
        properties: {
          id: r.id, nombre: r.nombre, slug: r.slug,
          tipo: r.tipo, estado: r.estado, zona: r.zona,
          precio_desde: r.precio_desde, promotora: r.promotora,
          imagen: r.imagen_principal
        }
      }))
    };
  }

  // ──────────────────────────────────────────────────────────
  // ADMIN — CRUD COMPLETO
  // ──────────────────────────────────────────────────────────

  async adminListar({ pagina = 1, limite = 30, publicada, zona, tipo } = {}) {
    const conditions = [];
    const params = [];
    let i = 1;

    if (publicada !== undefined) { conditions.push(`p.publicada = $${i++}`); params.push(publicada === 'true' || publicada === true); }
    if (zona) { conditions.push(`p.zona = $${i++}`); params.push(zona); }
    if (tipo) { conditions.push(`p.tipo = $${i++}`); params.push(tipo); }

    const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (pagina - 1) * limite;

    const [filas, total] = await Promise.all([
      query(
        `SELECT p.id, p.nombre, p.slug, p.tipo, p.zona, p.estado, p.publicada,
                p.precio_desde, p.precio_hasta, p.published_at, p.created_at, p.destacada,
                pr.nombre AS promotora_nombre
         FROM promociones p
         LEFT JOIN promotoras pr ON pr.id = p.promotora_id
         ${where}
         ORDER BY p.created_at DESC
         LIMIT $${i++} OFFSET $${i++}`,
        [...params, limite, offset]
      ),
      queryOne(`SELECT COUNT(*)::int AS total FROM promociones p ${where}`, params)
    ]);

    return { promociones: filas, total: total?.total || 0, pagina, paginas: Math.ceil((total?.total || 0) / limite) };
  }

  async adminDetalle(id) {
    return queryOne('SELECT * FROM promociones WHERE id = $1', [id]);
  }

  async crear(datos) {
    const slug = datos.slug || this._generarSlug(datos.nombre);
    const {
      promotora_id, nombre, tipo = 'VPPL', zona, direccion, lat, lng,
      precio_desde, precio_hasta, precio_m2,
      m2_desde, m2_hasta, dormitorios_min, dormitorios_max,
      garaje_incluido, trastero_incluido, ascensor, calificacion_energetica,
      estado = 'en_proyecto', fecha_inicio_obra, fecha_entrega_est,
      descripcion, descripcion_corta, imagen_principal, imagenes,
      web_oficial, destacada = false, metadatos = {}
    } = datos;

    return transaction(async (client) => {
      const promo = await client.query(
        `INSERT INTO promociones (
          promotora_id, nombre, slug, tipo, zona, direccion, lat, lng,
          precio_desde, precio_hasta, precio_m2,
          m2_desde, m2_hasta, dormitorios_min, dormitorios_max,
          garaje_incluido, trastero_incluido, ascensor, calificacion_energetica,
          estado, fecha_inicio_obra, fecha_entrega_est,
          descripcion, descripcion_corta, imagen_principal, imagenes,
          web_oficial, destacada, metadatos
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,
          $9,$10,$11,
          $12,$13,$14,$15,
          $16,$17,$18,$19,
          $20,$21,$22,
          $23,$24,$25,$26,
          $27,$28,$29
        ) RETURNING *`,
        [
          promotora_id, nombre, slug, tipo, zona, direccion, lat, lng,
          precio_desde, precio_hasta, precio_m2,
          m2_desde, m2_hasta, dormitorios_min, dormitorios_max,
          garaje_incluido, trastero_incluido, ascensor, calificacion_energetica,
          estado, fecha_inicio_obra, fecha_entrega_est,
          descripcion, descripcion_corta, imagen_principal, imagenes,
          web_oficial, destacada, JSON.stringify(metadatos)
        ]
      );
      return promo.rows[0];
    });
  }

  async actualizar(id, datos) {
    // Solo actualiza los campos enviados (PATCH behavior)
    const campos = [];
    const valores = [];
    let i = 1;

    const permitidos = [
      'promotora_id','nombre','slug','tipo','zona','direccion','lat','lng',
      'precio_desde','precio_hasta','precio_m2','m2_desde','m2_hasta',
      'dormitorios_min','dormitorios_max','garaje_incluido','trastero_incluido',
      'ascensor','calificacion_energetica','estado','fecha_inicio_obra',
      'fecha_entrega_est','descripcion','descripcion_corta','imagen_principal',
      'imagenes','web_oficial','destacada','metadatos'
    ];

    for (const [key, val] of Object.entries(datos)) {
      if (permitidos.includes(key) && val !== undefined) {
        campos.push(`${key} = $${i++}`);
        valores.push(val);
      }
    }

    if (!campos.length) throw new Error('No hay campos que actualizar');

    campos.push(`updated_at = NOW()`);
    valores.push(id);

    return queryOne(
      `UPDATE promociones SET ${campos.join(', ')} WHERE id = $${i} RETURNING *`,
      valores
    );
  }

  /**
   * Publica una promoción: establece published_at y published_at_free.
   */
  async publicar(id) {
    const ahora = new Date();
    const freeDelay = new Date(ahora.getTime() + config.FREE_TIER_DELAY_HOURS * 60 * 60 * 1000);

    return queryOne(
      `UPDATE promociones
       SET publicada = true, published_at = $1, published_at_free = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [ahora, freeDelay, id]
    );
  }

  async despublicar(id) {
    return queryOne(
      `UPDATE promociones
       SET publicada = false, published_at = NULL, published_at_free = NULL, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id]
    );
  }

  async eliminar(id) {
    await run('DELETE FROM promociones WHERE id = $1', [id]);
  }

  // ──────────────────────────────────────────────────────────
  // RADAR DE ACTIVIDAD
  // ──────────────────────────────────────────────────────────

  async getActividad(limite = 20) {
    return query(
      `SELECT a.*, p.nombre AS promocion_nombre, p.slug AS promocion_slug
       FROM actividad a
       LEFT JOIN promociones p ON p.id = a.promocion_id
       WHERE a.publica = true
       ORDER BY a.created_at DESC
       LIMIT $1`,
      [limite]
    );
  }

  async registrarActividad({ tipo, titulo, descripcion, promocion_id, noticia_id, icono, color, publica = true }) {
    return queryOne(
      `INSERT INTO actividad (tipo, titulo, descripcion, promocion_id, noticia_id, icono, color, publica)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [tipo, titulo, descripcion, promocion_id, noticia_id, icono, color, publica]
    );
  }

  // ──────────────────────────────────────────────────────────
  // PROMOTORAS (listado público y admin)
  // ──────────────────────────────────────────────────────────

  async listarPromotoras() {
    return query(
      `SELECT id, nombre, web, logo_url, descripcion,
              (SELECT COUNT(*)::int FROM promociones WHERE promotora_id = promotoras.id AND publicada = true) AS promociones_activas
       FROM promotoras WHERE activa = true ORDER BY nombre`
    );
  }

  async adminListarPromotoras() {
    return query(
      `SELECT p.*,
              (SELECT COUNT(*)::int FROM promociones WHERE promotora_id = p.id) AS total_promociones
       FROM promotoras p ORDER BY p.nombre`
    );
  }

  async crearPromotora(datos) {
    const { nombre, web, logo_url, descripcion, scraping_activo = false, scraping_interval_horas = 24, form_url, form_tipo } = datos;
    return queryOne(
      `INSERT INTO promotoras (nombre, web, logo_url, descripcion, scraping_activo, scraping_interval_horas, form_url, form_tipo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [nombre, web, logo_url, descripcion, scraping_activo, scraping_interval_horas, form_url, form_tipo]
    );
  }

  async actualizarPromotora(id, datos) {
    const campos = [];
    const valores = [];
    let i = 1;
    const permitidos = ['nombre','web','logo_url','descripcion','activa','scraping_activo','scraping_interval_horas','form_url','form_tipo'];
    for (const [key, val] of Object.entries(datos)) {
      if (permitidos.includes(key) && val !== undefined) {
        campos.push(`${key} = $${i++}`); valores.push(val);
      }
    }
    if (!campos.length) throw new Error('No hay campos que actualizar');
    campos.push(`updated_at = NOW()`);
    valores.push(id);
    return queryOne(`UPDATE promotoras SET ${campos.join(', ')} WHERE id = $${i} RETURNING *`, valores);
  }

  // ──────────────────────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────────────────────

  _generarSlug(nombre) {
    return nombre
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar acentos
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      + '-' + Date.now().toString(36);
  }
}

export default new PromocionService();
