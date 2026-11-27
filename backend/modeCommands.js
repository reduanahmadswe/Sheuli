// Switching modes from the "Message Yourself" chat: "/" lists them, "/5" or
// "/lunch" picks one, and an optional time ("/lunch 30m", "/5 2h") ends it.
import { MODES } from './modes.js';

// The order here fixes each mode's number in the list.
const GROUPS = [
  ['Office', ['normal', 'office', 'focus', 'presentation', 'onlinemeeting', 'meeting', 'coding', 'lunch', 'deadline', 'wfh', 'leave', 'oncall']],
  ['Student', ['class', 'study', 'exam', 'lab', 'reading']],
  ['Travel', ['commute', 'driving', 'travel', 'outdoors', 'rainy']]
];
const listed = new Set(GROUPS.flatMap(([, ids]) => ids));
GROUPS.splice(1, 0, ['Personal', Object.keys(MODES).filter((id) => !listed.has(id))]);

export const MODE_ORDER = GROUPS.flatMap(([, ids]) => ids);

const simplify = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

export function buildModeList(activeMode) {
  let number = 0;
  const sections = GROUPS.map(([title, ids]) => {
    const lines = ids.map((id) => {
      number += 1;
      return `${number}. ${MODES[id].name}${id === activeMode ? ' (now)' : ''}`;
    });
    return `*${title}*\n${lines.join('\n')}`;
  });
  return `*Modes*\n\n${sections.join('\n\n')}\n\nSend /number or /name. Add a time if you like: /8 30m or /lunch 1h`;
}

// Returns { type: 'list' }, { type: 'set', id, minutes } or { type: 'unknown' }.
export function parseModeCommand(body) {
  let text = body.trim().slice(1).trim();
  if (['', 'mode', 'modes', 'list'].includes(text.toLowerCase())) return { type: 'list' };

  let minutes = 0;
  const time = text.match(/\s+(\d+)\s*(m|min|mins|h|hr|hrs|hour|hours)$/i);
  if (time) {
    minutes = Number(time[1]) * (time[2].toLowerCase().startsWith('h') ? 60 : 1);
    text = text.slice(0, time.index).trim();
    if (minutes < 1 || minutes > 1440) return { type: 'unknown' };
  }

  const wanted = simplify(text);
  const id = /^\d+$/.test(text)
    ? MODE_ORDER[Number(text) - 1]
    : wanted && MODE_ORDER.find((key) => key === wanted || simplify(MODES[key].name) === wanted);

  return id ? { type: 'set', id, minutes } : { type: 'unknown' };
}
