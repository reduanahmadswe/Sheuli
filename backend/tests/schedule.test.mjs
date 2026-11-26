import assert from 'node:assert/strict';
import { isSheuliActive } from '../schedule.js';

const TZ = 'UTC'; // fixed zone for deterministic tests; the logic itself is timezone-agnostic

function utc(y, m, d, h, min) {
  return new Date(Date.UTC(y, m - 1, d, h, min));
}

function weekdayOf(date) {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(date);
}

// Find the next date (>= base) whose weekday matches `targetWeekday`, at the given UTC hour/minute.
function nextWeekdayAt(base, targetWeekday, hour, minute) {
  for (let i = 0; i < 8; i += 1) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + i, hour, minute));
    if (weekdayOf(d) === targetWeekday) return d;
  }
  throw new Error(`Could not find a ${targetWeekday} within a week of ${base.toISOString()}`);
}

let passed = 0;
let total = 0;

function check(label, actual, expected) {
  total += 1;
  const ok = actual === expected;
  if (ok) passed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} -> active=${actual} (expected ${expected})`);
  assert.equal(actual, expected, label);
}

console.log('--- Overnight window 23:00-07:30 (all days) ---');
{
  const settings = { mode: 'schedule', scheduleStart: '23:00', scheduleEnd: '07:30', timezone: TZ };
  const monday = nextWeekdayAt(new Date(), 'Mon', 23, 0);

  check('22:59 (just before start)', isSheuliActive(settings, new Date(monday.getTime() - 60000)), false);
  check('23:00 (exactly at start)', isSheuliActive(settings, monday), true);
  check('03:00 next day (deep overnight)', isSheuliActive(settings, new Date(monday.getTime() + 4 * 3600000)), true);
  check('07:30 next day (exactly at end)', isSheuliActive(settings, new Date(monday.getTime() + 8.5 * 3600000)), false);
  check('12:00 next day (well after end)', isSheuliActive(settings, new Date(monday.getTime() + 13 * 3600000)), false);
}

console.log('\n--- Normal window 09:00-17:00 (all days) ---');
{
  const settings = { mode: 'schedule', scheduleStart: '09:00', scheduleEnd: '17:00', timezone: TZ };
  const monday = nextWeekdayAt(new Date(), 'Mon', 9, 0);

  check('08:59 (just before start)', isSheuliActive(settings, new Date(monday.getTime() - 60000)), false);
  check('09:00 (exactly at start)', isSheuliActive(settings, monday), true);
  check('17:00 (exactly at end)', isSheuliActive(settings, new Date(monday.getTime() + 8 * 3600000)), false);
}

console.log('\n--- Day-of-week rollover for an overnight window restricted to Monday only ---');
{
  const settings = { mode: 'schedule', scheduleStart: '23:00', scheduleEnd: '07:30', scheduleDays: ['Mon'], timezone: TZ };
  const monday2300 = nextWeekdayAt(new Date(), 'Mon', 23, 0);
  const tue0300 = new Date(monday2300.getTime() + 4 * 3600000); // Tue 03:00 — still "Monday's window"
  const wed0300 = new Date(monday2300.getTime() + 28 * 3600000); // Wed 03:00 — NOT Monday's window

  check('Mon 23:00 (today=Mon, in list)', isSheuliActive(settings, monday2300), true);
  check('Tue 03:00 (belongs to Monday\'s window)', isSheuliActive(settings, tue0300), true);
  check('Wed 03:00 (belongs to Tuesday\'s window, not scheduled)', isSheuliActive(settings, wed0300), false);
}

console.log('\n--- Manual mode ignores schedule fields entirely ---');
{
  check('manual mode, autoReplyEnabled=true', isSheuliActive({ mode: 'manual', autoReplyEnabled: true }), true);
  check('manual mode, autoReplyEnabled=false', isSheuliActive({ mode: 'manual', autoReplyEnabled: false }), false);
}

console.log(`\n${passed}/${total} schedule test cases passed.`);

if (passed !== total) {
  process.exit(1);
}
