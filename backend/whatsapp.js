import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import qrcode from 'qrcode';
import pkg from 'whatsapp-web.js';
import config from './config.js';
import logger from './logger.js';
import { generateReply } from './ai.js';
import { classifyChatId, describeContent } from './chatFilter.js';
import { isSheuliActive } from './schedule.js';
import { isCostLimitReached, recordApiCost } from './costGuard.js';
import { runDailySummary } from './summary.js';
import { transcribeAudioMedia, generateVoiceReplyAudio } from './services/voiceHandler.js';
import {
  MODES,
  getActiveModeDetails,
  getModeSystemInstruction,
  getCurrentActivity,
  getActivitySystemInstruction,
  isEmergencyMessage
} from './modes.js';
import { readChatDirectory } from './chatDirectory.js';
import { buildModeList, parseModeCommand } from './modeCommands.js';
import { parseNaturalLanguageEvent, saveCalendarEvent, getScheduleSummaryForDate } from './services/googleCalendar.js';
import {
  upsertContact,
  isRawId,
  touchContact,
  getContact,
  logMessage,
  getRecentConversation,
  getAllSettings,
  setSetting,
  hasProcessedMessage,
  markMessageProcessed,
  isIntroDue,
  setIntroSent,
  countRepliesInLastHour,
  clearAllChatHistory,
  setModeTimer,
  getDb
} from './db.js';

const { Client, LocalAuth, MessageMedia } = pkg;

let client = null;
let ioRef = null;
let connectionStatus = 'initializing'; // initializing | qr | authenticated | loading | ready | connected | disconnected | auth_failure | logging_out | needs_qr
let lastQr = null;
let switchingAccount = false;
let loadingPercent = 0;
let loadingMessage = '';
let startupWatchdog = null;
let authWatchdog = null;
let authRetryCount = 0;
const attachedClients = new WeakSet();

// FIX 2: reasons whatsapp-web.js emits when the linked session itself is
// dead (phone unlinked the device, or the server invalidated it) rather than
// a transient network blip. These need a full session wipe before any
// reconnect attempt, plus a loop guard — see the `disconnected` handler.
const LOGOUT_REASONS = new Set(['LOGOUT', 'UNPAIRED', 'UNPAIRED_IDLE']);
const LOGOUT_LOOP_WINDOW_MS = 5 * 60 * 1000;
const LOGOUT_LOOP_MAX = 2;
let logoutDisconnectTimestamps = [];
// True once the loop guard has tripped: further LOGOUT-reason disconnects are
// ignored (no more auto destroy/reinit cycling) until either a manual
// dashboard logout or a connection that actually reaches 'ready' clears it.
let sessionRecoveryFailed = false;

function isLogoutReason(reason) {
  return LOGOUT_REASONS.has(reason);
}

// FIX 3 (v12): "paired then instantly unpaired" detection. If WhatsApp
// LOGOUT-disconnects us within this window of a successful QR pairing, that's
// the signature of a web-version/library incompatibility, not a normal
// session invalidation — surfaced as a specific log line and a dashboard hint.
const PAIRING_REJECT_WINDOW_MS = 2 * 60 * 1000;
let lastAuthenticatedAt = null;
let pairingRejectedHint = false;
let readyTimestamp = 0;

// FIX 2.4: lets logoutWhatsApp() await the fresh client actually reaching the
// 'qr' state instead of just initWhatsApp() resolving (which happens earlier).
let qrWaiters = [];

function notifyQrWaiters() {
  if (!qrWaiters.length) return;
  const waiters = qrWaiters;
  qrWaiters = [];
  waiters.forEach((resolve) => resolve(true));
}

function waitForFreshQr(timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    qrWaiters.push((reached) => {
      clearTimeout(timer);
      resolve(reached);
    });
  });
}

// In-memory de-dup cache (mirrors the processed_messages table for fast-path checks)
// and a per-contact busy lock. Messages arriving while a reply is in progress
// wait in pendingJobs and are answered together right after it.
const processedMessageIds = new Set();
const busyContacts = new Set();
const pendingJobs = new Map();

// FEATURE 1: tracks whether the last connection event was a disconnect/auth
// failure, so a subsequent 'ready' event knows to send a "back online"
// recovery alert (and only then — not on the very first connect ever).
let hadConnectionIssue = false;

export function isSwitchingAccount() {
  return switchingAccount;
}

export function getClientInfo() {
  if ((connectionStatus !== 'connected' && connectionStatus !== 'ready') || !client?.info) {
    return null;
  }
  const wid = client.info.wid;
  const number = wid?.user || (wid?._serialized ? wid._serialized.replace('@c.us', '').replace('@lid', '') : null);
  const name = client.info.pushname || null;
  const platform = client.info.platform || null;
  return { number, name, platform };
}

export function getConnectionDetails() {
  return {
    status: connectionStatus,
    info: getClientInfo(),
    qr: lastQr,
    loadingPercent,
    loadingMessage,
    switchingAccount,
    // FIX 4.2: tells the dashboard the current/upcoming QR is a loop-guard
    // recovery attempt, so it can show "session couldn't be restored" instead
    // of the normal "scan this code" copy.
    sessionRecoveryFailed,
    // FIX 3 (v12): tells the dashboard the last pairing attempt was accepted
    // and then instantly rejected — likely a version incompatibility, not a
    // normal disconnect — so the QR card can show a matching hint.
    pairingRejectedHint
  };
}

function emitStatus(status, extra = {}) {
  connectionStatus = status;
  if (status === 'qr') {
    if (extra.qr) lastQr = extra.qr;
  } else if (
    status === 'authenticated' ||
    status === 'loading' ||
    status === 'ready' ||
    status === 'connected' ||
    status === 'logging_out' ||
    status === 'needs_qr'
  ) {
    if (
      status === 'authenticated' ||
      status === 'loading' ||
      status === 'ready' ||
      status === 'connected' ||
      status === 'needs_qr'
    ) {
      lastQr = null;
    }
  }

  if (status === 'loading') {
    if (extra.percent !== undefined) loadingPercent = extra.percent;
    if (extra.message !== undefined) loadingMessage = extra.message;
  } else if (status !== 'loading' && status !== 'authenticated') {
    loadingPercent = 0;
    loadingMessage = '';
  }

  const payload = getConnectionDetails();
  ioRef?.emit('whatsapp:status', payload);
}

function randomDelay(minMs = 3000, maxMs = 8000) {
  return new Promise((resolve) => setTimeout(resolve, minMs + Math.random() * (maxMs - minMs)));
}

