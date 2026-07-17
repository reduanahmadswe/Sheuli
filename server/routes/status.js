import { Router } from 'express';
import { getTodayStats } from '../db.js';
import { getConnectionStatus, getClientInfo, isSwitchingAccount } from '../whatsapp.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({
    connection: getConnectionStatus(),
    info: getClientInfo(),
    switchingAccount: isSwitchingAccount(),
    stats: getTodayStats()
  });
});

export default router;
