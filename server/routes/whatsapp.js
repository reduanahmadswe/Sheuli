import { Router } from 'express';
import {
  getConnectionStatus,
  getLastQr,
  isSwitchingAccount,
  getClientInfo,
  logoutWhatsApp
} from '../whatsapp.js';

const router = Router();

router.get('/status', (req, res) => {
  res.json({
    status: getConnectionStatus(),
    info: getClientInfo(),
    qr: getLastQr(),
    switchingAccount: isSwitchingAccount()
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

  return res.json({ ok: true, status: getConnectionStatus(), qr: getLastQr() });
});

export default router;
