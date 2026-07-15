import { Router } from 'express';
import { getAllSettings, setSetting } from '../db.js';

const router = Router();

const EDITABLE_KEYS = [
  'autoReplyEnabled',
  'scheduleEnabled',
  'scheduleStart',
  'scheduleEnd',
  'timezone',
  'systemPrompt',
  'rateLimitPerHour',
  'whitelistMode',
  'model'
];

router.get('/', (req, res) => {
  res.json(getAllSettings());
});

router.put('/', (req, res) => {
  const updates = req.body || {};

  for (const key of EDITABLE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      setSetting(key, updates[key]);
    }
  }

  const settings = getAllSettings();
  req.app.get('io')?.emit('settings:updated', settings);
  res.json(settings);
});

export default router;
