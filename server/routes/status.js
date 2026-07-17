import { Router } from 'express';
import { getTodayStats } from '../db.js';
import { getConnectionStatus, getClientInfo, isSwitchingAccount, getConnectionDetails } from '../whatsapp.js';

const router = Router();

router.get('/', (req, res) => {
  const details = getConnectionDetails();
  res.json({
    connection: details.status,
    info: details.info,
    switchingAccount: details.switchingAccount,
    sessionRecoveryFailed: details.sessionRecoveryFailed,
    loadingPercent: details.loadingPercent,
    loadingMessage: details.loadingMessage,
    stats: getTodayStats()
  });
});

export default router;
