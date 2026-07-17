import { Router } from 'express';
import config from '../config.js';
import { getConnectionStatus, getSelfChatId, getClientInfo, isSwitchingAccount } from '../whatsapp.js';
import { getAllSettings, getMessageCount, getLastMessageTimestamps, getDailyCost } from '../db.js';
import { isSheuliActive, getZonedDateKey } from '../schedule.js';
import { isAlertingEnabled } from '../alerts.js';

const router = Router();

function autoReplyReason(settings) {
  const active = isSheuliActive(settings);
  if (settings.mode === 'schedule') {
    return active
      ? `on — within the scheduled window (${settings.scheduleStart}–${settings.scheduleEnd} ${config.timezone})`
      : `off — outside the scheduled window (${settings.scheduleStart}–${settings.scheduleEnd} ${config.timezone})`;
  }
  return active ? 'on — manually turned on' : 'off — manually turned off';
}

router.get('/', (req, res) => {
  const settings = getAllSettings();
  const selfId = getSelfChatId();
  const dateKey = getZonedDateKey(new Date(), config.timezone);
  const todayCost = getDailyCost(dateKey);
  const { lastIncomingAt, lastReplyAt } = getLastMessageTimestamps();
  const info = getClientInfo();

  res.json({
    whatsapp: {
      state: getConnectionStatus(),
      number: selfId ? selfId.replace('@c.us', '').replace('@lid', '') : (info?.number || null),
      name: info?.name || null,
      switchingAccount: isSwitchingAccount()
    },
    autoReply: {
      active: isSheuliActive(settings),
      reason: autoReplyReason(settings)
    },
    database: {
      path: config.dbPath,
      messageCount: getMessageCount()
    },
    cost: {
      todayEstimated: Number(todayCost.estimatedCost.toFixed(4)),
      dailyLimit: settings.costLimitDaily
    },
    env: {
      openaiApiKeyPresent: Boolean(config.openaiApiKey),
      telegramConfigured: isAlertingEnabled()
    },
    lastIncomingAt,
    lastReplyAt,
    serverTime: new Date().toISOString(),
    uptimeSeconds: process.uptime()
  });
});

export default router;
