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
  countRepliesInLastHour,
  clearAllChatHistory
} from './db.js';

const { Client, LocalAuth } = pkg;

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
// dashboard logout or a successful authentication clears it.
let sessionRecoveryFailed = false;

function isLogoutReason(reason) {
  return LOGOUT_REASONS.has(reason);
}

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
// and a per-contact busy lock so a second incoming message can't trigger a second
// reply while Sheuli is still generating/sending one for that contact.
const processedMessageIds = new Set();
const busyContacts = new Set();

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
    sessionRecoveryFailed
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
  const rawChatId = message.from;
  const rawNumber = (rawChatId || '').replace('@c.us', '').replace('@lid', '').replace('@g.us', '');
  logger.info(
    `Incoming: ${chatTypeLabel(rawChatId)} from ${rawNumber || 'unknown'} — ${(message.body || '').slice(0, 30)}`
  );

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

  await client.initialize();
  return client;
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

  const timeoutMs = authRetryCount >= 3 ? 300000 : 90000;
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

    authRetryCount++;
    logger.warn(
      { attempt: authRetryCount },
      'Sheuli authenticated but `ready` did not fire within timeout — resetting and re-initializing...'
    );

    if (authRetryCount === 3) {
      sendAlert(
        '⚠️ Sheuli authenticated but never became ready after 3 attempts — may need attention'
      ).catch((err) => {
        logger.warn({ err: err?.message || err }, 'Failed to send watchdog Telegram alert');
      });
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
    // FIX 2.2: a successful scan proves the session is good again — clear the
    // loop guard so a future genuine logout gets the normal 2-strike grace.
    logoutDisconnectTimestamps = [];
    sessionRecoveryFailed = false;
    startAuthenticatedWatchdog();
  });

  clientInstance.on('ready', () => {
    if (startupWatchdog) {
      clearTimeout(startupWatchdog);
      startupWatchdog = null;
    }
    stopAuthenticatedWatchdog();
    authRetryCount = 0;
    emitStatus('ready');
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
      sendAlert('🟢 Sheuli is back online.').catch((err) => {
        logger.warn({ err: err?.message || err }, 'Failed to send recovery alert');
      });
    }
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
    sendAlert(`🔴 Sheuli lost WhatsApp connection: ${msg}. Scan QR again from the dashboard.`).catch((err) => {
      logger.warn({ err: err?.message || err }, 'Failed to send auth-failure alert');
    });
    await resetClient('auth_failure');
  });

  clientInstance.on('disconnected', async (reason) => {
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
        sendAlert("⚠️ Sheuli couldn't restore the session — please scan the QR from the dashboard").catch((err) => {
          logger.warn({ err: err?.message || err }, 'Failed to send loop-guard alert');
        });
        // One last, verified-clean attempt so the user actually has a QR to
        // scan — but the `sessionRecoveryFailed` gate above stops any further
        // ones if this also somehow gets LOGOUT-disconnected again.
        await resetClient(reason);
        return;
      }

      logger.warn({ reason }, 'WhatsApp session was logged out/unpaired — wiping session and reinitializing for a fresh QR...');
      sendAlert(`🔴 Sheuli lost WhatsApp connection: ${reason}. Scan QR again from the dashboard.`).catch((err) => {
        logger.warn({ err: err?.message || err }, 'Failed to send disconnect alert');
      });
      await resetClient(reason);
      return;
    }

    // FIX 2.3: other disconnect reasons (network blips etc.) keep the
    // existing reconnect-with-backoff behavior, unchanged.
    logger.warn({ reason }, 'WhatsApp disconnected — cleaning up and attempting clean reconnect...');
    sendAlert(`🔴 Sheuli lost WhatsApp connection: ${reason}. Scan QR again from the dashboard.`).catch((err) => {
      logger.warn({ err: err?.message || err }, 'Failed to send disconnect alert');
    });
    await resetClient(reason);
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
  // FIX 2.2: a manual dashboard logout is an explicit fresh start — clear any
  // loop-guard state left over from a prior automatic recovery attempt.
  logoutDisconnectTimestamps = [];
  sessionRecoveryFailed = false;
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
    sendAlert('🔄 WhatsApp logged out from the dashboard — waiting for a new QR scan.').catch((err) => {
      logger.warn({ err: err?.message || err }, 'Failed to send logout Telegram alert');
    });

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
  logoutWhatsApp
};
