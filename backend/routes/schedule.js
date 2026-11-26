import { Router } from 'express';
import { getAllSettings, setSetting } from '../db.js';
import { getScheduleStatus, WEEKDAYS } from '../schedule.js';

const router = Router();

router.get('/', (req, res) => {
  const settings = getAllSettings();
  res.json({
    mode: settings.mode,
    autoReplyEnabled: settings.autoReplyEnabled,
    scheduleStart: settings.scheduleStart,
    scheduleEnd: settings.scheduleEnd,
    scheduleDays: settings.scheduleDays,
    timezone: settings.timezone,
    status: getScheduleStatus(settings)
  });
});

router.put('/', (req, res) => {
  const { mode, scheduleStart, scheduleEnd, scheduleDays, autoReplyEnabled } = req.body || {};

  if (mode !== undefined && !['manual', 'schedule'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be "manual" or "schedule"' });
  }
  if (scheduleStart !== undefined && !/^\d{2}:\d{2}$/.test(scheduleStart)) {
    return res.status(400).json({ error: 'scheduleStart must be in HH:MM format' });
  }
  if (scheduleEnd !== undefined && !/^\d{2}:\d{2}$/.test(scheduleEnd)) {
    return res.status(400).json({ error: 'scheduleEnd must be in HH:MM format' });
  }
  if (scheduleStart !== undefined && scheduleEnd !== undefined && scheduleStart === scheduleEnd) {
    return res.status(400).json({ error: 'Start and end time cannot be identical' });
  }
  if (scheduleDays !== undefined) {
    if (!Array.isArray(scheduleDays) || scheduleDays.some((d) => !WEEKDAYS.includes(d))) {
      return res.status(400).json({ error: `scheduleDays must be an array using: ${WEEKDAYS.join(', ')}` });
    }
  }

  if (mode !== undefined) setSetting('mode', mode);
  if (scheduleStart !== undefined) setSetting('scheduleStart', scheduleStart);
  if (scheduleEnd !== undefined) setSetting('scheduleEnd', scheduleEnd);
  if (scheduleDays !== undefined) setSetting('scheduleDays', scheduleDays);
  if (typeof autoReplyEnabled === 'boolean') setSetting('autoReplyEnabled', autoReplyEnabled);

  const settings = getAllSettings();
  const status = getScheduleStatus(settings);

  const io = req.app.get('io');
  io?.emit('settings:updated', settings);
  io?.emit('schedule:status', status);

  res.json({
    mode: settings.mode,
    autoReplyEnabled: settings.autoReplyEnabled,
    scheduleStart: settings.scheduleStart,
    scheduleEnd: settings.scheduleEnd,
    scheduleDays: settings.scheduleDays,
    timezone: settings.timezone,
    status
  });
});

export default router;