// "typing…" / "recording…" is sent by chat ID, not through a Chat object:
// loading the Chat fails for @lid contacts, which left them with no indicator.
// WhatsApp only shows it while we appear online, and drops it after ~25s.
async function startTyping(chatId, state = 'typing') {
  const send = async (value) => {
    try {
      await client.pupPage.evaluate((s, id) => window.WWebJS.sendChatstate(s, id), value, chatId);
    } catch (err) {
      logger.warn({ err: err?.message || err, state: value }, 'Could not send typing state');
    }
  };
  const setPresence = async (method) => {
    try {
      await client[method]();
    } catch (err) {
      logger.debug({ err: err?.message || err }, 'Could not update presence');
    }
  };

  await setPresence('sendPresenceAvailable');
  await send(state);
  const refresh = setInterval(() => send(state), 10000);

  return async () => {
    clearInterval(refresh);
    await send('stop');
    // Go offline again so the owner's phone keeps getting notifications.
    await setPresence('sendPresenceUnavailable');
  };
}

async function downloadMediaWithRetry(message, retries = 3, delayMs = 1200) {
  for (let i = 0; i < retries; i++) {
    try {
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      const media = await message.downloadMedia();
      if (media && media.data) {
        return media;
      }
    } catch (err) {
      logger.warn({ err: err?.message || err, attempt: i + 1 }, 'downloadMedia attempt failed, retrying...');
    }
  }
  return null;
}

// Logs (and broadcasts to the dashboard) a message that was skipped before any
// contact record or AI call was ever created — used for chat types that are
// never eligible for a reply (groups, channels, broadcasts, self-chat, etc.).
function logQuickSkip(chatId, status) {
  logMessage({ contactId: chatId, contactName: chatId, direction: 'out', body: '', status });
  ioRef?.emit('message:new', {
    contactId: chatId,
    contactName: chatId,
    direction: 'out',
    body: '',
    status,
    createdAt: new Date().toISOString()
  });
}

// "/" lists the modes; "/<number or name> [time]" switches to one.
async function handleModeCommand(message, body) {
  const request = parseModeCommand(body);
  if (request.type === 'list') {
    await message.reply(buildModeList(getAllSettings().activeMode));
    return;
  }
  if (request.type === 'unknown') {
    await message.reply('No such command. Send / to see the mode list.');
    return;
  }

  setSetting('activeMode', request.id);
  setModeTimer(request.id, request.minutes);
  const settings = getAllSettings();
  ioRef?.emit('settings:updated', settings);

  const until = settings.modeUntil
    ? ` until ${new Date(settings.modeUntil).toLocaleTimeString('en-US', { timeZone: settings.timezone, hour: 'numeric', minute: '2-digit' })}`
    : '';
  // A mode alone sends nothing while auto-reply is off, so say so.
  const off = isSheuliActive(settings) ? '' : `\n${settings.assistantName} is OFF — send /on to start replying.`;
  await message.reply(`Mode: ${MODES[request.id].name}${until}${off}`);
}

async function handleSelfCommand(message, body) {
  const command = body.trim().toLowerCase();

  // FEATURE 4: on-demand daily summary, covering everything since the last
  // summary was sent (scheduled or manual). Same fromMe-only / self-chat-only
  // protection as /on and /off, since this is only ever reached from there.
  if (command === '/summary') {
    try {
      await runDailySummary('manual');
    } catch (err) {
      logger.error({ err: err?.message || err }, 'Manual /summary command failed');
      try {
        await message.reply('Summary বানাতে সমস্যা হয়েছে, একটু পরে আবার চেষ্টা করো।');
      } catch {
        // Ignore — best-effort error notice only.
      }
    }
    return true;
  }

  if (command.startsWith('/schedule') || command.startsWith(`${getAllSettings().assistantName.toLowerCase()}, schedule`) || command.startsWith('schedule ')) {
    try {
      const parsed = parseNaturalLanguageEvent(body);
      const saved = saveCalendarEvent(getDb(), parsed);
      await message.reply(
        `Event scheduled!\n**${saved.summary}**\n${saved.displayDate} at ${saved.displayTime}\nAdded to your Calendar.`
      );
    } catch (err) {
      await message.reply(`Schedule save failed: ${err.message}`);
    }
    return true;
  }

  if (command !== '/on' && command !== '/off') {
    if (!command.startsWith('/')) return false;
    await handleModeCommand(message, body);
    return true;
  }

  const settings = getAllSettings();

  // FEATURE 2: while schedule mode is in control, /on and /off don't toggle
  // anything — the schedule is the single source of truth for when Sheuli replies.
  if (settings.mode === 'schedule') {
    await message.reply(
      `${settings.assistantName} is in schedule mode (${settings.scheduleStart}–${settings.scheduleEnd}). ` +
        'Switch to manual mode from the dashboard to control it manually.'
    );
    return true;
  }

  if (command === '/on') {
    setSetting('autoReplyEnabled', true);
    ioRef?.emit('settings:updated', getAllSettings());
    await message.reply(`${settings.assistantName} is now ON`);
    return true;
  }

  setSetting('autoReplyEnabled', false);
  ioRef?.emit('settings:updated', getAllSettings());
  await message.reply(`${settings.assistantName} is now OFF`);
  return true;
}

// Only these are ever treated as commands, so ordinary outgoing messages are
// dismissed before any chat-ID lookup.
const SELF_COMMAND_RE = /^(\/|schedule )/i;

function isSelfCommand(body) {
  const named = `${getAllSettings().assistantName.toLowerCase()}, schedule`;
  return SELF_COMMAND_RE.test(body) || body.toLowerCase().startsWith(named);
}

// "Message Yourself" can be addressed by the account's phone-number ID (@c.us)
// or by its LID (@lid), so a message to either one counts as the self chat.
async function isSelfChatId(chatId) {
  const selfId = client?.info?.wid?._serialized;
  if (!selfId || !chatId) return false;
  if (chatId === selfId) return true;
  if (!chatId.endsWith('@lid')) return false;
  try {
    const [ids] = await client.getContactLidAndPhone([selfId]);
    return ids?.lid === chatId;
  } catch (err) {
    logger.warn({ err: err?.message || err }, 'Could not resolve own LID for self-chat check');
    return false;
  }
}

