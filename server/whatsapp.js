import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import qrcode from 'qrcode';
import pkg from 'whatsapp-web.js';
import config from './config.js';
import logger from './logger.js';
import { generateReply } from './ai.js';
import { classifyChatId } from './chatFilter.js';
import { isSheuliActive } from './schedule.js';
import { sendAlert } from './alerts.js';
import { isCostLimitReached, recordApiCost } from './costGuard.js';
import { runDailySummary } from './summary.js';
import {
  upsertContact,
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
  countRepliesInLastHour
} from './db.js';

const { Client, LocalAuth } = pkg;

let client = null;
let ioRef = null;
let connectionStatus = 'initializing'; // initializing | qr | connected | disconnected | auth_failure
let lastQr = null;

// In-memory de-dup cache (mirrors the processed_messages table for fast-path checks)
// and a per-contact busy lock so a second incoming message can't trigger a second
// reply while Sheuli is still generating/sending one for that contact.
const processedMessageIds = new Set();
const busyContacts = new Set();

// FEATURE 1: tracks whether the last connection event was a disconnect/auth
// failure, so a subsequent 'ready' event knows to send a "back online"
// recovery alert (and only then — not on the very first connect ever).
let hadConnectionIssue = false;

function emitStatus(status) {
  connectionStatus = status;
  if (status === 'connected') lastQr = null;
  ioRef?.emit('whatsapp:status', { status });
}

function randomDelay(minMs = 3000, maxMs = 8000) {
  return new Promise((resolve) => setTimeout(resolve, minMs + Math.random() * (maxMs - minMs)));
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
        await message.reply('😔 Summary বানাতে সমস্যা হয়েছে, একটু পরে আবার চেষ্টা করো।');
      } catch {
        // Ignore — best-effort error notice only.
      }
    }
    return true;
  }

  if (command !== '/on' && command !== '/off') return false;

  const settings = getAllSettings();

  // FEATURE 2: while schedule mode is in control, /on and /off don't toggle
  // anything — the schedule is the single source of truth for when Sheuli replies.
  if (settings.mode === 'schedule') {
    await message.reply(
      `🌙 Sheuli is in schedule mode (${settings.scheduleStart}–${settings.scheduleEnd}). ` +
        'Switch to manual mode from the dashboard to control her manually.'
    );
    return true;
  }

  if (command === '/on') {
    setSetting('autoReplyEnabled', true);
    ioRef?.emit('settings:updated', getAllSettings());
    await message.reply('🌸 Sheuli is now ON');
    return true;
  }

  setSetting('autoReplyEnabled', false);
  ioRef?.emit('settings:updated', getAllSettings());
  await message.reply('🌙 Sheuli is now OFF');
  return true;
}

