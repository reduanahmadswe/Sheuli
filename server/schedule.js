// Pure schedule-evaluation logic, kept dependency-free (no db.js / whatsapp.js
// imports) so it can be unit tested directly (see server/tests/schedule.test.mjs).
//
// The core rule: isSheuliActive(settings, now) is a pure function re-evaluated
// on every incoming message — there is no timer that "flips a flag" and could
// drift or be missed across a restart. A timer may exist elsewhere purely to
// push a fresh status to the dashboard; it must never be the source of truth.

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DEFAULT_DAYS = [...WEEKDAYS];

function previousWeekday(weekday) {
  const i = WEEKDAYS.indexOf(weekday);
  if (i === -1) return weekday;
  return WEEKDAYS[(i + 6) % 7];
}

export function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

export function getZonedParts(date, timezone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const parts = fmt.formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { weekday: map.weekday, time: `${map.hour}:${map.minute}` };
}

/**
 * Is `now` inside the configured schedule window, honoring day-of-week and
 * overnight (start > end) windows correctly? An overnight window like
 * 23:00-07:30 on "Mon" is still considered Monday's window during the
 * post-midnight portion (e.g. Tue 03:00) — the day check for that portion
 * looks at *yesterday's* weekday, not today's.
 */
export function isWithinScheduleWindow({ scheduleStart, scheduleEnd, scheduleDays, timezone }, now = new Date()) {
  const days = Array.isArray(scheduleDays) && scheduleDays.length ? scheduleDays : DEFAULT_DAYS;
  const { weekday, time } = getZonedParts(now, timezone);
  const startMin = toMinutes(scheduleStart);
  const endMin = toMinutes(scheduleEnd);
  const curMin = toMinutes(time);

  if (startMin === endMin) {
    // Degenerate window (start === end): treat as "always on" for the configured days only.
    return days.includes(weekday);
  }

  if (startMin < endMin) {
    // Same-day window, e.g. 09:00-17:00
    return days.includes(weekday) && curMin >= startMin && curMin < endMin;
  }

  // Overnight window, e.g. 23:00-07:30
  if (curMin >= startMin) {
    // Evening portion belongs to TODAY's scheduled day
    return days.includes(weekday);
  }
  if (curMin < endMin) {
    // Early-morning portion belongs to YESTERDAY's scheduled day
    return days.includes(previousWeekday(weekday));
  }
  return false;
}

export function isSheuliActive(settings, now = new Date()) {
  if (settings.mode === 'schedule') {
    return isWithinScheduleWindow(settings, now);
  }
  return Boolean(settings.autoReplyEnabled);
}

/**
 * Bounded simulation (minute resolution, up to 7 days ahead) to find when the
 * active/inactive state will next flip. Only used for dashboard display, never
 * for enforcement — enforcement always re-evaluates isSheuliActive() live.
 */
export function computeNextChange(settings, now = new Date()) {
  const currentActive = isSheuliActive(settings, now);
  const MAX_MINUTES = 7 * 24 * 60;
  for (let i = 1; i <= MAX_MINUTES; i += 1) {
    const check = new Date(now.getTime() + i * 60000);
    if (isSheuliActive(settings, check) !== currentActive) {
      return check;
    }
  }
  return null;
}

export function getScheduleStatus(settings, now = new Date()) {
  const active = isSheuliActive(settings, now);
  const status = { mode: settings.mode, active };

  if (settings.mode === 'schedule') {
    const nextChange = computeNextChange(settings, now);
    status.nextChangeAt = nextChange ? nextChange.toISOString() : null;
    status.scheduleStart = settings.scheduleStart;
    status.scheduleEnd = settings.scheduleEnd;
    status.scheduleDays = Array.isArray(settings.scheduleDays) && settings.scheduleDays.length
      ? settings.scheduleDays
      : DEFAULT_DAYS;
    status.timezone = settings.timezone;
  }

  return status;
}

export default {
  WEEKDAYS,
  DEFAULT_DAYS,
  toMinutes,
  getZonedParts,
  isWithinScheduleWindow,
  isSheuliActive,
  computeNextChange,
  getScheduleStatus
};