// The owner's own messages arrive only on 'message_create' — whatsapp-web.js
// never emits 'message' for them.
async function handleOwnMessage(message) {
  if (switchingAccount || !message.fromMe) return;
  const body = (message.body || '').trim();
  if (!isSelfCommand(body)) return;

  // Never replay an old command synced from history on reconnect.
  const msgSec = message.timestamp || 0;
  const nowSec = Math.floor(Date.now() / 1000);
  if (msgSec > 0 && (nowSec - msgSec > 120 || (readyTimestamp > 0 && msgSec < readyTimestamp - 15))) return;

  if (!(await isSelfChatId(message.to))) return;

  const messageId = message.id?._serialized;
  if (messageId) {
    if (processedMessageIds.has(messageId) || hasProcessedMessage(messageId)) return;
    processedMessageIds.add(messageId);
    markMessageProcessed(messageId);
  }

  logger.info({ command: body.split(/\s+/)[0] }, 'Self-chat command received');
  await handleSelfCommand(message, body);
}

// FIX 5: unconditional visibility into whether messages are arriving at all —
// logged before ANY filtering/de-dup/skip logic, so "did WhatsApp even hand
// us this message" is never in question when debugging production logs.
function chatTypeLabel(chatId) {
  if (!chatId || typeof chatId !== 'string') return 'unknown';
  if (chatId === 'status@broadcast') return 'status';
  if (chatId.includes('@broadcast')) return 'broadcast';
  if (chatId.endsWith('@newsletter')) return 'channel';
  if (chatId.endsWith('@g.us')) return 'group';
  if (chatId.endsWith('@c.us') || chatId.endsWith('@lid')) return 'individual';
  return 'unknown';
}

