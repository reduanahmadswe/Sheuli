// FEATURE 3: automatic SQLite database backup. Uses better-sqlite3's own
// `.backup()` API (an online/hot backup that's safe to run against an open,
// live database) rather than copying the .db file on disk, which could grab a
// half-written page while WAL checkpoints are in flight.

import fs from 'node:fs';
import path from 'node:path';
import config from './config.js';
import logger from './logger.js';
import db from './db.js';
import { sendAlert } from './alerts.js';
import { getZonedDateKey } from './schedule.js';

const BACKUP_FILENAME_RE = /^sheuli-\d{4}-\d{2}-\d{2}\.db$/;

function pruneOldBackups() {
  let files;
  try {
    files = fs
      .readdirSync(config.backup.dir)
      .filter((f) => BACKUP_FILENAME_RE.test(f))
      .sort(); // YYYY-MM-DD filenames sort chronologically as strings
  } catch (err) {
    logger.warn({ err: err?.message || err }, 'Could not list backups directory for pruning');
    return;
  }

  const excess = files.length - config.backup.keep;
  if (excess <= 0) return;

  for (const file of files.slice(0, excess)) {
    try {
      fs.unlinkSync(path.join(config.backup.dir, file));
      logger.info({ file }, 'Pruned old database backup');
    } catch (err) {
      logger.warn({ err: err?.message || err, file }, 'Failed to prune old backup');
    }
  }
}

export async function runBackup() {
  fs.mkdirSync(config.backup.dir, { recursive: true });
  const dateKey = getZonedDateKey(new Date(), config.timezone);
  const destPath = path.join(config.backup.dir, `sheuli-${dateKey}.db`);

  try {
    await db.backup(destPath);
    logger.info({ destPath }, 'Database backup completed');
    pruneOldBackups();
    return destPath;
  } catch (err) {
    logger.error({ err: err?.message || err }, 'Database backup failed');
    try {
      await sendAlert(`🔴 Sheuli's daily database backup failed: ${err?.message || err}`);
    } catch (alertErr) {
      logger.warn({ err: alertErr?.message || alertErr }, 'Failed to send backup-failure alert');
    }
    throw err;
  }
}

export default { runBackup };
