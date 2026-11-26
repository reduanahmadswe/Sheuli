import { Router } from 'express';
import { getTodayStats } from '../db.js';
import { getConnectionStatus, getClientInfo, isSwitchingAccount, getConnectionDetails, getLastQr } from '../whatsapp.js';

const router = Router();

router.get('/', (req, res) => {
  const details = getConnectionDetails();
  res.json({
    connection: details.status,
    info: details.info,
    switchingAccount: details.switchingAccount,
    sessionRecoveryFailed: details.sessionRecoveryFailed,
    pairingRejectedHint: details.pairingRejectedHint,
    loadingPercent: details.loadingPercent,
    loadingMessage: details.loadingMessage,
    qr: getLastQr(),
    stats: getTodayStats()
  });
});

export default router;