async function handleIncomingMessage(message) {
  if (switchingAccount) {
    logger.info('Message dropped: WhatsApp account is currently being logged out / switched');
    return;
  }
  // Own messages are handled by handleOwnMessage() via 'message_create'.
  if (message.fromMe) return;
  const rawChatId = message.from;
  const rawNumber = (rawChatId || '').replace('@c.us', '').replace('@lid', '').replace('@g.us', '');
  logger.info(
    `Incoming: ${chatTypeLabel(rawChatId)} from ${rawNumber || 'unknown'} — ${(message.body || '').slice(0, 30)}`
  );

  // System events carry nothing to answer. Checked before de-dup so a message
  // that shows up again with real content is not thrown away.
  const content = describeContent(message);
  if (content === null) {
    logger.debug({ type: message.type }, 'Ignoring non-content message');
    return;
  }

  // De-duplicate: whatsapp-web.js can occasionally re-emit the same event
  // (e.g. around a reconnect). Record the ID before doing any other work so a
  // duplicate event is dropped immediately instead of triggering a second reply.
  const messageId = message.id?._serialized;
  if (messageId) {
    if (processedMessageIds.has(messageId) || hasProcessedMessage(messageId)) {
      logger.debug({ messageId }, 'Duplicate message event ignored');
      return;
    }
    processedMessageIds.add(messageId);
    markMessageProcessed(messageId);
  }

  const chatId = message.from;

  // ── SAFETY: Ignore old/historical offline messages ───────────────────────
  // WhatsApp Web syncs unread/offline messages when connecting. We only reply to
  // fresh messages arriving live while Sheuli is running.
  const nowSec = Math.floor(Date.now() / 1000);
  const msgSec = message.timestamp || 0;
  if (msgSec > 0) {
    const ageInSeconds = nowSec - msgSec;
    if (ageInSeconds > 120 || (readyTimestamp > 0 && msgSec < (readyTimestamp - 15))) {
      logger.info(
        { chatId, msgSec, nowSec, ageInSeconds, readyTimestamp },
        'Skipping offline/historical message sent before bot was ready'
      );
      logQuickSkip(chatId, 'skipped-offline-history');
      return;
    }
  }

  // ── FEATURE 1: reply ONLY to personal 1-to-1 contacts ──────────────────
  // Whitelist-by-type: only individual 1-to-1 chats ("@c.us" and "@lid") are eligible at all.
  // Everything else (groups/communities "@g.us", channels/newsletters
  // "@newsletter", broadcast lists and status updates "@broadcast", or any
  // future/unrecognized chat-ID shape) is skipped by default — this is
  // intentionally an allowlist, not a blocklist, so nothing new can slip
  // through unnoticed. This check runs before any contact lookup or AI call.
  const skipReason = classifyChatId(chatId);
  if (skipReason) {
    logQuickSkip(chatId, skipReason);
    return;
  }

  // Second safety layer: verify against the real Chat object too, in case an
  // ID that *looks* like an individual chat is ever actually a group/community.
  let chat;
  try {
    chat = await message.getChat();
  } catch (err) {
    logger.warn({ err: err?.message || err }, 'Could not fetch chat object');
  }
  if (chat?.isGroup || chat?.isCommunity || chat?.isChannel || chat?.isReadOnly) {
    logQuickSkip(chatId, 'skipped-group');
    return;
  }

  let contactName = null;
  let contactNumber = chatId.replace('@c.us', '').replace('@lid', '').replace('@g.us', '');
  let candidateJids = [];
  try {
    const waContact = await message.getContact();
    const rawName = waContact?.name || waContact?.pushname || waContact?.shortName || waContact?.verifiedName || chat?.name;
    if (rawName && !isRawId(rawName)) {
      contactName = rawName.trim();
    }
    if (waContact?.id?._serialized && waContact.id._serialized.endsWith('@c.us')) {
      candidateJids.push(waContact.id._serialized);
      contactNumber = waContact.id._serialized.replace('@c.us', '');
    } else if (waContact?.number && !waContact.number.includes('@')) {
      candidateJids.push(`${waContact.number}@c.us`);
      contactNumber = waContact.number;
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Could not fetch contact info');
  }

  if (message.author && message.author.endsWith('@c.us')) {
    candidateJids.push(message.author);
  }
  if (message._data?.sender?.id?._serialized?.endsWith('@c.us')) {
    candidateJids.push(message._data.sender.id._serialized);
  }
  candidateJids.push(chatId);
  candidateJids = [...new Set(candidateJids.filter(Boolean))];

  // Snapshot the contact BEFORE touching last_message_at, so the 24h-inactivity
  // check for re-introduction compares against the *previous* message, not this one.
  const priorContact = getContact(chatId);

  upsertContact({ id: chatId, name: contactName, number: contactNumber, isGroup: false });
  touchContact(chatId);

  let incomingBody = content;
  let isVoice = false;
  let voiceTranscript = null;

  // ── FEATURE: Voice Note Reader & Whisper Transcription ─────────────────
  if (message.hasMedia && (message.type === 'audio' || message.type === 'ptt')) {
    try {
      isVoice = true;
      const media = await downloadMediaWithRetry(message, 3, 1200);
      if (media && media.data) {
        voiceTranscript = await transcribeAudioMedia(media);
      }
      if (voiceTranscript) {
        incomingBody = `[Voice Note Transcribed]: "${voiceTranscript}"`;
      } else {
        incomingBody = '[Voice Note Received]';
      }
    } catch (voiceErr) {
      logger.warn({ err: voiceErr?.message || voiceErr, chatId }, 'Voice note transcription failed');
      incomingBody = '[Voice Note Received]';
    }
  }

  // Snapshot conversation history BEFORE logging this incoming message,
  // so it isn't counted twice (once from history, once as the new prompt).
  const conversationHistory = getRecentConversation(chatId, config.defaults.memoryLength);

  logMessage({
    contactId: chatId,
    contactName,
    direction: 'in',
    body: incomingBody,
    status: 'received'
  });
  ioRef?.emit('message:new', {
    contactId: chatId,
    contactName,
    direction: 'in',
    body: incomingBody,
    status: 'received',
    isVoice,
    voiceTranscript,
    createdAt: new Date().toISOString()
  });

  await enqueueReply({
    message,
    chat,
    chatId,
    contactName,
    candidateJids,
    incomingBody,
    isVoice,
    history: conversationHistory,
    priorContact
  });
}

async function enqueueReply(job) {
  const { chatId } = job;
  if (busyContacts.has(chatId)) {
    pendingJobs.set(chatId, [...(pendingJobs.get(chatId) || []), job]);
    return;
  }
  busyContacts.add(chatId);
  try {
    let current = job;
    while (current && !switchingAccount) {
      await replyToContact(current);
      current = takePendingJob(chatId);
    }
  } finally {
    busyContacts.delete(chatId);
    pendingJobs.delete(chatId);
  }
}

// Merges everything that queued up into one job, answered with a single reply.
function takePendingJob(chatId) {
  const jobs = pendingJobs.get(chatId);
  if (!jobs?.length) return null;
  pendingJobs.delete(chatId);

  // The queued messages are already logged, so drop them from the history or
  // the model would see each of them twice.
  const history = getRecentConversation(chatId, config.defaults.memoryLength);
  let toDrop = jobs.length;
  for (let i = history.length - 1; i >= 0 && toDrop > 0; i -= 1) {
    if (history[i].direction === 'in') {
      history.splice(i, 1);
      toDrop -= 1;
    }
  }

  return {
    ...jobs[jobs.length - 1],
    incomingBody: jobs.map((j) => j.incomingBody).join('\n'),
    isVoice: jobs.some((j) => j.isVoice),
    history,
    priorContact: getContact(chatId)
  };
}

async function replyToContact({
  message,
  chatId,
  contactName,
  candidateJids,
  incomingBody,
  isVoice,
  history,
  priorContact
}) {
  const settings = getAllSettings();
  const contact = getContact(chatId);

  const recordSkip = (status) => {
    logMessage({ contactId: chatId, contactName, direction: 'out', body: '', status });
    ioRef?.emit('message:new', {
      contactId: chatId,
      contactName,
      direction: 'out',
      body: '',
      status,
      createdAt: new Date().toISOString()
    });
  };

  if (contact?.blacklisted) {
    recordSkip('blacklisted');
    return;
  }


  // ── FEATURE 2: schedule enforcement ─────────────────────────────────────
  if (!isSheuliActive(settings)) {
    recordSkip(settings.mode === 'schedule' ? 'skipped-outside-schedule' : 'skipped');
    return;
  }

  const rateLimit = settings.rateLimitPerHour ?? config.defaults.rateLimitPerHour;
  if (rateLimit > 0) {
    const replyCount = countRepliesInLastHour(chatId);
    if (replyCount >= rateLimit) {
      recordSkip('rate_limited');
      return;
    }
  }

  if (isCostLimitReached()) {
    recordSkip('skipped-cost-limit');
    return;
  }

  const introDue = isIntroDue(priorContact);

  // ── FEATURE: Real-time Priority Activity (Calendar -> Mode) ──
  const currentActivity = getCurrentActivity(settings, getDb(), new Date());
  const activityContext = getActivitySystemInstruction(currentActivity, settings);
  const scheduleContext = getScheduleSummaryForDate(getDb());

  // Check for Emergency Override during Sleep/Exam modes
  if ((currentActivity.mode === 'sleep' || currentActivity.mode === 'exam') && isEmergencyMessage(incomingBody)) {
    logger.warn({ chatId, incomingBody }, 'EMERGENCY MESSAGE DETECTED! Notifying owner.');
    ioRef?.emit('emergency:alert', { chatId, contactName, message: incomingBody });
  }

  // ── FEATURE: Voice Auto-Reply (TTS) ──────────────────────────────────
  const voiceMode = settings.voiceReplyMode || 'auto';
  const shouldSendVoiceReply = voiceMode === 'voice' || (voiceMode === 'auto' && isVoice);

  // Shown from the moment work starts until the reply has gone out.
  const stopTyping = await startTyping(chatId, shouldSendVoiceReply ? 'recording' : 'typing');

  try {
    const { reply, promptTokens, completionTokens } = await generateReply({
      contactId: chatId,
      incomingBody,
      history,
      isFirstReply: introDue,
      currentActivity,
      activityContext,
      modeContext: activityContext,
      scheduleContext
    });

    recordApiCost(promptTokens, completionTokens).catch((err) => {
      logger.warn({ err: err?.message || err }, 'Failed to record API cost');
    });

    await randomDelay(3000, 8000);

    let sentSuccess = false;
    let lastErr = null;

    if (shouldSendVoiceReply) {
      try {
        const voiceName = settings.ttsVoice || 'nova';
        const audioReply = await generateVoiceReplyAudio(reply, voiceName);
        if (audioReply) {
          const media = new MessageMedia(audioReply.mimetype, audioReply.base64, 'reply.mp3');
          await message.reply(media);
          sentSuccess = true;
        }
      } catch (voiceReplyErr) {
        logger.warn({ err: voiceReplyErr?.message || voiceReplyErr }, 'Voice TTS reply failed, falling back to text');
      }
    }

    if (!sentSuccess) {
      try {
        await message.reply(reply);
        sentSuccess = true;
      } catch (replyErr) {
        lastErr = replyErr;
        logger.warn({ err: replyErr?.message || replyErr, chatId }, 'message.reply() failed, trying candidate JIDs...');

        for (const jid of candidateJids) {
          try {
            await client.sendMessage(jid, reply, { linkPreview: false });
            sentSuccess = true;
            break;
          } catch (sendErr) {
            lastErr = sendErr;
            logger.warn({ err: sendErr?.message || sendErr, jid }, `client.sendMessage failed for ${jid}`);
          }
        }
      }
    }

    if (!sentSuccess) {
      throw lastErr || new Error('All reply candidates failed');
    }

    if (introDue) {
      setIntroSent(chatId, true);
    }

    logMessage({
      contactId: chatId,
      contactName,
      direction: 'out',
      body: reply,
      status: 'replied',
      promptTokens,
      completionTokens
    });
    ioRef?.emit('message:new', {
      contactId: chatId,
      contactName,
      direction: 'out',
      body: reply,
      status: 'replied',
      createdAt: new Date().toISOString()
    });
    ioRef?.emit('stats:updated');
  } catch (err) {
    logger.error({ err: err?.message || err, contactId: chatId }, 'Failed to generate/send reply');
    recordSkip('error');
  } finally {
    await stopTyping();
  }
}

export function getConnectionStatus() {
  return connectionStatus;
}

export function getLastQr() {
  return lastQr;
}

// FEATURE 4: "Message Yourself" is just the chat whose ID equals the logged-in
// account's own WhatsApp ID.
export function getSelfChatId() {
  return client?.info?.wid?._serialized || null;
}

export async function sendSelfMessage(text) {
  const selfId = getSelfChatId();
  if (!client || !selfId) {
    throw new Error('WhatsApp client is not connected');
  }
  await client.sendMessage(selfId, text, { linkPreview: false });
}

async function getBrowserExecutablePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  const platform = os.platform();
  const candidates = [];

  if (platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
      path.join(os.homedir(), 'AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe')
    );
  } else if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    );
  } else {
    candidates.push(
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/msedge',
      '/snap/bin/chromium'
    );
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      logger.info({ executablePath: candidate }, 'Using fallback system browser for WhatsApp client');
      return candidate;
    }
  }

  try {
    const puppeteerModule = await import('puppeteer');
    const defaultPath = (puppeteerModule.default || puppeteerModule).executablePath?.();
    if (defaultPath && fs.existsSync(defaultPath)) {
      return defaultPath;
    }
  } catch {
    // Ignore
  }

  return undefined;
}

