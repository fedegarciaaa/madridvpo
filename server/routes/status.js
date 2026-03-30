import { Router } from 'express';
import { checkConnection } from '../config/db.js';

const router = Router();

const ok  = (res, data)          => res.json({ success: true, data });
const err = (res, msg, code=400) => res.status(code).json({ success: false, error: msg });

router.get('/status', async (req, res) => {
  try {
    const dbOk = await checkConnection();
    ok(res, {
      version: '1.0.0',
      db: dbOk ? 'connected' : 'error',
      env: process.env.NODE_ENV || 'development',
      uptime: Math.floor(process.uptime()) + 's',
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    err(res, e.message, 500);
  }
});

export default router;
