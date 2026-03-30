import jwt from 'jsonwebtoken';
import config from '../config/config.js';

/**
 * Middleware: verifica el JWT del header Authorization.
 * Si es válido, añade req.user con el payload.
 * Si no hay token o es inválido, req.user = null (no bloquea rutas públicas).
 * Para rutas protegidas, usar requireRole() después de este middleware.
 */
export const verifyJWT = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

    if (!token) {
      req.user = null;
      return next();
    }

    req.user = jwt.verify(token, config.JWT_SECRET);
    next();
  } catch (err) {
    // Token inválido o expirado → tratar como no autenticado (no como error)
    req.user = null;
    next();
  }
};

/**
 * Middleware factory: exige que el usuario tenga uno de los roles indicados.
 * Debe usarse DESPUÉS de verifyJWT.
 *
 * Uso:
 *   router.get('/ruta', verifyJWT, requireRole('admin'), handler)
 *   router.get('/ruta', verifyJWT, requireRole('premium', 'admin'), handler)
 */
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Autenticación requerida' });
  }
  if (!roles.includes(req.user.rol)) {
    return res.status(403).json({ success: false, error: 'Acceso no autorizado' });
  }
  next();
};

/**
 * Middleware: exige autenticación (cualquier rol válido).
 */
export const requireAuth = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Autenticación requerida' });
  }
  next();
};
