import { Router } from 'express';
import {
  getConnectionStatus,
  getLastQr,
  isSwitchingAccount,
  getClientInfo,
  getConnectionDetails,
  logoutWhatsApp
} from '../whatsapp.js';

const router = Router();

router.get('/status', (req, res) => {
  const details = getConnectionDetails();
  res.json({
    status: details.status,
    info: details.info,
    qr: details.qr,
    loadingPercent: details.loadingPercent,
    loadingMessage: details.loadingMessage,
    switchingAccount: details.switchingAccount,
    sessionRecoveryFailed: details.sessionRecoveryFailed
  });
});

router.post('/logout', async (req, res) => {
  if (isSwitchingAccount()) {
    return res.status(409).json({ error: 'WhatsApp account switch is already in progress' });
  }

  const clearHistory = Boolean(req.body?.clearHistory);
  const result = await logoutWhatsApp({ clearHistory });

  if (!result.ok) {
    return res.status(500).json({ error: result.error || 'Failed to logout WhatsApp account' });
  }

  const details = getConnectionDetails();
  return res.json({
    ok: true,
    status: details.status,
    qr: details.qr,
    info: details.info,
    loadingPercent: details.loadingPercent,
    loadingMessage: details.loadingMessage,
    switchingAccount: details.switchingAccount,
    sessionRecoveryFailed: details.sessionRecoveryFailed
  });
});

export default router;
