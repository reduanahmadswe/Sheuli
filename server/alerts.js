// FEATURE 1: Telegram alert channel. A thin wrapper around the Telegram Bot
// API's sendMessage endpoint using the built-in fetch (Node 20+) — no extra
// dependency needed. Silently disabled (no-op) when TELEGRAM_BOT_TOKEN or
// TELEGRAM_CHAT_ID aren't set, and never throws — an alert failure must never
// crash or block the caller.

import config from './config.js';
import logger from './logger.js';

const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 1000;

// FIX 3.1: an identical message sent again within this window is dropped —
// this is what stops the account-switch LOGOUT loop from spamming Telegram
// with the same "lost connection" text several times a minute.
const DEDUP_WINDOW_MS = 10 * 60 * 1000;
// FIX 3.2: hard cap on total alert volume regardless of message content.
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 6;

const lastSentByMessage = new Map(); // message text -> timestamp last delivered
let sentTimestamps = []; // rolling window of successful sends, for the rate limit
let suppressedCount = 0; // alerts dropped by the rate limit since the last one that got through

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isAlertingEnabled() {
  return Boolean(config.telegram.botToken && config.telegram.chatId);
}

function isDuplicate(message, now) {
  const lastSent = lastSentByMessage.get(message);
  return lastSent !== undefined && now - lastSent < DEDUP_WINDOW_MS;
}

function isRateLimited(now) {
  sentTimestamps = sentTimestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  return sentTimestamps.length >= RATE_LIMIT_MAX;
}

async function deliver(message) {
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

export async function sendAlert(message) {
  if (!isAlertingEnabled()) {
    logger.debug('Telegram alerting is disabled (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set) — skipping alert');
    return false;
  }

  const now = Date.now();

  if (isDuplicate(message, now)) {
    logger.debug({ message }, 'Duplicate Telegram alert suppressed (identical message sent within the last 10 minutes)');
    return false;
  }

  if (isRateLimited(now)) {
    suppressedCount += 1;
    logger.warn({ message, suppressedCount }, 'Telegram alert rate limit reached (6/hour) — suppressing');
    return false;
  }

  const delivered = await deliver(message);
  if (delivered) {
    lastSentByMessage.set(message, now);
    sentTimestamps.push(now);

    // FIX 3.2: once the rate limit lifts, let the caller know how much was
    // batched away instead of silently dropping it forever.
    if (suppressedCount > 0) {
      const count = suppressedCount;
      suppressedCount = 0;
      deliver(`…and ${count} more alert${count === 1 ? '' : 's'} suppressed in the last hour.`).catch(() => {
        // Best-effort follow-up only — the alert that just succeeded still counts as delivered.
      });
    }
  }
  return delivered;
}

export default { sendAlert, isAlertingEnabled };