let isResetting = false;
let isInitializing = false;

function cleanAllLockfiles(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        cleanAllLockfiles(fullPath);
      } else if (
        entry.name === 'LOCK' ||
        entry.name === 'lockfile' ||
        entry.name === 'SingletonLock' ||
        entry.name === 'SingletonCookie' ||
        entry.name === 'SingletonSocket'
      ) {
        try {
          fs.rmSync(fullPath, { force: true });
        } catch {
          // Ignore if locked by active process
        }
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

export async function destroyClient() {
  cancelPairingReload();
  if (startupWatchdog) {
    clearTimeout(startupWatchdog);
    startupWatchdog = null;
  }
  if (client) {
    logger.info('Shutting down WhatsApp client cleanly...');
    // Strip listeners FIRST: client.destroy() tears down the underlying
    // Puppeteer browser, which can itself emit a 'disconnected' event on the
    // way out. With listeners still attached, that would fire our own
    // 'disconnected' handler mid-teardown and kick off ANOTHER reconnect
    // (resetClient -> initWhatsApp) racing against this shutdown — the root
    // cause of the "authenticated" log firing multiple times in production,
    // and of module-level `client` getting reassigned out from under an
    // in-flight incoming-message handler.
    client.removeAllListeners();
    try {
      await client.destroy();
    } catch {
      // Ignore
    }
    client = null;
  }
  cleanAllLockfiles(config.sessionAuthDir);
}

async function resetClient(reason) {
  if (switchingAccount) {
    logger.info({ reason }, 'resetClient called while switchingAccount is true — aborting auto-reconnect');
    return;
  }
  if (isResetting) return;
  isResetting = true;
  if (startupWatchdog) {
    clearTimeout(startupWatchdog);
    startupWatchdog = null;
  }
  stopAuthenticatedWatchdog();
  try {
    if (client) {
      logger.info('Destroying existing WhatsApp client and browser instance...');
      client.removeAllListeners();
      try {
        await client.destroy();
      } catch {
        // Ignore destroy error if browser process already terminated
      }
      client = null;
    }

    if (isLogoutReason(reason) || reason === 'auth_failure') {
      // FIX 1: full verified wipe (not just the `session` subfolder) so a
      // fresh client can never boot against the old, now-invalid account.
      const wipedClean = await wipeSessionData();
      if (!wipedClean) {
        logger.error(
          'Proceeding with reinitialization despite an incomplete session wipe — a stale-session LOGOUT loop may recur'
        );
      }
    } else {
      cleanAllLockfiles(config.sessionAuthDir);
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));

    logger.info('Reinitializing fresh WhatsApp client...');
    await initWhatsApp(ioRef);
  } catch (err) {
    logger.error({ err: err?.message || err }, 'Failed to reinitialize WhatsApp after disconnect');
  } finally {
    isResetting = false;
  }
}

// Guards against ever having two Client instances alive at once. Without
// this, a cascading event during teardown (see the removeAllListeners()
// comments above) could race a second initWhatsApp() call against one still
// in flight — two Puppeteer browsers, two full listener sets, and the
// module-level `client` variable getting reassigned mid-flight while an
// incoming-message handler is still using it (which is what caused messages
// to silently vanish instead of being logged/replied to).
export async function initWhatsApp(io) {
  if (isInitializing) {
    logger.warn('initWhatsApp() called while an initialization is already in progress — ignoring duplicate call');
    return client;
  }
  isInitializing = true;
  try {
    return await doInitWhatsApp(io);
  } finally {
    isInitializing = false;
  }
}

async function doInitWhatsApp(io) {
  ioRef = io;
  emitStatus('initializing');

  if (startupWatchdog) {
    clearTimeout(startupWatchdog);
    startupWatchdog = null;
  }
  stopAuthenticatedWatchdog();

  if (client) {
    client.removeAllListeners();
    try {
      await client.destroy();
    } catch {
      // Ignore
    }
    client = null;
  }

  cleanAllLockfiles(config.sessionAuthDir);

  const executablePath = await getBrowserExecutablePath();
  const puppeteerOptions = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu'
    ]
  };
  if (executablePath) {
    puppeteerOptions.executablePath = executablePath;
  }

  const clientOptions = {
    authStrategy: new LocalAuth({ dataPath: config.sessionAuthDir }),
    puppeteer: puppeteerOptions
  };

  if (config.pinnedWebVersion) {
    clientOptions.webVersion = config.pinnedWebVersion;
    clientOptions.webVersionCache = {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html'
    };
  }

  client = new Client(clientOptions);

  startupWatchdog = setTimeout(() => {
    if (connectionStatus === 'initializing') {
      logger.warn('WhatsApp client stuck initializing for over 90s — resetting and attempting clean reconnect...');
      resetClient('startup_timeout');
    }
  }, 90000);

  attachListeners(client);

  try {
    await client.initialize();
  } catch (err) {
    logger.error({ err: err?.message || err }, 'WhatsApp client.initialize() failed');
    if (startupWatchdog) {
      clearTimeout(startupWatchdog);
      startupWatchdog = null;
    }
    emitStatus('disconnected');
    setTimeout(() => resetClient('init_failed'), 5000);
  }
  return client;
}

