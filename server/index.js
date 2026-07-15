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

import authRoutes from './routes/auth.js';
import settingsRoutes from './routes/settings.js';
import contactsRoutes from './routes/contacts.js';
import logsRoutes from './routes/logs.js';
import statusRoutes from './routes/status.js';

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.logsDir, { recursive: true });

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

app.use('/api/auth', authRoutes);
app.use('/api/settings', requireAuth, settingsRoutes);
app.use('/api/contacts', requireAuth, contactsRoutes);
app.use('/api/logs', requireAuth, logsRoutes);
app.use('/api/status', requireAuth, statusRoutes);

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
});

server.listen(config.port, () => {
  logger.info(`🌸 Sheuli dashboard + API listening on port ${config.port}`);
  initWhatsApp(io).catch((err) => {
    logger.error({ err: err.message }, 'Failed to initialize WhatsApp client');
  });
});

process.on('unhandledRejection', (reason) => {
  if (reason && typeof reason === 'object' && Object.keys(reason).length === 0) {
    return;
  }
  logger.error({ reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  logger.error({ err: err.message, stack: err.stack }, 'Uncaught exception');
});

async function gracefulShutdown(signal) {
  logger.info(`Received ${signal} — shutting down Sheuli gracefully...`);
  await destroyClient();
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
