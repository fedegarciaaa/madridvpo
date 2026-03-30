import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { queryOne } from '../config/db.js';
import { verifyJWT } from '../middleware/auth.js';
import config from '../config/config.js';

const router = Router();

const err = (res, msg, code=400) => res.status(code).json({ success: false, error: msg });

// ── GET /api/documentos/:id ────────────────────────────────────
// Sirve el fichero si el usuario tiene acceso.
// Ruta completa: /api/documentos/:id
// solo_premium=true → requiere rol premium o admin.
// solo_premium=false → accesible para todos (incluso anónimos).
router.get('/documentos/:id', verifyJWT, async (req, res) => {
  try {
    const doc = await queryOne(
      'SELECT * FROM documentos WHERE id = $1',
      [req.params.id]
    );
    if (!doc) return err(res, 'Documento no encontrado', 404);

    if (doc.solo_premium) {
      const rol = req.user?.rol;
      if (rol !== 'premium' && rol !== 'admin') {
        return err(res, 'Requiere plan Premium', 403);
      }
    }

    const filePath = path.join(config.UPLOADS_DIR, doc.fichero_path);

    if (!fs.existsSync(filePath)) {
      return err(res, 'Archivo no disponible', 404);
    }

    res.sendFile(filePath);
  } catch (e) {
    console.error('[GET /documentos/:id]', e.message);
    err(res, 'Error interno', 500);
  }
});

export default router;
