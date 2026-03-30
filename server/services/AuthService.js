import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query, queryOne, run } from '../config/db.js';
import config from '../config/config.js';

const BCRYPT_ROUNDS = 12;

class AuthService {

  // ──────────────────────────────────────────────────────────
  // REGISTRO
  // ──────────────────────────────────────────────────────────

  /**
   * Registra un nuevo usuario con rol 'free'.
   * @returns {Promise<{usuario, accessToken, refreshToken}>}
   */
  async register({ email, nombre, password }) {
    // Normalizar email
    const emailNorm = email.trim().toLowerCase();

    // Comprobar si ya existe
    const existe = await queryOne('SELECT id FROM usuarios WHERE email = $1', [emailNorm]);
    if (existe) throw new Error('Ya existe una cuenta con ese email');

    // Hash de la contraseña
    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Insertar usuario
    const usuario = await queryOne(
      `INSERT INTO usuarios (email, nombre, password_hash, rol, plan, activo, email_verificado)
       VALUES ($1, $2, $3, 'free', 'free', true, false)
       RETURNING id, email, nombre, rol, plan, created_at`,
      [emailNorm, nombre?.trim() || null, password_hash]
    );

    // Generar tokens
    const accessToken  = this._generateAccessToken(usuario);
    const refreshToken = await this._createRefreshToken(usuario.id);

    return { usuario, accessToken, refreshToken };
  }

  // ──────────────────────────────────────────────────────────
  // LOGIN
  // ──────────────────────────────────────────────────────────

  /**
   * Autentica un usuario con email y contraseña.
   * @returns {Promise<{usuario, accessToken, refreshToken}>}
   */
  async login({ email, password }) {
    const emailNorm = email.trim().toLowerCase();

    // Buscar usuario activo
    const usuario = await queryOne(
      `SELECT id, email, nombre, rol, plan, password_hash, activo
       FROM usuarios WHERE email = $1`,
      [emailNorm]
    );

    if (!usuario) throw new Error('Credenciales incorrectas');
    if (!usuario.activo) throw new Error('Cuenta desactivada. Contacta con el administrador');

    // Verificar contraseña
    const ok = await bcrypt.compare(password, usuario.password_hash);
    if (!ok) throw new Error('Credenciales incorrectas');

    // Actualizar last_login
    await run('UPDATE usuarios SET last_login = NOW() WHERE id = $1', [usuario.id]);

    // Generar tokens
    const accessToken  = this._generateAccessToken(usuario);
    const refreshToken = await this._createRefreshToken(usuario.id);

    // No devolver el hash
    delete usuario.password_hash;

    return { usuario, accessToken, refreshToken };
  }

  // ──────────────────────────────────────────────────────────
  // REFRESH TOKEN
  // ──────────────────────────────────────────────────────────

  /**
   * Rota el refresh token y emite un nuevo access token.
   * @param {string} rawToken - El refresh token en texto plano
   * @returns {Promise<{usuario, accessToken, refreshToken}>}
   */
  async refresh(rawToken) {
    if (!rawToken) throw new Error('Refresh token no proporcionado');

    const tokenHash = this._hashToken(rawToken);

    // Buscar el refresh token en BD
    const stored = await queryOne(
      `SELECT rt.id, rt.usuario_id, rt.expires_at, u.id as uid, u.email, u.nombre, u.rol, u.plan, u.activo
       FROM refresh_tokens rt
       JOIN usuarios u ON u.id = rt.usuario_id
       WHERE rt.token_hash = $1`,
      [tokenHash]
    );

    if (!stored) throw new Error('Refresh token inválido');
    if (new Date(stored.expires_at) < new Date()) {
      // Limpiar token expirado
      await run('DELETE FROM refresh_tokens WHERE id = $1', [stored.id]);
      throw new Error('Refresh token expirado. Inicia sesión de nuevo');
    }
    if (!stored.activo) throw new Error('Cuenta desactivada');

    // Rotar: eliminar el token usado y crear uno nuevo (rotación segura)
    await run('DELETE FROM refresh_tokens WHERE id = $1', [stored.id]);

    const usuario = {
      id: stored.uid, email: stored.email,
      nombre: stored.nombre, rol: stored.rol, plan: stored.plan
    };

    const accessToken  = this._generateAccessToken(usuario);
    const newRefresh   = await this._createRefreshToken(usuario.id);

    return { usuario, accessToken, refreshToken: newRefresh };
  }

  // ──────────────────────────────────────────────────────────
  // LOGOUT
  // ──────────────────────────────────────────────────────────

  /**
   * Invalida el refresh token (logout).
   */
  async logout(rawToken) {
    if (!rawToken) return;
    const tokenHash = this._hashToken(rawToken);
    await run('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
  }

  /**
   * Invalida todos los refresh tokens de un usuario (logout all devices).
   */
  async logoutAll(usuarioId) {
    await run('DELETE FROM refresh_tokens WHERE usuario_id = $1', [usuarioId]);
  }

  // ──────────────────────────────────────────────────────────
  // CAMBIO DE CONTRASEÑA
  // ──────────────────────────────────────────────────────────

  async changePassword(usuarioId, { passwordActual, passwordNueva }) {
    const usuario = await queryOne(
      'SELECT password_hash FROM usuarios WHERE id = $1', [usuarioId]
    );
    if (!usuario) throw new Error('Usuario no encontrado');

    const ok = await bcrypt.compare(passwordActual, usuario.password_hash);
    if (!ok) throw new Error('La contraseña actual es incorrecta');

    const newHash = await bcrypt.hash(passwordNueva, BCRYPT_ROUNDS);
    await run('UPDATE usuarios SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [newHash, usuarioId]);

    // Invalidar todas las sesiones existentes por seguridad
    await this.logoutAll(usuarioId);
  }

  // ──────────────────────────────────────────────────────────
  // HELPERS PRIVADOS
  // ──────────────────────────────────────────────────────────

  _generateAccessToken(usuario) {
    return jwt.sign(
      {
        id:    usuario.id,
        email: usuario.email,
        rol:   usuario.rol,
        plan:  usuario.plan
      },
      config.JWT_SECRET,
      { expiresIn: config.JWT_EXPIRES_IN }
    );
  }

  async _createRefreshToken(usuarioId) {
    // Generar token aleatorio de 64 bytes
    const rawToken  = crypto.randomBytes(64).toString('hex');
    const tokenHash = this._hashToken(rawToken);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + config.REFRESH_TOKEN_DAYS);

    await run(
      `INSERT INTO refresh_tokens (usuario_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [usuarioId, tokenHash, expiresAt]
    );

    return rawToken; // Se envía al cliente; en BD solo guardamos el hash
  }

  _hashToken(rawToken) {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  // Limpieza periódica de tokens expirados (llamada desde el scheduler)
  async cleanExpiredTokens() {
    const result = await run('DELETE FROM refresh_tokens WHERE expires_at < NOW()');
    return result.rowCount;
  }
}

export default new AuthService();