// Right after a QR link, WhatsApp Web navigates away from its sign-in page and
// the message hooks can be lost: the dashboard says "Connected" but nothing
// arrives. Reloading the client once, keeping the session, attaches them the
// same way a server restart does.
const PAIRING_RELOAD_DELAY_MS = 45 * 1000;
let freshPairing = false;
let pairingReloadTimer = null;

function cancelPairingReload() {
  clearTimeout(pairingReloadTimer);
  pairingReloadTimer = null;
}

function schedulePairingReload() {
  cancelPairingReload();
  logger.info(`New account linked — reloading the WhatsApp client in ${PAIRING_RELOAD_DELAY_MS / 1000}s`);
  // The delay lets WhatsApp finish saving the new session first.
  pairingReloadTimer = setTimeout(async () => {
    pairingReloadTimer = null;
    if (switchingAccount || isResetting || !client) return;
    freshPairing = false;
    try {
      logger.info('Reloading the WhatsApp client after linking');
      await destroyClient();
      await initWhatsApp(ioRef);
    } catch (err) {
      logger.error({ err: err?.message || err }, 'Reload after linking failed');
    }
  }, PAIRING_RELOAD_DELAY_MS);
}

function stopAuthenticatedWatchdog() {
  if (authWatchdog) {
    clearTimeout(authWatchdog);
    authWatchdog = null;
  }
}

function startAuthenticatedWatchdog() {
  stopAuthenticatedWatchdog();
  if (switchingAccount) return;

  const timeoutMs = authRetryCount >= 3 ? 300000 : 180000;
  logger.info(
    { attempt: authRetryCount + 1, timeoutSec: timeoutMs / 1000 },
    'Starting authenticated->ready watchdog timer'
  );

  authWatchdog = setTimeout(async () => {
    if (switchingAccount) {
      logger.info('Watchdog fired while switchingAccount is true — aborting recovery');
      return;
    }
    if (connectionStatus === 'ready' || connectionStatus === 'connected') {
      return;
    }

    if (client?.info?.wid) {
      logger.info('Watchdog: WhatsApp client info is already established — setting state to ready');
      emitStatus('ready');
      return;
    }

    authRetryCount++;
    logger.warn(
      { attempt: authRetryCount },
      'Sheuli authenticated but `ready` did not fire within timeout — resetting and re-initializing...'
    );

    if (authRetryCount === 3) {
      logger.warn('Sheuli authenticated but never became ready after 3 attempts — may need attention');
    }

    try {
      if (client) {
        client.removeAllListeners();
        try {
          await client.destroy();
        } catch {
          // Ignore
        }
        client = null;
      }
      cleanAllLockfiles(config.sessionAuthDir);
      await initWhatsApp(ioRef);
    } catch (err) {
      logger.error({ err: err?.message || err }, 'Error during watchdog client re-initialization');
    }
  }, timeoutMs);
}

