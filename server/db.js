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

  CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id);
  CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
`);

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
  return {
    autoReplyEnabled: getSetting('autoReplyEnabled', d.autoReplyEnabled),
    scheduleEnabled: getSetting('scheduleEnabled', d.scheduleEnabled),
    scheduleStart: getSetting('scheduleStart', d.scheduleStart),
    scheduleEnd: getSetting('scheduleEnd', d.scheduleEnd),
    timezone: getSetting('timezone', config.timezone),
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
  const rows = db
    .prepare(
      `SELECT direction, body, created_at FROM messages
       WHERE contact_id = ? AND direction IN ('in', 'out') AND status IN ('received', 'replied')
       ORDER BY id DESC LIMIT ?`
    )
    .all(contactId, limit * 2);
  return rows.reverse();
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
