import fs from 'node:fs';
import Database from 'better-sqlite3';
import config from './config.js';

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
    model: getSetting('model', d.model)
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
         SELECT id FROM messages WHERE contact_id = c.id ORDER BY id DESC LIMIT 1
       )
       WHERE c.is_group = 0 AND (c.name LIKE ? OR c.number LIKE ?)
       ORDER BY COALESCE(lm.created_at, c.created_at) DESC`
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

export function getTodayStats() {
  const today = new Date().toISOString().slice(0, 10);
  const received = db
    .prepare("SELECT COUNT(*) AS c FROM messages WHERE direction = 'in' AND created_at >= ?")
    .get(today).c;
  const replied = db
    .prepare("SELECT COUNT(*) AS c FROM messages WHERE direction = 'out' AND status = 'replied' AND created_at >= ?")
    .get(today).c;
  const activeConversations = db
    .prepare('SELECT COUNT(DISTINCT contact_id) AS c FROM messages WHERE created_at >= ?')
    .get(today).c;
  const tokenRow = db
    .prepare(
      `SELECT COALESCE(SUM(prompt_tokens), 0) AS promptTokens, COALESCE(SUM(completion_tokens), 0) AS completionTokens
       FROM messages WHERE created_at >= ?`
    )
    .get(today);

  // gpt-4o-mini approximate pricing per 1M tokens
  const inputCostPerM = 0.15;
  const outputCostPerM = 0.6;
  const estimatedCost =
    (tokenRow.promptTokens / 1_000_000) * inputCostPerM + (tokenRow.completionTokens / 1_000_000) * outputCostPerM;

  return {
    messagesReceived: received,
    repliesSent: replied,
    activeConversations,
    estimatedCostToday: Number(estimatedCost.toFixed(4))
  };
}

export default db;
