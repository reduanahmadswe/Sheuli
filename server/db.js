import fs from 'node:fs';
import Database from 'better-sqlite3';
import config from './config.js';
import logger from './logger.js';
import { getZonedDateKey, getZonedDayBoundsUtc, toSqliteUtc } from './schedule.js';

fs.mkdirSync(config.dataDir, { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    name TEXT,
    number TEXT,
    is_group INTEGER NOT NULL DEFAULT 0,
    blacklisted INTEGER NOT NULL DEFAULT 0,
    whitelisted INTEGER NOT NULL DEFAULT 0,
    message_count INTEGER NOT NULL DEFAULT 0,
    last_message_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id TEXT NOT NULL,
    contact_name TEXT,
    direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
    body TEXT,
    status TEXT NOT NULL DEFAULT 'received',
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS processed_messages (
    message_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS daily_costs (
    date TEXT PRIMARY KEY,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    estimated_cost REAL NOT NULL DEFAULT 0,
    limit_alert_sent INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    content TEXT NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0,
    replied_count INTEGER NOT NULL DEFAULT 0,
    contact_count INTEGER NOT NULL DEFAULT 0,
    trigger TEXT NOT NULL DEFAULT 'scheduled',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id);
  CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
`);

// ── Lightweight column migrations (SQLite has no "ADD COLUMN IF NOT EXISTS") ──

function ensureColumn(table, column, definition) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!existing.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('contacts', 'intro_sent', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('contacts', 'memory_cleared_at', 'TEXT');
ensureColumn('contacts', 'last_read_at', 'TEXT');

// One-time upgrade: earlier versions persisted a systemPrompt without the
// language-mirroring rule. If the stored value is still byte-for-byte that old
// default (i.e. the owner never customized it), refresh it to the current
// default so the language rule actually takes effect. A customized prompt is
// never touched.
const LEGACY_SYSTEM_PROMPT =
  'তোমার নাম Sheuli (শিউলি)। তুমি Reduan-এর personal AI assistant। Reduan এখন busy বা ঘুমাচ্ছে। ' +
  'ভদ্রভাবে, উষ্ণভাবে এবং সংক্ষেপে (১–২ লাইন) reply দাও। User বাংলায় লিখলে বাংলায়, ইংরেজিতে লিখলে ইংরেজিতে উত্তর দাও। ' +
  "কোনো contact-এর সাথে session-এর প্রথম reply-তে নিজের পরিচয় দাও, যেমন: 'হাই! আমি Sheuli, Reduan-এর AI assistant 🌸 ও এখন available নেই...'। " +
  'জরুরি বিষয় হলে call করতে বলো। Reduan-এর হয়ে কখনো কোনো promise বা commitment দিও না। কোনো personal/private তথ্য share করো না। ' +
  'কেউ অভদ্র আচরণ করলেও ভদ্র থাকো।';

{
  const storedPrompt = db.prepare('SELECT value FROM settings WHERE key = ?').get('systemPrompt');
  if (storedPrompt && storedPrompt.value === LEGACY_SYSTEM_PROMPT) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
      'systemPrompt',
      config.defaults.systemPrompt
    );
  }
}

// One-time upgrade: earlier versions hard-coded rateLimitPerHour's default at
// 3, which got persisted into the settings table on installs that never
// touched it. The new default is 10 — but config.defaults only applies when
// no row exists, so an existing "3" row would otherwise silently stick around
// forever. If the stored value is still exactly that old default (i.e. the
// owner never deliberately chose 3), bump it to the new default. A
// deliberately-chosen value (including a deliberately-chosen 3) is never touched.
const LEGACY_RATE_LIMIT_PER_HOUR = '3';

{
  const storedRateLimit = db.prepare('SELECT value FROM settings WHERE key = ?').get('rateLimitPerHour');
  if (storedRateLimit && storedRateLimit.value === LEGACY_RATE_LIMIT_PER_HOUR) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
      'rateLimitPerHour',
      String(config.defaults.rateLimitPerHour)
    );
  }
}

// FIX 4: on a brand-new database (e.g. a fresh Railway Volume with nothing on
// it yet), the settings table starts completely empty. getSetting()'s
// fallback already makes the app behave correctly either way, but that makes
// it genuinely hard to tell, from the outside, "is Sheuli using the default
// because nothing's been set, or did something just reset my config?". So on
// first run, explicitly persist (not just fall back to) the settings that
// most determine whether Sheuli does anything at all, and log exactly what
// got seeded — nothing is seeded silently.
{
  const FIRST_RUN_DEFAULTS = {
    autoReplyEnabled: config.defaults.autoReplyEnabled,
    mode: config.defaults.mode,
    rateLimitPerHour: config.defaults.rateLimitPerHour,
    costLimitDaily: config.defaults.costLimitDaily,
    dailySummaryTime: config.defaults.dailySummaryTime
  };

  const seeded = {};
  for (const [key, value] of Object.entries(FIRST_RUN_DEFAULTS)) {
    const existing = db.prepare('SELECT 1 FROM settings WHERE key = ?').get(key);
    if (!existing) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
        key,
        typeof value === 'string' ? value : JSON.stringify(value)
      );
      seeded[key] = value;
    }
  }

  if (Object.keys(seeded).length > 0) {
    logger.info({ seeded }, '🌱 Fresh database detected — seeded first-run default settings');
  }
}

// ── Settings ────────────────────────────────────────────────────────────

const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSettingStmt = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

export function getSetting(key, fallback = null) {
  const row = getSettingStmt.get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

export function setSetting(key, value) {
  setSettingStmt.run(key, typeof value === 'string' ? value : JSON.stringify(value));
  return value;
}

export function getAllSettings() {
  const d = config.defaults;
  // Legacy fallback: earlier versions stored a plain `scheduleEnabled` boolean.
  // If a `mode` key hasn't been explicitly saved yet, honor that old value once
  // so upgrading doesn't silently switch someone from schedule back to manual.
  const legacyScheduleEnabled = getSetting('scheduleEnabled', false);
  const defaultMode = legacyScheduleEnabled ? 'schedule' : d.mode;

  return {
    autoReplyEnabled: getSetting('autoReplyEnabled', d.autoReplyEnabled),
    mode: getSetting('mode', defaultMode),
    scheduleStart: getSetting('scheduleStart', d.scheduleStart),
    scheduleEnd: getSetting('scheduleEnd', d.scheduleEnd),
    scheduleDays: getSetting('scheduleDays', d.scheduleDays),
    // Timezone always comes from the server's TIMEZONE env var, never a stored
    // setting — the VPS may run in a different zone than the schedule expects.
    timezone: config.timezone,
    systemPrompt: getSetting('systemPrompt', d.systemPrompt),
    rateLimitPerHour: getSetting('rateLimitPerHour', d.rateLimitPerHour),
    whitelistMode: getSetting('whitelistMode', d.whitelistMode),
    model: getSetting('model', d.model),
    costLimitDaily: getSetting('costLimitDaily', d.costLimitDaily),
    dailySummaryEnabled: getSetting('dailySummaryEnabled', d.dailySummaryEnabled),
    dailySummaryTime: getSetting('dailySummaryTime', d.dailySummaryTime),
    dailySummarySkipIfEmpty: getSetting('dailySummarySkipIfEmpty', d.dailySummarySkipIfEmpty),
    lastSummaryAt: getSetting('lastSummaryAt', null)
  };
}

// ── Contacts ────────────────────────────────────────────────────────────

const upsertContactStmt = db.prepare(`
  INSERT INTO contacts (id, name, number, is_group)
  VALUES (@id, @name, @number, @isGroup)
  ON CONFLICT(id) DO UPDATE SET
    name = COALESCE(excluded.name, contacts.name),
    number = COALESCE(excluded.number, contacts.number)
`);

const touchContactStmt = db.prepare(`
  UPDATE contacts
  SET message_count = message_count + 1, last_message_at = datetime('now')
  WHERE id = ?
`);

const getContactStmt = db.prepare('SELECT * FROM contacts WHERE id = ?');

export function upsertContact({ id, name, number, isGroup = false }) {
  upsertContactStmt.run({ id, name: name ?? null, number: number ?? null, isGroup: isGroup ? 1 : 0 });
  return getContactStmt.get(id);
}

export function touchContact(id) {
  touchContactStmt.run(id);
}

export function getContact(id) {
  return getContactStmt.get(id);
}

export function listContacts(search = '') {
  if (search) {
    return db
      .prepare(
        `SELECT * FROM contacts
         WHERE name LIKE ? OR number LIKE ?
         ORDER BY last_message_at DESC NULLS LAST`
      )
      .all(`%${search}%`, `%${search}%`);
  }
  return db.prepare('SELECT * FROM contacts ORDER BY last_message_at DESC NULLS LAST').all();
}

export function setContactFlag(id, field, value) {
  if (!['blacklisted', 'whitelisted'].includes(field)) {
    throw new Error(`Invalid contact flag: ${field}`);
  }
  db.prepare(`UPDATE contacts SET ${field} = ? WHERE id = ?`).run(value ? 1 : 0, id);
  return getContactStmt.get(id);
}

export function setIntroSent(id, value) {
  db.prepare('UPDATE contacts SET intro_sent = ? WHERE id = ?').run(value ? 1 : 0, id);
}

export function clearContactMemory(id) {
  db.prepare("UPDATE contacts SET memory_cleared_at = datetime('now'), intro_sent = 0 WHERE id = ?").run(id);
  return getContactStmt.get(id);
}

export function markContactRead(id) {
  db.prepare("UPDATE contacts SET last_read_at = datetime('now') WHERE id = ?").run(id);
}

const HOURS_24_MS = 24 * 60 * 60 * 1000;

export function isIntroDue(contact) {
  if (!contact) return true;
  if (!contact.intro_sent) return true;
  if (!contact.last_message_at) return false;
  const lastMessageMs = Date.parse(`${contact.last_message_at.replace(' ', 'T')}Z`);
  if (Number.isNaN(lastMessageMs)) return false;
  return Date.now() - lastMessageMs > HOURS_24_MS;
}

// The chat-list preview must always show real message text, never an empty
// skip placeholder (rate_limited, blacklisted, etc. all log an empty-body
// row). `lm` picks the most recent message that actually has body text for
// the preview/timestamp; `latest` (any row, including skips) still drives the
// sort order so a contact who just triggered a skip event still bubbles up.
export function getChats(search = '') {
  const pattern = `%${search}%`;
  return db
    .prepare(
      `SELECT
         c.id AS contactId,
         c.name,
         c.number,
         c.blacklisted,
         c.whitelisted,
         lm.body AS lastMessageBody,
         lm.direction AS lastMessageDirection,
         lm.status AS lastMessageStatus,
         lm.created_at AS lastMessageAt,
         COALESCE((
           SELECT COUNT(*) FROM messages um
           WHERE um.contact_id = c.id AND um.direction = 'in'
           AND um.created_at > COALESCE(c.last_read_at, '0001-01-01 00:00:00')
         ), 0) AS unreadCount
       FROM contacts c
       LEFT JOIN messages lm ON lm.id = (
         SELECT id FROM messages
         WHERE contact_id = c.id AND body IS NOT NULL AND body != ''
         ORDER BY id DESC LIMIT 1
       )
       LEFT JOIN messages latest ON latest.id = (
         SELECT id FROM messages WHERE contact_id = c.id ORDER BY id DESC LIMIT 1
       )
       WHERE c.is_group = 0 AND (c.name LIKE ? OR c.number LIKE ?)
       ORDER BY COALESCE(latest.created_at, c.created_at) DESC`
    )
    .all(pattern, pattern);
}

export function getContactMessages(contactId, { limit = 50, beforeId } = {}) {
  let rows;
  if (beforeId) {
    rows = db
      .prepare('SELECT * FROM messages WHERE contact_id = ? AND id < ? ORDER BY id DESC LIMIT ?')
      .all(contactId, beforeId, limit);
  } else {
    rows = db.prepare('SELECT * FROM messages WHERE contact_id = ? ORDER BY id DESC LIMIT ?').all(contactId, limit);
  }
  return rows.reverse();
}

// ── Messages / logs ─────────────────────────────────────────────────────

const insertMessageStmt = db.prepare(`
  INSERT INTO messages (contact_id, contact_name, direction, body, status, prompt_tokens, completion_tokens)
  VALUES (@contactId, @contactName, @direction, @body, @status, @promptTokens, @completionTokens)
`);

export function logMessage({
  contactId,
  contactName = null,
  direction,
  body = '',
  status = 'received',
  promptTokens = 0,
  completionTokens = 0
}) {
  const info = insertMessageStmt.run({
    contactId,
    contactName,
    direction,
    body,
    status,
    promptTokens,
    completionTokens
  });
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
}

export function getRecentConversation(contactId, limit = 10) {
  const contact = getContactStmt.get(contactId);
  const clearedAt = contact?.memory_cleared_at || '0001-01-01 00:00:00';
  const rows = db
    .prepare(
      `SELECT direction, body, created_at FROM messages
       WHERE contact_id = ? AND direction IN ('in', 'out') AND status IN ('received', 'replied')
       AND created_at > ?
       ORDER BY id DESC LIMIT ?`
    )
    .all(contactId, clearedAt, limit * 2);
  return rows.reverse();
}

// ── Processed message de-duplication ───────────────────────────────────

const hasProcessedMessageStmt = db.prepare('SELECT 1 FROM processed_messages WHERE message_id = ?');
const markProcessedMessageStmt = db.prepare(
  'INSERT OR IGNORE INTO processed_messages (message_id) VALUES (?)'
);

export function hasProcessedMessage(messageId) {
  return Boolean(hasProcessedMessageStmt.get(messageId));
}

export function markMessageProcessed(messageId) {
  markProcessedMessageStmt.run(messageId);
}

export function countRepliesInLastHour(contactId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM messages
       WHERE contact_id = ? AND direction = 'out' AND status = 'replied'
       AND created_at >= datetime('now', '-1 hours')`
    )
    .get(contactId);
  return row.count;
}

export function getLogs({ status, contactId, limit = 200, offset = 0 } = {}) {
  let query = 'SELECT * FROM messages WHERE 1=1';
  const params = [];
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  if (contactId) {
    query += ' AND contact_id = ?';
    params.push(contactId);
  }
  query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return db.prepare(query).all(...params);
}

// "Today" here always means the local calendar day in config.timezone
// (Asia/Dhaka by default), not raw UTC — so this lines up with the cost guard
// (FEATURE 2), which resets at local midnight, not server/UTC midnight.
export function getTodayStats() {
  const now = new Date();
  const { startUtc, endUtc } = getZonedDayBoundsUtc(now, config.timezone);
  const startStr = toSqliteUtc(startUtc);
  const endStr = toSqliteUtc(endUtc);

  const received = db
    .prepare("SELECT COUNT(*) AS c FROM messages WHERE direction = 'in' AND created_at >= ? AND created_at < ?")
    .get(startStr, endStr).c;
  const replied = db
    .prepare(
      "SELECT COUNT(*) AS c FROM messages WHERE direction = 'out' AND status = 'replied' AND created_at >= ? AND created_at < ?"
    )
    .get(startStr, endStr).c;
  const activeConversations = db
    .prepare('SELECT COUNT(DISTINCT contact_id) AS c FROM messages WHERE created_at >= ? AND created_at < ?')
    .get(startStr, endStr).c;

  const dateKey = getZonedDateKey(now, config.timezone);
  const cost = getDailyCost(dateKey);
  const costLimitDaily = Number(getSetting('costLimitDaily', config.defaults.costLimitDaily));

  return {
    messagesReceived: received,
    repliesSent: replied,
    activeConversations,
    estimatedCostToday: Number(cost.estimatedCost.toFixed(4)),
    costLimitDaily,
    costLimitReached: cost.estimatedCost >= costLimitDaily
  };
}

// ── FEATURE 2: daily API cost tracking ─────────────────────────────────────
// Keyed by local calendar date (config.timezone) so the total naturally resets
// at local midnight — no separate reset job needed, a new date just starts a
// fresh row.

export function getDailyCost(date) {
  const row = db.prepare('SELECT * FROM daily_costs WHERE date = ?').get(date);
  if (!row) {
    return { date, promptTokens: 0, completionTokens: 0, estimatedCost: 0, limitAlertSent: false };
  }
  return {
    date: row.date,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    estimatedCost: row.estimated_cost,
    limitAlertSent: Boolean(row.limit_alert_sent)
  };
}

const upsertDailyCostStmt = db.prepare(`
  INSERT INTO daily_costs (date, prompt_tokens, completion_tokens, estimated_cost)
  VALUES (@date, @promptTokens, @completionTokens, @cost)
  ON CONFLICT(date) DO UPDATE SET
    prompt_tokens = prompt_tokens + excluded.prompt_tokens,
    completion_tokens = completion_tokens + excluded.completion_tokens,
    estimated_cost = estimated_cost + excluded.estimated_cost
`);

export function addDailyCost(date, promptTokens, completionTokens, cost) {
  upsertDailyCostStmt.run({ date, promptTokens, completionTokens, cost });
  return getDailyCost(date);
}

export function markCostAlertSent(date) {
  db.prepare(
    `INSERT INTO daily_costs (date, limit_alert_sent) VALUES (?, 1)
     ON CONFLICT(date) DO UPDATE SET limit_alert_sent = 1`
  ).run(date);
}

// ── FEATURE 4: daily summary ───────────────────────────────────────────────

export function insertSummary({ periodStart, periodEnd, content, messageCount, repliedCount, contactCount, trigger }) {
  const info = db
    .prepare(
      `INSERT INTO summaries (period_start, period_end, content, message_count, replied_count, contact_count, trigger)
       VALUES (@periodStart, @periodEnd, @content, @messageCount, @repliedCount, @contactCount, @trigger)`
    )
    .run({ periodStart, periodEnd, content, messageCount, repliedCount, contactCount, trigger });
  return db.prepare('SELECT * FROM summaries WHERE id = ?').get(info.lastInsertRowid);
}

export function listSummaries({ limit = 30, offset = 0 } = {}) {
  return db.prepare('SELECT * FROM summaries ORDER BY id DESC LIMIT ? OFFSET ?').all(limit, offset);
}

// Personal (non-group) chat messages in (sinceIso, untilIso], for the daily
// summary generator. Only real conversation turns are included — the empty-body
// skip rows (rate_limited, blacklisted, etc.) are deliberately excluded.
export function getMessagesForSummary(sinceIso, untilIso) {
  return db
    .prepare(
      `SELECT m.contact_id AS contactId, m.contact_name AS contactName, m.direction, m.body, m.status, m.created_at AS createdAt
       FROM messages m
       JOIN contacts c ON c.id = m.contact_id
       WHERE c.is_group = 0
         AND m.created_at > ? AND m.created_at <= ?
         AND ((m.direction = 'in' AND m.status = 'received') OR (m.direction = 'out' AND m.status = 'replied'))
       ORDER BY m.contact_id, m.id ASC`
    )
    .all(sinceIso, untilIso);
}

// Called on graceful shutdown (SIGTERM/SIGINT) so WAL data is checkpointed
// and the file handle is released cleanly before the process exits.
export function closeDb() {
  db.close();
}

// ── FIX 5: diagnostics ──────────────────────────────────────────────────

export function getMessageCount() {
  return db.prepare('SELECT COUNT(*) AS c FROM messages').get().c;
}

export function getLastMessageTimestamps() {
  const lastIncoming = db
    .prepare("SELECT created_at FROM messages WHERE direction = 'in' AND status = 'received' ORDER BY id DESC LIMIT 1")
    .get();
  const lastReply = db
    .prepare("SELECT created_at FROM messages WHERE direction = 'out' AND status = 'replied' ORDER BY id DESC LIMIT 1")
    .get();
  return {
    lastIncomingAt: lastIncoming?.created_at || null,
    lastReplyAt: lastReply?.created_at || null
  };
}

export default db;
