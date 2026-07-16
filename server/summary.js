// FEATURE 4: 🌅 Daily Summary. Collects everything that happened in personal
// chats since the last summary, condenses it with gpt-4o-mini (chunking in
// stages if the transcript is long), and sends the result to the owner's own
// "Message Yourself" WhatsApp chat. Triggered by a scheduled time-of-day
// check (jobs.js), a startup catch-up check (jobs.js), or the on-demand
// `/summary` command (whatsapp.js).

import config from './config.js';
import logger from './logger.js';
import { openai } from './ai.js';
import { recordApiCost } from './costGuard.js';
import { sendSelfMessage } from './whatsapp.js';
import { getZonedDateKey, toSqliteUtc } from './schedule.js';
import { getSetting, setSetting, getMessagesForSummary, insertSummary } from './db.js';

let ioRef = null;

export function setSocketIo(io) {
  ioRef = io;
}

const CHUNK_CHAR_LIMIT = 6000;
const MAX_SUMMARY_CHARS = 3500; // safety net well above the ~1500-char guidance given to the model
const EMPTY_FRIENDLY_MESSAGE = '🌸 Good morning! No messages while you were away.';

const BANGLA_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
function toBanglaNumber(n) {
  return String(n)
    .split('')
    .map((ch) => (/\d/.test(ch) ? BANGLA_DIGITS[Number(ch)] : ch))
    .join('');
}

function formatSummaryDateLabel(date, timezone) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, day: 'numeric', month: 'long' }).format(date);
}