async function handleIncomingMessage(message) {
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
  const selfId = client.info?.wid?._serialized;
  const isSelfChat = selfId && chatId === selfId;

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
  if (chat?.isGroup) {
    logQuickSkip(chatId, 'skipped-group');
    return;
  }

  // Messages sent by the owner: only handle /on /off in the self chat —
  // anything else the owner sends (in any chat) is deliberately left alone.
  if (message.fromMe) {
    if (isSelfChat) {
      await handleSelfCommand(message, message.body || '');
    } else {
      logQuickSkip(chatId, 'skipped-self');
    }
    return;
  }

  let contactName = chatId;
  let contactNumber = chatId.replace('@c.us', '').replace('@lid', '');
  let candidateJids = [];
  try {
    const waContact = await message.getContact();
    contactName = waContact?.pushname || waContact?.name || contactNumber;
    if (waContact?.id?._serialized && waContact.id._serialized.endsWith('@c.us')) {
      candidateJids.push(waContact.id._serialized);
      contactNumber = waContact.id._serialized.replace('@c.us', '');
    } else if (waContact?.number && waContact.number !== chatId.replace('@lid', '')) {
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

  const incomingBody = (message.body || '').trim();

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
    createdAt: new Date().toISOString()
  });

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

  if (settings.whitelistMode && !contact?.whitelisted) {
    recordSkip('skipped');
    return;
  }

  // ── FEATURE 2: schedule enforcement ─────────────────────────────────────
  // Re-evaluated fresh on every incoming message (pure function, no cached
  // flag) so a cutoff always takes effect immediately, even after a restart.
  if (!isSheuliActive(settings)) {
    recordSkip(settings.mode === 'schedule' ? 'skipped-outside-schedule' : 'skipped');
    return;
  }

  // rateLimitPerHour is read fresh from settings on every message (no cached
  // counter), so raising/lowering it — or turning it off entirely — takes
  // effect immediately on the contact's very next message, no restart needed.
  // 0 means unlimited: skip the check (and the DB query) entirely.
  const rateLimit = settings.rateLimitPerHour ?? config.defaults.rateLimitPerHour;
  if (rateLimit > 0) {
    const replyCount = countRepliesInLastHour(chatId);
    if (replyCount >= rateLimit) {
      recordSkip('rate_limited');
      return;
    }
  }

  // FEATURE 2: daily cost guard — once the configured limit is hit, stop
  // making OpenAI calls for the rest of the local day rather than risk a
  // surprise bill from a flood of messages.
  if (isCostLimitReached()) {
    recordSkip('skipped-cost-limit');
    return;
  }

  // Per-contact processing lock: if Sheuli is still generating/sending a reply
  // for this contact, drop this message rather than risk a second reply.
  if (busyContacts.has(chatId)) {
    logger.debug({ chatId }, 'Contact is already being processed — dropping message to avoid a duplicate reply');
    recordSkip('skipped');
    return;
  }
  busyContacts.add(chatId);

  const introDue = isIntroDue(priorContact);

  try {
    const { reply, promptTokens, completionTokens } = await generateReply({
      contactId: chatId,
      incomingBody,
      history: conversationHistory,
      isFirstReply: introDue
    });

    recordApiCost(promptTokens, completionTokens).catch((err) => {
      logger.warn({ err: err?.message || err }, 'Failed to record API cost');
    });

    try {
      if (chat && chat.sendStateTyping) {
        await chat.sendStateTyping();
      }
    } catch (typingErr) {
      logger.debug({ err: typingErr?.message || typingErr }, 'Could not send typing state (ignoring)');
    }

    await randomDelay(3000, 8000);

    let sentSuccess = false;
    let lastErr = null;

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
    busyContacts.delete(chatId);
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

  try {
    const puppeteerModule = await import('puppeteer');
    const defaultPath = (puppeteerModule.default || puppeteerModule).executablePath?.();
    if (defaultPath && fs.existsSync(defaultPath)) {
      return defaultPath;
    }
  } catch {
    // Ignore and fallback to system candidates
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
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
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

  return undefined;
}

let isResetting = false;
let startupWatchdog = null;

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
  if (startupWatchdog) {
    clearTimeout(startupWatchdog);
    startupWatchdog = null;
  }
  if (client) {
    logger.info('Shutting down WhatsApp client cleanly...');
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
  if (isResetting) return;
  isResetting = true;
  if (startupWatchdog) {
    clearTimeout(startupWatchdog);
    startupWatchdog = null;
  }
  try {
    if (client) {
      logger.info('Destroying existing WhatsApp client and browser instance...');
      try {
        await client.destroy();
      } catch {
        // Ignore destroy error if browser process already terminated
      }
      client = null;
    }

    if (reason === 'LOGOUT' || reason === 'auth_failure') {
      try {
        const sessionDir = path.join(config.sessionAuthDir, 'session');
        if (fs.existsSync(sessionDir)) {
          logger.info('Removing stale/logged-out session data so a fresh QR code can be generated...');
          fs.rmSync(sessionDir, { recursive: true, force: true });
        }
      } catch (err) {
        logger.warn({ err: err?.message || err }, 'Failed to remove stale session dir');
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

export async function initWhatsApp(io) {
  ioRef = io;
  emitStatus('initializing');

  if (startupWatchdog) {
    clearTimeout(startupWatchdog);
    startupWatchdog = null;
  }

  if (client) {
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

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: config.sessionAuthDir }),
    puppeteer: puppeteerOptions
  });

  startupWatchdog = setTimeout(() => {
    if (connectionStatus === 'initializing') {
      logger.warn('WhatsApp client stuck initializing for over 90s — resetting and attempting clean reconnect...');
      resetClient('startup_timeout');
    }
  }, 90000);

  client.on('loading_screen', (percent, message) => {
    logger.info(`WhatsApp Web loading: ${percent}% — ${message}`);
  });

  client.on('change_state', (state) => {
    logger.info(`WhatsApp client state changed to: ${state}`);
  });

  client.on('qr', async (qr) => {
    if (startupWatchdog) {
      clearTimeout(startupWatchdog);
      startupWatchdog = null;
    }
    emitStatus('qr');
    try {
      const qrDataUrl = await qrcode.toDataURL(qr);
      lastQr = qrDataUrl;
      ioRef?.emit('whatsapp:qr', { qr: qrDataUrl });
      logger.info('QR code generated — scan it from the dashboard or terminal below');
      const qrcodeTerminal = await import('qrcode-terminal');
      qrcodeTerminal.default.generate(qr, { small: true });
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to generate QR code');
    }
  });

  client.on('ready', () => {
    if (startupWatchdog) {
      clearTimeout(startupWatchdog);
      startupWatchdog = null;
    }
    emitStatus('connected');
    logger.info('Sheuli is connected to WhatsApp');

    // FEATURE 1: recovery alert — only fires if we previously alerted about a
    // disconnect/auth failure, never on the very first connect.
    if (hadConnectionIssue) {
      hadConnectionIssue = false;
      sendAlert('🟢 Sheuli is back online.').catch((err) => {
        logger.warn({ err: err?.message || err }, 'Failed to send recovery alert');
      });
    }
  });

  client.on('authenticated', () => {
    logger.info('WhatsApp authentication successful');
  });

  client.on('auth_failure', async (msg) => {
    if (startupWatchdog) {
      clearTimeout(startupWatchdog);
      startupWatchdog = null;
    }
    emitStatus('auth_failure');
    logger.error({ msg }, 'WhatsApp authentication failed — cleaning up session...');
    hadConnectionIssue = true;
    sendAlert(`🔴 Sheuli lost WhatsApp connection: ${msg}. Scan QR again from the dashboard.`).catch((err) => {
      logger.warn({ err: err?.message || err }, 'Failed to send auth-failure alert');
    });
    await resetClient('auth_failure');
  });

  client.on('disconnected', async (reason) => {
    if (startupWatchdog) {
      clearTimeout(startupWatchdog);
      startupWatchdog = null;
    }
    emitStatus('disconnected');
    logger.warn({ reason }, 'WhatsApp disconnected — cleaning up and attempting clean reconnect...');
    hadConnectionIssue = true;
    sendAlert(`🔴 Sheuli lost WhatsApp connection: ${reason}. Scan QR again from the dashboard.`).catch((err) => {
      logger.warn({ err: err?.message || err }, 'Failed to send disconnect alert');
    });
    await resetClient(reason);
  });

  // Defensive: guarantee a single 'message' listener even if something re-attaches
  // one on this same client instance (a fresh Client is normally created on every
  // reconnect, but this keeps that invariant true if that ever changes).
  client.removeAllListeners('message');
  client.on('message', async (message) => {
    try {
      await handleIncomingMessage(message);
    } catch (err) {
      logger.error({ err: err.message }, 'Unhandled error while processing message');
    }
  });

  await client.initialize();
  return client;
}

export function getClient() {
  return client;
}

export default {
  initWhatsApp,
  getConnectionStatus,
  getLastQr,
  getClient,
  destroyClient,
  getSelfChatId,
  sendSelfMessage
};