function attachListeners(clientInstance) {
  if (attachedClients.has(clientInstance)) {
    logger.debug('Listeners already attached to this client instance — skipping duplicate wiring');
    return;
  }
  attachedClients.add(clientInstance);

  clientInstance.removeAllListeners();

  let hasLoggedAuthenticated = false;
  let hasLoggedReady = false;

  clientInstance.on('loading_screen', (percent, message) => {
    logger.info(`WhatsApp Web loading: ${percent}% — ${message}`);
    emitStatus('loading', { percent, message });
  });

  clientInstance.on('change_state', (state) => {
    logger.info(`WhatsApp client state changed to: ${state}`);
  });

  clientInstance.on('qr', async (qr) => {
    freshPairing = true;
    cancelPairingReload();
    if (startupWatchdog) {
      clearTimeout(startupWatchdog);
      startupWatchdog = null;
    }
    stopAuthenticatedWatchdog();
    authRetryCount = 0;
    try {
      const qrDataUrl = await qrcode.toDataURL(qr);
      lastQr = qrDataUrl;
      emitStatus('qr', { qr: qrDataUrl });
      ioRef?.emit('whatsapp:qr', { qr: qrDataUrl });
      logger.info('QR code generated — scan it from the dashboard or terminal below');
      const qrcodeTerminal = await import('qrcode-terminal');
      qrcodeTerminal.default.generate(qr, { small: true });
      // FIX 2.4: unblocks logoutWhatsApp()'s wait so it can clear
      // switchingAccount now that the fresh client actually has a QR up.
      notifyQrWaiters();
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to generate QR code');
    }
  });

  clientInstance.on('authenticated', () => {
    if (startupWatchdog) {
      clearTimeout(startupWatchdog);
      startupWatchdog = null;
    }
    lastQr = null;
    ioRef?.emit('whatsapp:qr', { qr: null });
    emitStatus('authenticated');
    if (!hasLoggedAuthenticated) {
      hasLoggedAuthenticated = true;
      logger.info('WhatsApp authentication successful');
    }
    // FIX 3 (v12): remember when this pairing completed so a LOGOUT disconnect
    // shortly after can be recognized as "paired then instantly rejected"
    // rather than a generic disconnect. NOTE: unlike v11, we deliberately do
    // NOT clear the loop-guard counters here — 'authenticated' firing does not
    // prove the session is actually accepted (that's the whole v12 bug: it
    // can authenticate and get LOGOUT'd seconds later on every attempt, which
    // would otherwise keep zeroing the counter before it could ever trip).
    // The counters only get cleared on a confirmed-stable 'ready' below.
    lastAuthenticatedAt = Date.now();
    pairingRejectedHint = false;
    startAuthenticatedWatchdog();
    if (freshPairing) schedulePairingReload();
  });

  clientInstance.on('ready', () => {
    readyTimestamp = Math.floor(Date.now() / 1000);
    if (startupWatchdog) {
      clearTimeout(startupWatchdog);
      startupWatchdog = null;
    }
    stopAuthenticatedWatchdog();
    authRetryCount = 0;
    // FIX 2.2: a connection that actually reaches 'ready' proves the session
    // is genuinely good — safe to clear the LOGOUT loop guard here.
    logoutDisconnectTimestamps = [];
    sessionRecoveryFailed = false;
    emitStatus('ready');
    // The linked account's own name is the default for what replies call the owner.
    setSetting('accountName', clientInstance.info?.pushname || '');
    ioRef?.emit('settings:updated', getAllSettings());
    if (!hasLoggedReady) {
      hasLoggedReady = true;
      const widUser =
        clientInstance.info?.wid?.user ||
        (clientInstance.info?.wid?._serialized
          ? clientInstance.info.wid._serialized.replace('@c.us', '').replace('@lid', '')
          : 'unknown');
      const pushname = clientInstance.info?.pushname || 'unknown';
      logger.info(`READY — logged in as ${widUser} (${pushname})`);
    }

    if (hadConnectionIssue) {
      hadConnectionIssue = false;
    }

    // Trigger background contact & chat name sync
    syncContactsFromWhatsApp().catch(() => {});
  });

  clientInstance.on('auth_failure', async (msg) => {
    if (startupWatchdog) {
      clearTimeout(startupWatchdog);
      startupWatchdog = null;
    }
    stopAuthenticatedWatchdog();
    if (switchingAccount) {
      logger.info({ msg }, 'auth_failure fired during intentional logout — ignoring auto-reconnect and alert');
      return;
    }
    emitStatus('auth_failure');
    logger.error({ msg }, 'WhatsApp authentication failed — cleaning up session...');
    hadConnectionIssue = true;
    await resetClient('auth_failure');
  });

  clientInstance.on('disconnected', async (reason) => {
    cancelPairingReload();
    if (startupWatchdog) {
      clearTimeout(startupWatchdog);
      startupWatchdog = null;
    }
    stopAuthenticatedWatchdog();
    // FIX 2.4: during an intentional dashboard logout, every disconnect this
    // old/new client pair fires is expected — no reconnect logic, no alert.
    if (switchingAccount) {
      logger.info({ reason }, 'disconnected fired during intentional logout — ignoring auto-reconnect and alert');
      return;
    }
    emitStatus('disconnected');
    hadConnectionIssue = true;

    // FIX 2.1/2.2: LOGOUT (or an equivalent "unpaired" reason) means the saved
    // session itself is dead — blindly re-initing with the same session is
    // what caused the destroy/reinit/disconnect loop. Handle it once, wipe
    // the session first, and guard against it happening over and over.
    if (isLogoutReason(reason)) {
      // FIX 3 (v12): pairing was accepted (authenticated) and then rejected
      // within 2 minutes — the signature of a web-version/library
      // incompatibility rather than a normal session invalidation. Logged and
      // surfaced regardless of loop-guard state so it's self-explanatory the
      // very first time it happens, not just once the guard trips.
      if (lastAuthenticatedAt && Date.now() - lastAuthenticatedAt < PAIRING_REJECT_WINDOW_MS) {
        pairingRejectedHint = true;
        logger.warn(
          { reason, msSincePairing: Date.now() - lastAuthenticatedAt },
          'Pairing rejected by WhatsApp right after linking — likely web-version/library incompatibility. Try updating whatsapp-web.js or adjusting WA_WEB_VERSION.'
        );
      }

      if (sessionRecoveryFailed) {
        logger.warn(
          { reason },
          'Ignoring further LOGOUT-disconnect — loop guard already tripped; waiting for a manual dashboard action or successful reconnect'
        );
        emitStatus('needs_qr');
        return;
      }

      const now = Date.now();
      logoutDisconnectTimestamps = logoutDisconnectTimestamps.filter((t) => now - t < LOGOUT_LOOP_WINDOW_MS);
      logoutDisconnectTimestamps.push(now);

      if (logoutDisconnectTimestamps.length > LOGOUT_LOOP_MAX) {
        logger.error(
          { reason, occurrencesInWindow: logoutDisconnectTimestamps.length },
          'LOGOUT-disconnect loop detected (more than 2 within 5 minutes) — stopping auto-reinit cycling and waiting for a fresh manual QR scan'
        );
        logoutDisconnectTimestamps = [];
        sessionRecoveryFailed = true;
        emitStatus('needs_qr');
        // One last, verified-clean attempt so the user actually has a QR to
        // scan — but the `sessionRecoveryFailed` gate above stops any further
        // ones if this also somehow gets LOGOUT-disconnected again.
        await resetClient(reason);
        return;
      }

      logger.warn({ reason }, 'WhatsApp session was logged out/unpaired — wiping session and reinitializing for a fresh QR...');
      await resetClient(reason);
      return;
    }

    // FIX 2.3: other disconnect reasons (network blips etc.) keep the
    // existing reconnect-with-backoff behavior, unchanged.
    logger.warn({ reason }, 'WhatsApp disconnected — cleaning up and attempting clean reconnect...');
    await resetClient(reason);
  });

  clientInstance.on('message_create', async (message) => {
    try {
      await handleOwnMessage(message);
    } catch (err) {
      logger.error({ err: err.message }, 'Unhandled error while processing own message');
    }
  });

  clientInstance.on('message', async (message) => {
    try {
      await handleIncomingMessage(message);
    } catch (err) {
      logger.error({ err: err.message }, 'Unhandled error while processing message');
    }
  });
}

export function getClient() {
  return client;
}

// FIX 1: everything LocalAuth ever writes under STORAGE_DIR for this app.
// We never pass a `clientId` to LocalAuth (single-account app), so the actual
// Chromium profile lives at `.wwebjs_auth/session` — but we wipe the entire
// `.wwebjs_auth` tree (not just that one subfolder) so any `session-<id>`
// directory left behind by a future multi-account change, plus the separate
// `.wwebjs_cache` dir, are always covered too.
function getSessionWipeTargets() {
  return [config.sessionAuthDir, path.join(config.storageDir, '.wwebjs_cache')];
}

function listLeftoverWipeTargets() {
  return getSessionWipeTargets().filter((dirPath) => fs.existsSync(dirPath));
}

const SESSION_WIPE_MAX_ATTEMPTS = 5;
const SESSION_WIPE_RETRY_DELAY_MS = 2000;

