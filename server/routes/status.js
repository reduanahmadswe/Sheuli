import { Router } from 'express';
import { getTodayStats } from '../db.js';
import { getConnectionStatus } from '../whatsapp.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({
    connection: getConnectionStatus(),
    stats: getTodayStats()
  });
});

export default router;
