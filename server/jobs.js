// Background job scheduler for FEATURE 3 (daily backup) and FEATURE 4
// (daily summary). Both are "once a day at HH:MM in TIMEZONE" jobs, so rather
// than pulling in a cron dependency, a single per-minute tick checks the
// zoned wall-clock time against each job's configured time — the same
// pattern schedule.js already uses for the auto-reply schedule window.

import config from './config.js';
import logger from './logger.js';
import { getSetting, setSetting } from './db.js';
import { getZonedParts, getZonedDateKey, toMinutes } from './schedule.js';
import { runBackup } from './backup.js';
import { runScheduledDailySummaryIfDue } from './summary.js';

const TICK_INTERVAL_MS = 60 * 1000;

async function checkBackupJob() {
  const now = new Date();
  const { time } = getZonedParts(now, config.timezone);
  if (toMinutes(time) !== toMinutes(config.backup.time)) return;

  const todayKey = getZonedDateKey(now, config.timezone);
  if (getSetting('lastBackupDate', null) === todayKey) return;

  // Mark first so a slow backup can't be triggered twice within the same minute.
  setSetting('lastBackupDate', todayKey);
  try {
    await runBackup();
  } catch (err) {
    logger.error({ err: err?.message || err }, 'Scheduled database backup failed');
  }
}

async function checkSummaryJob() {
  const now = new Date();
  const dailySummaryTime = getSetting('dailySummaryTime', config.defaults.dailySummaryTime);
  const { time } = getZonedParts(now, config.timezone);
  if (toMinutes(time) !== toMinutes(dailySummaryTime)) return;

  try {
    await runScheduledDailySummaryIfDue('scheduled');
  } catch (err) {
    logger.error({ err: err?.message || err }, 'Scheduled daily summary failed — will retry next check');
  }
}

async function startupSummaryCatchUp() {
  const now = new Date();
  const dailySummaryTime = getSetting('dailySummaryTime', config.defaults.dailySummaryTime);
  const { time } = getZonedParts(now, config.timezone);

  // Only catch up if today's scheduled time has already passed — if it's
  // still earlier in the day, the regular per-minute tick will fire it
  // naturally at the right time.
  if (toMinutes(time) < toMinutes(dailySummaryTime)) return;

  try {
    const result = await runScheduledDailySummaryIfDue('startup-catchup');
    if (result?.sent) {
      logger.info('Sent missed daily summary on startup catch-up');
    }
  } catch (err) {
    logger.error({ err: err?.message || err }, 'Startup daily-summary catch-up failed');
  }
}

export function startBackgroundJobs() {
  setInterval(() => {
    checkBackupJob().catch((err) => logger.error({ err: err?.message || err }, 'Backup job tick failed'));
    checkSummaryJob().catch((err) => logger.error({ err: err?.message || err }, 'Summary job tick failed'));
  }, TICK_INTERVAL_MS).unref();

  startupSummaryCatchUp().catch((err) => {
    logger.error({ err: err?.message || err }, 'Startup summary catch-up threw unexpectedly');
  });
}

export default { startBackgroundJobs };
