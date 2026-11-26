import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(rootDir, '.env') });

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

  // FIX 2 (v12): only pin a specific WhatsApp Web version if WA_WEB_VERSION is
  // explicitly set. A hardcoded fallback here previously went stale — WhatsApp
  // stopped accepting that version, so pairing would succeed and then the
  // server would immediately unpair us (reason: LOGOUT). Leaving this unset
  // lets whatsapp-web.js fall through to its own default behavior, which
  // serves the live/current WhatsApp Web page instead of a frozen one. Only
  // set WA_WEB_VERSION again if a future WhatsApp update breaks compatibility
  // and a specific known-good version (see
  // https://github.com/wppconnect-team/wa-version/tree/main/html) is needed
  // as a stopgap.
  pinnedWebVersion: process.env.WA_WEB_VERSION || null,

  port: Number(process.env.PORT) || 3000,
  timezone: process.env.TIMEZONE || 'Asia/Dhaka',

  openaiApiKey: required('OPENAI_API_KEY', process.env.OPENAI_API_KEY),
  dashboardPassword: required('DASHBOARD_PASSWORD', process.env.DASHBOARD_PASSWORD),
  sessionSecret: process.env.SESSION_SECRET || 'sheuli-dev-secret-change-me',

  isProduction: process.env.NODE_ENV === 'production',


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
    autoReplyEnabled: false,
    mode: 'manual', // 'manual' | 'schedule'
    scheduleStart: '23:00',
    scheduleEnd: '07:30',
    scheduleDays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    costLimitDaily: 0.5,
    dailySummaryEnabled: true,
    dailySummaryTime: '08:00',
    dailySummarySkipIfEmpty: false,
    assistantName: 'Sheuli'
  }
};

export default config;
