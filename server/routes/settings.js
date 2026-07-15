import { Router } from 'express';
import { getAllSettings, setSetting } from '../db.js';

const router = Router();

// Schedule fields (mode, scheduleStart/End, scheduleDays) are managed exclusively
// through GET/PUT /api/settings/schedule — timezone is never user-editable, it
// always comes from the server's TIMEZONE env var.
const EDITABLE_KEYS = ['autoReplyEnabled', 'systemPrompt', 'whitelistMode', 'model'];

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
