import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import qrcode from 'qrcode';
import pkg from 'whatsapp-web.js';
import config from './config.js';
import logger from './logger.js';
import { generateReply } from './ai.js';
import {
  upsertContact,
  touchContact,
  getContact,
  logMessage,
  getRecentConversation,
  getAllSettings,
  setSetting
} from './db.js';

const { Client, LocalAuth } = pkg;

let client = null;
let ioRef = null;
let connectionStatus = 'initializing'; // initializing | qr | connected | disconnected | auth_failure
let lastQr = null;

function emitStatus(status) {
  connectionStatus = status;
  if (status === 'connected') lastQr = null;
  ioRef?.emit('whatsapp:status', { status });
}

function randomDelay(minMs = 3000, maxMs = 8000) {
  return new Promise((resolve) => setTimeout(resolve, minMs + Math.random() * (maxMs - minMs)));
}

function getCurrentTimeInZone(timezone) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  return fmt.format(new Date());
}

function isWithinWindow(current, start, end) {
  if (start === end) return true;
  const toMinutes = (t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const c = toMinutes(current);
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s < e) return c >= s && c < e;
  return c >= s || c < e;
}

function isAutoReplyActive(settings) {
  if (settings.autoReplyEnabled) return true;
  if (settings.scheduleEnabled) {
    const current = getCurrentTimeInZone(settings.timezone || config.timezone);
    return isWithinWindow(current, settings.scheduleStart, settings.scheduleEnd);
  }
  return false;
}

async function handleSelfCommand(message, body) {
  const command = body.trim().toLowerCase();

  if (command === '/on') {
    setSetting('autoReplyEnabled', true);
    ioRef?.emit('settings:updated', getAllSettings());
    await message.reply('🌸 Sheuli is now ON');
    return true;
  }
  if (command === '/off') {
    setSetting('autoReplyEnabled', false);
    ioRef?.emit('settings:updated', getAllSettings());
    await message.reply('🌙 Sheuli is now OFF');
    return true;
  }
  return false;
}

async function handleIncomingMessage(message) {
  const chatId = message.from;
  const selfId = client.info?.wid?._serialized;
  const isSelfChat = selfId && chatId === selfId;

  // Group chats: never reply
  if (chatId.endsWith('@g.us')) {
    return;
  }

  // Status/broadcast: never reply
  if (chatId === 'status@broadcast' || message.isStatus) {
    return;
  }

  // Messages sent by the owner: only handle /on /off in the self chat
  if (message.fromMe) {
    if (isSelfChat) {
      await handleSelfCommand(message, message.body || '');
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

  if (!isAutoReplyActive(settings)) {
    recordSkip('skipped');
    return;
  }

  try {
    const { reply, promptTokens, completionTokens } = await generateReply({
      contactId: chatId,
      incomingBody,
      history: conversationHistory
    });

    try {
      const chat = await message.getChat();
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
  }
}

export function getConnectionStatus() {
  return connectionStatus;
}

export function getLastQr() {
  return lastQr;
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
    await resetClient('auth_failure');
  });

  client.on('disconnected', async (reason) => {
    if (startupWatchdog) {
      clearTimeout(startupWatchdog);
      startupWatchdog = null;
    }
    emitStatus('disconnected');
    logger.warn({ reason }, 'WhatsApp disconnected — cleaning up and attempting clean reconnect...');
    await resetClient(reason);
  });

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

export default { initWhatsApp, getConnectionStatus, getLastQr, getClient, destroyClient };