// FIX 1.2/1.3: called only AFTER the old client has been destroyed (Chromium
// closed), so we're never racing the browser's own profile-dir writes. Retries
// up to 5 times, 2s apart, verifying the filesystem after every attempt — the
// caller must not initialize a fresh client until this resolves, otherwise the
// new client can boot against leftover IndexedDB/localStorage from the
// already-unlinked account and get immediately kicked with reason LOGOUT
// (the root cause of the account-switch loop).
async function wipeSessionData() {
  const targets = getSessionWipeTargets();

  for (let attempt = 1; attempt <= SESSION_WIPE_MAX_ATTEMPTS; attempt += 1) {
    for (const dirPath of targets) {
      if (!fs.existsSync(dirPath)) continue;
      try {
        await fs.promises.rm(dirPath, { recursive: true, force: true });
      } catch (err) {
        logger.debug(
          { err: err?.message || err, dirPath, attempt },
          'Session wipe hit a file lock — will verify and retry'
        );
      }
    }

    const leftover = listLeftoverWipeTargets();
    if (leftover.length === 0) {
      logger.info('Session wipe verified clean');
      return true;
    }

    if (attempt < SESSION_WIPE_MAX_ATTEMPTS) {
      logger.warn({ leftover, attempt }, 'Session wipe left data behind — retrying in 2s...');
      await new Promise((resolve) => setTimeout(resolve, SESSION_WIPE_RETRY_DELAY_MS));
    } else {
      logger.error(`Session wipe INCOMPLETE: ${leftover.join(', ')}`);
    }
  }
  return false;
}

export async function logoutWhatsApp({ clearHistory = false } = {}) {
  if (switchingAccount) {
    logger.warn('logoutWhatsApp called while already switching accounts — ignoring duplicate request');
    return { ok: false, error: 'Account switch already in progress' };
  }
  switchingAccount = true;
  cancelPairingReload();
  freshPairing = false;
  // FIX 2.2/3: a manual dashboard logout is an explicit fresh start — clear
  // any loop-guard and pairing-rejection state left over from a prior
  // automatic recovery attempt.
  logoutDisconnectTimestamps = [];
  sessionRecoveryFailed = false;
  lastAuthenticatedAt = null;
  pairingRejectedHint = false;
  emitStatus('logging_out');

  try {
    if (startupWatchdog) {
      clearTimeout(startupWatchdog);
      startupWatchdog = null;
    }
    stopAuthenticatedWatchdog();
    authRetryCount = 0;

    if (client) {
      try {
        logger.info('Calling client.logout() to unlink device from phone...');
        await client.logout();
      } catch (err) {
        logger.warn({ err: err?.message || err }, 'client.logout() threw or client already disconnected (continuing)');
      }

      // FIX 1.3: strip listeners and fully close Chromium BEFORE deleting the
      // profile directory — deleting while the browser still has files open
      // is exactly what leaves stale session data behind on a locked file.
      logger.info('Destroying client and closing Puppeteer browser...');
      client.removeAllListeners();
      try {
        await client.destroy();
      } catch (err) {
        logger.warn({ err: err?.message || err }, 'client.destroy() threw (continuing)');
      }
      client = null;
    }

    const wipedClean = await wipeSessionData();
    if (!wipedClean) {
      logger.error(
        'Proceeding with fresh WhatsApp init despite an incomplete session wipe — a stale-session LOGOUT loop may recur'
      );
    }

    if (clearHistory) {
      logger.info('Wiping all chat history and conversation memory as requested...');
      try {
        clearAllChatHistory();
      } catch (err) {
        logger.error({ err: err?.message || err }, 'Failed to wipe chat history during logout');
      }
    }

    const logoutMsgText = 'WhatsApp account was logged out from the dashboard. Waiting for a new QR scan.';
    logMessage({
      contactId: 'system',
      contactName: 'System',
      direction: 'out',
      body: logoutMsgText,
      status: 'whatsapp-logout'
    });
    ioRef?.emit('message:new', {
      contactId: 'system',
      contactName: 'System',
      direction: 'out',
      body: logoutMsgText,
      status: 'whatsapp-logout',
      createdAt: new Date().toISOString()
    });

    // FIX 3.3: exactly one alert for the intentional dashboard logout. The
    // 'disconnected' events that follow (old client tearing down, new client
    // booting) are all suppressed by the `switchingAccount` check below.

    // FIX 2.4: subscribe for the fresh client's 'qr' event BEFORE starting
    // init, so we can't miss it — then keep `switchingAccount` true for the
    // whole re-init, not just until initWhatsApp() resolves (initialize()
    // resolves once the page is loaded, well before 'qr' actually fires).
    // Clearing the flag too early was what let a stray disconnect from the
    // still-booting fresh client fall through to the alert/reconnect logic.
    logger.info('Reinitializing fresh WhatsApp client for new QR scan...');
    const qrWaitPromise = waitForFreshQr(30000);
    await initWhatsApp(ioRef);
    const reachedQr = await qrWaitPromise;
    if (reachedQr) {
      logger.info('Fresh client reached QR state — account switch complete');
    } else {
      logger.warn(
        'Fresh client did not reach QR state within 30s of reinitializing — clearing switchingAccount anyway so the app does not get stuck'
      );
    }
    return { ok: true };
  } catch (err) {
    logger.error({ err: err?.message || err }, 'Error during WhatsApp logout sequence');
    return { ok: false, error: err?.message || 'Logout failed' };
  } finally {
    switchingAccount = false;
  }
}

let syncingContacts = null;

// A second caller (the dashboard button during the startup sync) joins the
// run already in progress.
export function syncContactsFromWhatsApp() {
  syncingContacts ||= runContactSync().finally(() => {
    syncingContacts = null;
  });
  return syncingContacts;
}

async function runContactSync() {
  if (!client || (connectionStatus !== 'ready' && connectionStatus !== 'connected')) {
    logger.warn('WhatsApp client is not ready for contact sync');
    return { ok: false, count: 0 };
  }

  // Small delay so WhatsApp Web finishes populating its internal chat store
  await new Promise((resolve) => setTimeout(resolve, 2000));

  try {
    logger.info('Syncing contacts & chat names from WhatsApp...');
    const entries = await client.pupPage.evaluate(readChatDirectory);

    getDb().transaction(() => {
      for (const { id, name, number } of entries) {
        const isGroup = id.endsWith('@g.us') || id.endsWith('@newsletter');
        // A title that is only a phone number is not a name.
        const realName = name && !isRawId(name) && !/^\+?[\d\s()-]+$/.test(name) ? name.trim() : null;
        upsertContact({ id, name: realName, number, isGroup });
      }
    })();

    logger.info({ count: entries.length }, 'Finished syncing contacts & chat names from WhatsApp');
    return { ok: true, count: entries.length };
  } catch (err) {
    logger.warn({ err: err?.message || err }, 'Contact sync deferred (WhatsApp chat store populating)');
    return { ok: false, error: err?.message || 'Sync failed' };
  }
}

export default {
  initWhatsApp,
  getConnectionStatus,
  getLastQr,
  getClient,
  destroyClient,
  getSelfChatId,
  sendSelfMessage,
  isSwitchingAccount,
  getClientInfo,
  logoutWhatsApp,
  syncContactsFromWhatsApp
};
