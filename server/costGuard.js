// FEATURE 2: Daily API cost guard. Every OpenAI call's real token usage is
// accumulated into the `daily_costs` table (keyed by local calendar date, see
// schedule.js#getZonedDateKey), so the total naturally resets at local
// midnight. Once the configured daily limit is reached, callers must stop
// making OpenAI calls for the rest of the day (see whatsapp.js) — this module
// only tracks cost and answers "are we over the limit yet?", it never makes
// the skip decision itself.

import config from './config.js';
import logger from './logger.js';
import { getSetting, getDailyCost, addDailyCost, markCostAlertSent } from './db.js';
import { getZonedDateKey } from './schedule.js';
import { sendAlert } from './alerts.js';

export function computeCost(promptTokens, completionTokens) {
  const { inputPerMillion, outputPerMillion } = config.pricing.gpt4oMini;
  return (promptTokens / 1_000_000) * inputPerMillion + (completionTokens / 1_000_000) * outputPerMillion;
}

export function getCostLimit() {
  return Number(getSetting('costLimitDaily', config.defaults.costLimitDaily));
}

export function getTodayCost() {
  const dateKey = getZonedDateKey(new Date(), config.timezone);
  return getDailyCost(dateKey).estimatedCost;
}

export function isCostLimitReached() {
  return getTodayCost() >= getCostLimit();
}

// Call this after every OpenAI call (reply generation, daily-summary
// generation, etc.) with the real usage numbers from the API response. Fires a
// one-time Telegram alert the moment the running total first crosses the
// limit for the day (limit_alert_sent guards against repeat alerts).
export async function recordApiCost(promptTokens, completionTokens) {
  const dateKey = getZonedDateKey(new Date(), config.timezone);
  const cost = computeCost(promptTokens, completionTokens);
  const row = addDailyCost(dateKey, promptTokens || 0, completionTokens || 0, cost);

  const limit = getCostLimit();
  if (row.estimatedCost >= limit && !row.limitAlertSent) {
    markCostAlertSent(dateKey);
    try {
      await sendAlert(
        `🟠 Sheuli hit today's cost limit ($${limit.toFixed(2)}). Auto-reply paused until midnight.`
      );
    } catch (err) {
      logger.warn({ err: err?.message || err }, 'Failed to send cost-limit alert (continuing)');
    }
  }

  return row;
}

export default { computeCost, getCostLimit, getTodayCost, isCostLimitReached, recordApiCost };
