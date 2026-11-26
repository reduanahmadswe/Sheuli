import fs from 'node:fs';
import pino from 'pino';
import config from './config.js';

fs.mkdirSync(config.logsDir, { recursive: true });

// In production, log to BOTH stdout and a file:
// - stdout is what Railway/Docker/any container platform actually captures
//   for its log viewer — logging only to a file would make Sheuli's logs
//   invisible there.
// - the file (under STORAGE_DIR/logs, see config.js) preserves the existing
//   VPS/PM2 behavior (`pm2 logs sheuli`, log rotation, etc.) unchanged.
const destination = config.isProduction
  ? pino.multistream([{ stream: process.stdout }, { stream: pino.destination({ dest: `${config.logsDir}/sheuli.log`, mkdir: true }) }])
  : pino.transport({
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,app' }
    });

const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    base: { app: 'sheuli' },
    timestamp: pino.stdTimeFunctions.isoTime
  },
  destination
);

export default logger;
