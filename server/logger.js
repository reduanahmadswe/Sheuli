import fs from 'node:fs';
import pino from 'pino';
import config from './config.js';

fs.mkdirSync(config.logsDir, { recursive: true });

const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    base: { app: 'sheuli' },
    timestamp: pino.stdTimeFunctions.isoTime
  },
  config.isProduction
    ? pino.destination({ dest: `${config.logsDir}/sheuli.log`, mkdir: true })
    : pino.transport({
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,app' }
      })
);

export default logger;
