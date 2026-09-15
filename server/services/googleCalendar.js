import logger from '../logger.js';
import { getSetting, setSetting } from '../db.js';

export function parseNaturalLanguageEvent(text) {
  const normalized = text.trim();
  const scheduleMatch = normalized.match(/schedule\s+(.+?)\s+(tomorrow|today|tonight|next\s+\w+|\w+day)\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i) ||
                        normalized.match(/(?:schedule|add|set)\s+(.+?)\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);

  let summary = 'Meeting / Event';
  let dateObj = new Date();

  if (scheduleMatch) {
    summary = scheduleMatch[1] ? scheduleMatch[1].replace(/^(a|an|the)\s+/i, '') : 'Event';
    const dayRef = (scheduleMatch[2] || '').toLowerCase();
    const timeRef = (scheduleMatch[3] || scheduleMatch[2] || '').toLowerCase();

    if (dayRef === 'tomorrow') {
      dateObj.setDate(dateObj.getDate() + 1);
    }

    if (timeRef) {
      const timeMatch = timeRef.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
      if (timeMatch) {
        let hours = parseInt(timeMatch[1], 10);
        const minutes = parseInt(timeMatch[2] || '0', 10);
        const ampm = (timeMatch[3] || '').toLowerCase();

        if (ampm === 'pm' && hours < 12) hours += 12;
        if (ampm === 'am' && hours === 12) hours = 0;

        dateObj.setHours(hours, minutes, 0, 0);
      }
    }
  } else {
    // Default to 1 hour from now
    dateObj.setHours(dateObj.getHours() + 1, 0, 0, 0);
  }

  const endObj = new Date(dateObj.getTime() + 60 * 60 * 1000); // 1 hour duration

  return {
    summary: summary.charAt(0).toUpperCase() + summary.slice(1),
    startTime: dateObj.toISOString(),
    endTime: endObj.toISOString(),
    displayTime: dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    displayDate: dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  };
}

export function saveCalendarEvent(db, event) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS calendar_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        summary TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    const stmt = db.prepare('INSERT INTO calendar_events (summary, start_time, end_time, description) VALUES (?, ?, ?, ?)');
    const result = stmt.run(event.summary, event.startTime, event.endTime, event.description || '');

    logger.info({ eventId: result.lastInsertRowid, summary: event.summary }, 'Calendar event saved successfully');

    // Also update in JSON setting store for easy external backup/API sync
    const stored = getSetting('calendarEvents', '[]');
    let eventsList = [];
    try { eventsList = JSON.parse(stored); } catch {}
    eventsList.push({ ...event, id: result.lastInsertRowid });
    setSetting('calendarEvents', JSON.stringify(eventsList));

    return { ...event, id: result.lastInsertRowid };
  } catch (err) {
    logger.error({ err: err?.message || err }, 'Failed to save calendar event');
    throw err;
  }
}

export function getUpcomingEvents(db, daysAhead = 7) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS calendar_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        summary TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    const nowIso = new Date().toISOString();
    const futureDate = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

    const stmt = db.prepare('SELECT * FROM calendar_events WHERE end_time >= ? AND start_time <= ? ORDER BY start_time ASC');
    return stmt.all(nowIso, futureDate);
  } catch {
    return [];
  }
}

export function getCurrentRunningCalendarEvent(db, now = new Date()) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS calendar_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        summary TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    const nowIso = now.toISOString();
    const stmt = db.prepare(
      'SELECT * FROM calendar_events WHERE start_time <= ? AND end_time >= ? ORDER BY start_time DESC LIMIT 1'
    );
    return stmt.get(nowIso, nowIso) || null;
  } catch (err) {
    logger.warn({ err: err?.message || err }, 'Failed to check current running calendar event');
    return null;
  }
}

export function getScheduleSummaryForDate(db, targetDateStr = 'today') {
  const events = getUpcomingEvents(db, 7);
  if (!events || events.length === 0) {
    return 'Reduan has no scheduled calendar events for today, he is free.';
  }

  const list = events.map((e) => {
    const sDate = new Date(e.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const eDate = new Date(e.end_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `• ${e.summary} (${sDate} - ${eDate})`;
  }).join('\n');

  return `Reduan's schedule:\n${list}`;
}

export default {
  parseNaturalLanguageEvent,
  saveCalendarEvent,
  getUpcomingEvents,
  getCurrentRunningCalendarEvent,
  getScheduleSummaryForDate
};

