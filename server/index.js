import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import cookie from 'cookie';
import { Server } from 'socket.io';

import config from './config.js';
import logger from './logger.js';
import { requireAuth, COOKIE_NAME } from './middleware/auth.js';
import { initWhatsApp, getConnectionStatus, getLastQr, destroyClient } from './whatsapp.js';
import { getAllSettings, closeDb } from './db.js';
import { getScheduleStatus } from './schedule.js';
import { sendAlert } from './alerts.js';
import { startBackgroundJobs } from './jobs.js';
import { setSocketIo } from './summary.js';

import authRoutes from './routes/auth.js';
import settingsRoutes from './routes/settings.js';
import scheduleRoutes from './routes/schedule.js';
import contactsRoutes from './routes/contacts.js';
import logsRoutes from './routes/logs.js';
import statusRoutes from './routes/status.js';
import chatsRoutes from './routes/chats.js';
import summariesRoutes from './routes/summaries.js';
import diagnosticsRoutes from './routes/diagnostics.js';

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.logsDir, { recursive: true });
fs.mkdirSync(config.backup.dir, { recursive: true });

// One-time migration: earlier versions kept the WhatsApp session under
// <root>/data/wwebjs_auth. It now lives at STORAGE_DIR/.wwebjs_auth (see
// config.js) so it sits alongside the DB/backups/logs under one persistent
// root. Move an existing session over so an already-linked account survives
// this upgrade without a re-scan.
const legacySessionDir = path.join(config.dataDir, 'wwebjs_auth');
if (!fs.existsSync(config.sessionAuthDir) && fs.existsSync(legacySessionDir)) {
  fs.mkdirSync(path.dirname(config.sessionAuthDir), { recursive: true });
  fs.renameSync(legacySessionDir, config.sessionAuthDir);
  logger.info(
    { from: legacySessionDir, to: config.sessionAuthDir },
    'Migrated WhatsApp session folder to its new STORAGE_DIR location'
  );
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true }
});

app.set('io', io);
app.set('trust proxy', 1);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser(config.sessionSecret));

// Intentionally unauthenticated — Railway (and any other platform) healthcheck
// hits this directly with no session cookie.
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    whatsapp: getConnectionStatus() === 'connected' ? 'connected' : 'disconnected',
    uptime: process.uptime()
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/settings/schedule', requireAuth, scheduleRoutes);
app.use('/api/settings', requireAuth, settingsRoutes);
app.use('/api/contacts', requireAuth, contactsRoutes);
app.use('/api/logs', requireAuth, logsRoutes);
app.use('/api/status', requireAuth, statusRoutes);
app.use('/api/chats', requireAuth, chatsRoutes);
app.use('/api/summaries', requireAuth, summariesRoutes);
app.use('/api/diagnostics', requireAuth, diagnosticsRoutes);

const dashboardDist = path.join(config.rootDir, 'dashboard', 'dist');
if (fs.existsSync(dashboardDist)) {
  app.use(express.static(dashboardDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(dashboardDist, 'index.html'));
  });
}

app.use((err, req, res, next) => {
  logger.error({ err: err.message }, 'Unhandled Express error');
  res.status(500).json({ error: 'Internal server error' });
});

io.use((socket, next) => {
  try {
    const rawCookieHeader = socket.request.headers.cookie;
    if (!rawCookieHeader) return next(new Error('unauthorized'));
    const parsed = cookie.parse(rawCookieHeader);
    const rawValue = parsed[COOKIE_NAME];
    if (!rawValue) return next(new Error('unauthorized'));
    const unsigned = cookieParser.signedCookie(rawValue, config.sessionSecret);
    if (unsigned !== 'authenticated') return next(new Error('unauthorized'));
    return next();
  } catch (err) {
    return next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  logger.debug({ id: socket.id }, 'Dashboard client connected via WebSocket');
  socket.emit('whatsapp:status', { status: getConnectionStatus() });
  const qr = getLastQr();
  if (qr) socket.emit('whatsapp:qr', { qr });
  socket.emit('schedule:status', getScheduleStatus(getAllSettings()));
});

// Purely a display convenience for the dashboard (countdown / "next wake" text) —
// actual enforcement always re-evaluates isSheuliActive() live on each incoming
// message in whatsapp.js, so this timer can never cause a missed cutoff.
setInterval(() => {
  io.emit('schedule:status', getScheduleStatus(getAllSettings()));
}, 30000).unref();

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(`Port ${config.port} is already in use by another instance of Sheuli (or another process). Please close the running instance before starting a new one.`);
    process.exit(1);
  } else {
    logger.error({ err: err.message, code: err.code }, 'Server listen error');
  }
});

// Bind 0.0.0.0, not just localhost — required inside containers (Railway,
// Docker generally) where the platform's proxy connects from outside the
// container's loopback interface.
server.listen(config.port, '0.0.0.0', () => {
  logger.info(`🌸 Sheuli dashboard + API listening on 0.0.0.0:${config.port}`);
  setSocketIo(io);
  startBackgroundJobs();
  initWhatsApp(io).catch((err) => {
    logger.error({ err: err.message }, 'Failed to initialize WhatsApp client');
  });
});

// Bounds how long we'll wait for the crash alert before exiting anyway — a
// hung Telegram request must never keep the process from restarting under PM2.
const CRASH_ALERT_TIMEOUT_MS = 5000;

function alertWithTimeout(message) {
  return Promise.race([
    sendAlert(message).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, CRASH_ALERT_TIMEOUT_MS))
  ]);
}

process.on('unhandledRejection', async (reason) => {
  if (reason && typeof reason === 'object' && Object.keys(reason).length === 0) {
    return;
  }
  const message = reason instanceof Error ? reason.message : String(reason);
  logger.error({ reason: message }, 'Unhandled promise rejection — alerting and exiting (PM2 will restart)');
  await alertWithTimeout(`🔴 Sheuli crashed (unhandled rejection): ${message}`);
  process.exit(1);
});

process.on('uncaughtException', async (err) => {
  logger.error({ err: err.message, stack: err.stack }, 'Uncaught exception — alerting and exiting (PM2 will restart)');
  await alertWithTimeout(`🔴 Sheuli crashed (uncaught exception): ${err.message}`);
  process.exit(1);
});

async function gracefulShutdown(signal) {
  // Railway sends SIGTERM on every redeploy/restart — close the WhatsApp
  // client and the DB cleanly so nothing is left mid-write.
  logger.info(`Received ${signal} — shutting down Sheuli gracefully...`);
  await destroyClient();
  try {
    closeDb();
  } catch (err) {
    logger.warn({ err: err?.message || err }, 'Error closing database (continuing shutdown)');
  }
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
