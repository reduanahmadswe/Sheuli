import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function required(name, value) {
  if (!value) {
    // eslint-disable-next-line no-console
    console.warn(`[Sheuli] Warning: environment variable ${name} is not set.`);
  }
  return value;
}

// All PERSISTENT state (SQLite DB, WhatsApp session, backups, file logs) lives
// under STORAGE_DIR. Locally this defaults to the project root, so local dev
// needs zero extra setup and behaves exactly as before. On Railway, set
// STORAGE_DIR to the path where a persistent Volume is mounted (e.g.
// /app/storage) — everything outside a Volume is wiped on every deploy/restart,
// so this is what survives redeploys.
const storageDir = path.resolve(rootDir, process.env.STORAGE_DIR || './');

export const config = {
  rootDir,
  storageDir,
  dataDir: path.join(storageDir, 'data'),
  logsDir: path.join(storageDir, 'logs'),
  dbPath: path.join(storageDir, 'data', 'sheuli.db'),
  sessionAuthDir: path.join(storageDir, '.wwebjs_auth'),

  port: Number(process.env.PORT) || 3000,
  ownerName: process.env.OWNER_NAME || 'Reduan',
  timezone: process.env.TIMEZONE || 'Asia/Dhaka',

  openaiApiKey: required('OPENAI_API_KEY', process.env.OPENAI_API_KEY),
  dashboardPassword: required('DASHBOARD_PASSWORD', process.env.DASHBOARD_PASSWORD),
  sessionSecret: process.env.SESSION_SECRET || 'sheuli-dev-secret-change-me',

  isProduction: process.env.NODE_ENV === 'production',

  // FEATURE 1: Telegram alert channel. If either is empty, alerts.js silently no-ops.
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || ''
  },

  // FEATURE 3: automatic SQLite backups.
  backup: {
    dir: path.join(storageDir, 'backups'),
    time: process.env.BACKUP_TIME && /^\d{2}:\d{2}$/.test(process.env.BACKUP_TIME) ? process.env.BACKUP_TIME : '03:00',
    keep: 7
  },

  // FEATURE 2: gpt-4o-mini pricing constants used to compute real per-call cost
  // (per million tokens, USD). Update here if OpenAI changes pricing.
  pricing: {
    gpt4oMini: { inputPerMillion: 0.15, outputPerMillion: 0.6 }
  },

  defaults: {
    model: 'gpt-4o-mini',
    maxTokens: 150,
    temperature: 0.7,
    rateLimitPerHour: 10, // 0 = unlimited (rate limiting off) — see routes/settings.js validation
    memoryLength: 10,
    whitelistMode: false,
    autoReplyEnabled: false,
    mode: 'manual', // 'manual' | 'schedule'
    scheduleStart: '23:00',
    scheduleEnd: '07:30',
    scheduleDays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    costLimitDaily: 0.5,
    dailySummaryEnabled: true,
    dailySummaryTime: '08:00',
    dailySummarySkipIfEmpty: false,
    systemPrompt:
      'তোমার নাম Sheuli (শিউলি)। তুমি Reduan-এর personal AI assistant। Reduan এখন busy বা ঘুমাচ্ছে। ' +
      'ভদ্রভাবে, উষ্ণভাবে এবং সংক্ষেপে (১–২ লাইন) reply দাও। জরুরি বিষয় হলে call করতে বলো। ' +
      'Reduan-এর হয়ে কখনো কোনো promise বা commitment দিও না। কোনো personal/private তথ্য share করো না। ' +
      'কেউ অভদ্র আচরণ করলেও ভদ্র থাকো।\n\n' +
      'LANGUAGE RULE (VERY IMPORTANT — follow for EVERY reply):\n' +
      "Detect the language of the user's LATEST message and reply in the SAME language and SAME script.\n" +
      '- If the message is in Bangla script (e.g., "রেদুয়ান কোথায়?") → reply in Bangla script.\n' +
      '- If the message is in English (e.g., "Where is Reduan?") → reply in English.\n' +
      '- If the message is Banglish — Bangla words written in English letters (e.g., "reduan kothay?", "tumi ki free acho?") → reply in Banglish, i.e., Bangla words written in English letters. Do NOT reply in Bangla script and do NOT reply in formal English in this case.\n' +
      'Examples:\n' +
      'User: "রেদুয়ান কি ব্যস্ত?" → Sheuli: "জি, রেদুয়ান এখন ব্যস্ত আছেন। জরুরি হলে কল করতে পারেন 🌸"\n' +
      'User: "Is Reduan available now?" → Sheuli: "Hi! I\'m Sheuli, Reduan\'s AI assistant 🌸 He\'s busy right now. If it\'s urgent, please call him."\n' +
      'User: "reduan ke lagbe akto, o ki free ache?" → Sheuli: "Hi! Ami Sheuli, Reduan er AI assistant 🌸 O ekhon busy ache. Urgent hole call dite paren."\n\n' +
      'INTRODUCTION RULE:\n' +
      'Only introduce yourself (e.g., "Hi! I\'m Sheuli, Reduan\'s AI assistant 🌸") on the very first reply to a contact. ' +
      'Do NOT introduce yourself again if you have already introduced yourself earlier in this conversation history — reply directly to the new message instead.',
    fallbackMessage: 'Reduan এখন available নেই, পরে reply করবে। — Sheuli 🌸'
  }
};

export default config;