function formatZonedTime(sqliteUtcStr, timezone) {
  const iso = `${sqliteUtcStr.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(d);
}

// Groups the flat (contact, message) rows by contact and pairs each incoming
// message with whether the very next message from that contact was Sheuli's
// reply — a simple, reliable "was this replied to" heuristic given how
// messages are logged (in, then out, in order).
function buildTranscript(rows, timezone) {
  const byContact = new Map();
  for (const row of rows) {
    if (!byContact.has(row.contactId)) byContact.set(row.contactId, []);
    byContact.get(row.contactId).push(row);
  }

  const contactBlocks = [];
  let totalIncoming = 0;
  let totalReplied = 0;

  for (const [contactId, msgs] of byContact) {
    const contactName = msgs.find((m) => m.contactName)?.contactName || contactId;
    const lines = [];
    for (let i = 0; i < msgs.length; i += 1) {
      const m = msgs[i];
      if (m.direction !== 'in') continue;
      totalIncoming += 1;
      const next = msgs[i + 1];
      const replied = Boolean(next && next.direction === 'out' && next.status === 'replied');
      if (replied) totalReplied += 1;
      const time = formatZonedTime(m.createdAt, timezone);
      const body = (m.body || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      lines.push(`- [${time}] "${body}" (Sheuli replied: ${replied ? 'yes' : 'no'})`);
    }
    if (lines.length) {
      contactBlocks.push({ contactId, contactName, text: `Contact: ${contactName}\n${lines.join('\n')}` });
    }
  }

  return { contactBlocks, totalIncoming, totalReplied, contactCount: contactBlocks.length };
}

// Greedily packs whole contact blocks into chunks under the char limit —
// never splits a single contact's messages across two chunks (unless that
// contact's block alone already exceeds the limit, in which case it gets its
// own oversized chunk).
function chunkContactBlocks(contactBlocks, limit = CHUNK_CHAR_LIMIT) {
  const chunks = [];
  let current = [];
  let currentLen = 0;

  for (const block of contactBlocks) {
    if (current.length && currentLen + block.text.length > limit) {
      chunks.push(current.map((b) => b.text).join('\n\n'));
      current = [];
      currentLen = 0;
    }
    current.push(block);
    currentLen += block.text.length;
  }
  if (current.length) chunks.push(current.map((b) => b.text).join('\n\n'));

  return chunks;
}

async function trackUsage(usage) {
  try {
    await recordApiCost(usage?.prompt_tokens || 0, usage?.completion_tokens || 0);
  } catch (err) {
    logger.warn({ err: err?.message || err }, 'Failed to record daily-summary API cost');
  }
}

const STAGE_ONE_SYSTEM_PROMPT =
  'তুমি Sheuli, Reduan-এর WhatsApp assistant। নিচে কিছু contact-এর সাথে হওয়া message-এর তালিকা দেওয়া আছে। ' +
  'প্রতিটা contact-এর জন্য সংক্ষিপ্ত bullet note বানাও (বাংলায়) — কী নিয়ে কথা হয়েছে, কোনো জরুরি/action দরকার কিনা। ' +
  'শুধু দেওয়া তথ্য থেকেই লিখবে, কিছু বানিয়ে লিখবে না। প্রতিটা contact-এর নাম অবশ্যই রাখবে।';

// Stage 1 (only used when the raw transcript is too long for one call):
// condenses one chunk of contacts' messages into short Bangla bullet notes.
async function callStageOneSummary(chunkText) {
  const completion = await openai.chat.completions.create({
    model: config.defaults.model,
    messages: [
      { role: 'system', content: STAGE_ONE_SYSTEM_PROMPT },
      { role: 'user', content: chunkText }
    ],
    max_tokens: 500,
    temperature: 0.3
  });

  await trackUsage(completion.usage);
  return completion.choices?.[0]?.message?.content?.trim() || '';
}

const FINAL_SUMMARY_SYSTEM_PROMPT = `তুমি Sheuli, Reduan-এর personal WhatsApp assistant। নিচে গত পর্বে আসা message-গুলোর তথ্য দেওয়া আছে, contact অনুযায়ী গ্রুপ করা, প্রতিটার সাথে Sheuli reply দিয়েছে কিনা তা বলা আছে।

তোমার কাজ: এই তথ্য থেকে Reduan-এর জন্য একটা সংক্ষিপ্ত বাংলা summary বানানো, নিচের তিনটা section-এ ভাগ করে (ঠিক এই heading-গুলো ব্যবহার করবে, heading না বদলে):

🔴 গুরুত্বপূর্ণ / action দরকার:
🟡 Reply করা ভালো:
⚪ Casual / কিছু করা লাগবে না:

Rules (অবশ্যই মানতে হবে):
- শুধু নিচে দেওয়া তথ্য থেকেই লিখবে, কোনো message বা contact কখনো বানিয়ে লিখবে না।
- প্রতিটা bullet এক লাইনে রাখবে, "• নাম — বিস্তারিত" এই format-এ।
- ⚪ Casual section-এ প্রতিটা contact আলাদা bullet না দিয়ে একসাথে সংক্ষেপে বলবে, যেমন "• ৮ জন — সালাম/হাই ধরনের message, reply দেওয়া হয়েছে।"
- স্বাভাবিক, কথ্য বাংলায় লিখবে (রেদুয়ানের নিজের ভাষার মতো)।
- পুরো output অবশ্যই ১৫০০ character-এর মধ্যে রাখবে।
- শুধু উপরের তিনটা section-ই output করবে — অন্য কোনো heading, ভূমিকা, conclusion, বা "মোট" সংখ্যা লিখবে না (সেটা আলাদাভাবে যোগ করা হবে)।
- কোনো section-এর জন্য কিছু না থাকলে সেই section পুরোপুরি বাদ দিয়ে দাও।`;

async function callFinalGrouping(sourceText) {
  const completion = await openai.chat.completions.create({
    model: config.defaults.model,
    messages: [
      { role: 'system', content: FINAL_SUMMARY_SYSTEM_PROMPT },
      { role: 'user', content: sourceText }
    ],
    max_tokens: 800,
    temperature: 0.4
  });

  await trackUsage(completion.usage);

  const text = completion.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Empty completion from OpenAI for daily summary');
  return text;
}

// Pure-ish builder: collects the period's messages and produces the final
// Bangla summary text (or reports that the period was empty). Does not send
// anything or touch settings — that's runDailySummary's job.
export async function buildDailySummaryText({ sinceIso, untilIso, now }) {
  const rows = getMessagesForSummary(sinceIso, untilIso);
  const { contactBlocks, totalIncoming, totalReplied, contactCount } = buildTranscript(rows, config.timezone);

  if (contactBlocks.length === 0) {
    return { isEmpty: true, messageCount: 0, repliedCount: 0, contactCount: 0, text: null };
  }

  const rawText = contactBlocks.map((b) => b.text).join('\n\n');
  let sourceText = rawText;

  if (rawText.length > CHUNK_CHAR_LIMIT) {
    const chunks = chunkContactBlocks(contactBlocks);
    const stageOneOutputs = [];
    for (const chunk of chunks) {
      // Sequential on purpose — keeps this within the daily cost guard's spirit
      // (no burst of parallel calls) and preserves contact ordering.
      // eslint-disable-next-line no-await-in-loop
      stageOneOutputs.push(await callStageOneSummary(chunk));
    }
    sourceText = stageOneOutputs.join('\n\n');
  }

  const body = await callFinalGrouping(sourceText);

  const dateLabel = formatSummaryDateLabel(now, config.timezone);
  const header =
    `🌅 Sheuli Daily Summary — ${dateLabel}\n\n` +
    `📊 মোট: ${toBanglaNumber(contactCount)} জন থেকে ${toBanglaNumber(totalIncoming)}টা message, আমি ${toBanglaNumber(
      totalReplied
    )}টার reply দিয়েছি।`;

  let text = `${header}\n\n${body}`;
  if (text.length > MAX_SUMMARY_CHARS) {
    text = `${text.slice(0, MAX_SUMMARY_CHARS - 1)}…`;
  }

  return { isEmpty: false, messageCount: totalIncoming, repliedCount: totalReplied, contactCount, text };
}

// Core orchestration: compute the period since the last summary, generate (or
// use the friendly empty-state line), send it to the owner's own WhatsApp
// chat, then record it and advance the "last summary" pointer. On failure
// (WhatsApp not connected, OpenAI error, etc.) this throws WITHOUT advancing
// the pointer, so a scheduled retry on the next check will cover the same
// period rather than silently skipping a day.
export async function runDailySummary(trigger = 'scheduled') {
  const now = new Date();
  const lastSummaryAt = getSetting('lastSummaryAt', null);
  const sinceDate = lastSummaryAt ? new Date(lastSummaryAt) : new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sinceIso = toSqliteUtc(sinceDate);
  const untilIso = toSqliteUtc(now);

  const result = await buildDailySummaryText({ sinceIso, untilIso, now });

  // The owner's explicit /summary request always gets a reply, even if
  // "skip if empty" is enabled for the automatic morning run.
  const skipIfEmptyEnabled = Boolean(getSetting('dailySummarySkipIfEmpty', config.defaults.dailySummarySkipIfEmpty));
  const skipIfEmpty = trigger !== 'manual' && skipIfEmptyEnabled;

  if (result.isEmpty && skipIfEmpty) {
    setSetting('lastSummaryAt', now.toISOString());
    const row = insertSummary({
      periodStart: sinceIso,
      periodEnd: untilIso,
      content: '(skipped — no messages, and "skip if empty" is on)',
      messageCount: 0,
      repliedCount: 0,
      contactCount: 0,
      trigger
    });
    ioRef?.emit('summary:new', row);
    return { sent: false, skipped: true, content: null };
  }

  const content = result.isEmpty ? EMPTY_FRIENDLY_MESSAGE : result.text;

  await sendSelfMessage(content);

  setSetting('lastSummaryAt', now.toISOString());
  const row = insertSummary({
    periodStart: sinceIso,
    periodEnd: untilIso,
    content,
    messageCount: result.messageCount,
    repliedCount: result.repliedCount,
    contactCount: result.contactCount,
    trigger
  });
  ioRef?.emit('summary:new', row);

  logger.info({ trigger, messageCount: result.messageCount, contactCount: result.contactCount }, 'Daily summary sent');

  return { sent: true, skipped: false, content };
}

// Gated wrapper used by the scheduler (jobs.js): only runs if daily summaries
// are enabled and today's summary hasn't already gone out (by local date) —
// guards against double-sending regardless of whether today's send already
// happened via the scheduled tick, a startup catch-up, or a manual /summary.
export async function runScheduledDailySummaryIfDue(trigger) {
  const enabled = Boolean(getSetting('dailySummaryEnabled', config.defaults.dailySummaryEnabled));
  if (!enabled) return { sent: false, skipped: true, reason: 'disabled' };

  const now = new Date();
  const todayKey = getZonedDateKey(now, config.timezone);
  const lastSummaryAt = getSetting('lastSummaryAt', null);
  const lastSummaryDateKey = lastSummaryAt ? getZonedDateKey(new Date(lastSummaryAt), config.timezone) : null;

  if (lastSummaryDateKey === todayKey) {
    return { sent: false, skipped: true, reason: 'already-sent-today' };
  }

  return runDailySummary(trigger);
}

export default { buildDailySummaryText, runDailySummary, runScheduledDailySummaryIfDue, setSocketIo };
