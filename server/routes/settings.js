import { Router } from 'express';
import config from '../config.js';
import { getAllSettings, setSetting } from '../db.js';

const router = Router();

// Schedule fields (mode, scheduleStart/End, scheduleDays) are managed exclusively
// through GET/PUT /api/settings/schedule — timezone is never user-editable, it
// always comes from the server's TIMEZONE env var.
const EDITABLE_KEYS = [
  'autoReplyEnabled',
  'systemPrompt',
  'model',
  'rateLimitPerHour',
  'costLimitDaily',
  'dailySummaryEnabled',
  'dailySummaryTime',
  'dailySummarySkipIfEmpty'
];

const NUMERIC_KEYS = new Set(['costLimitDaily', 'rateLimitPerHour']);

router.get('/', (req, res) => {
  res.json(getAllSettings());
});

router.put('/', (req, res) => {
  const updates = req.body || {};

  if (updates.costLimitDaily !== undefined) {
    const value = Number(updates.costLimitDaily);
    if (!Number.isFinite(value) || value <= 0) {
      return res.status(400).json({ error: 'costLimitDaily must be a positive number' });
    }
  }
  if (updates.rateLimitPerHour !== undefined) {
    const value = Number(updates.rateLimitPerHour);
    // 0 is a deliberate special case: rate limiting completely off (unlimited).
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      return res.status(400).json({ error: 'rateLimitPerHour must be a whole number between 0 (unlimited) and 100' });
    }
  }
  if (updates.dailySummaryTime !== undefined && !/^\d{2}:\d{2}$/.test(updates.dailySummaryTime)) {
    return res.status(400).json({ error: 'dailySummaryTime must be in HH:MM format' });
  }

  for (const key of EDITABLE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      setSetting(key, NUMERIC_KEYS.has(key) ? Number(updates[key]) : updates[key]);
    }
  }

  const settings = getAllSettings();
  req.app.get('io')?.emit('settings:updated', settings);
  res.json(settings);
});


export default router;
