// FEATURE 1: Telegram alert channel. A thin wrapper around the Telegram Bot
// API's sendMessage endpoint using the built-in fetch (Node 20+) — no extra
// dependency needed. Silently disabled (no-op) when TELEGRAM_BOT_TOKEN or
// TELEGRAM_CHAT_ID aren't set, and never throws — an alert failure must never
// crash or block the caller.

import config from './config.js';
import logger from './logger.js';

const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isAlertingEnabled() {
  return Boolean(config.telegram.botToken && config.telegram.chatId);
}

export async function sendAlert(message) {
  if (!isAlertingEnabled()) {
    logger.debug('Telegram alerting is disabled (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set) — skipping alert');
    return false;
  }

  const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: config.telegram.chatId, text: message })
      });

      if (res.ok) return true;

      const bodyText = await res.text().catch(() => '');
      throw new Error(`Telegram API responded ${res.status}: ${bodyText}`);
    } catch (err) {
      logger.warn({ err: err?.message || err, attempt }, 'Telegram alert attempt failed');
      if (attempt < MAX_RETRIES) {
        await sleep(BASE_BACKOFF_MS * 2 ** attempt);
      }
    }
  }

  logger.error({ message }, 'Failed to send Telegram alert after retries — giving up');
  return false;
}

export default { sendAlert, isAlertingEnabled };
