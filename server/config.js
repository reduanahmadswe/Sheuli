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

export const config = {
  rootDir,
  dataDir: path.join(rootDir, 'data'),
  logsDir: path.join(rootDir, 'logs'),
  dbPath: path.join(rootDir, 'data', 'sheuli.db'),
  sessionAuthDir: path.join(rootDir, 'data', 'wwebjs_auth'),

  port: Number(process.env.PORT) || 3000,
  ownerName: process.env.OWNER_NAME || 'Reduan',
  timezone: process.env.TIMEZONE || 'Asia/Dhaka',

  openaiApiKey: required('OPENAI_API_KEY', process.env.OPENAI_API_KEY),
  dashboardPassword: required('DASHBOARD_PASSWORD', process.env.DASHBOARD_PASSWORD),
  sessionSecret: process.env.SESSION_SECRET || 'sheuli-dev-secret-change-me',

  isProduction: process.env.NODE_ENV === 'production',

  defaults: {
    model: 'gpt-4o-mini',
    maxTokens: 150,
    temperature: 0.7,
    rateLimitPerHour: 3,
    memoryLength: 10,
    whitelistMode: false,
    autoReplyEnabled: false,
    scheduleEnabled: false,
    scheduleStart: '00:00',
    scheduleEnd: '08:00',
    systemPrompt:
      'তোমার নাম Sheuli (শিউলি)। তুমি Reduan-এর personal AI assistant। Reduan এখন busy বা ঘুমাচ্ছে। ' +
      'ভদ্রভাবে, উষ্ণভাবে এবং সংক্ষেপে (১–২ লাইন) reply দাও। User বাংলায় লিখলে বাংলায়, ইংরেজিতে লিখলে ইংরেজিতে উত্তর দাও। ' +
      "কোনো contact-এর সাথে session-এর প্রথম reply-তে নিজের পরিচয় দাও, যেমন: 'হাই! আমি Sheuli, Reduan-এর AI assistant 🌸 ও এখন available নেই...'। " +
      'জরুরি বিষয় হলে call করতে বলো। Reduan-এর হয়ে কখনো কোনো promise বা commitment দিও না। কোনো personal/private তথ্য share করো না। ' +
      'কেউ অভদ্র আচরণ করলেও ভদ্র থাকো।',
    fallbackMessage: 'Reduan এখন available নেই, পরে reply করবে। — Sheuli 🌸'
  }
};

export default config;
