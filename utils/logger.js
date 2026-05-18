const fs = require('fs');
const path = require('path');
const { env } = require('./env');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const logDir = path.join(__dirname, '..', 'reports', 'logs');
const logFile = path.join(logDir, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

function shouldLog(level) {
  return LEVELS[level] <= (LEVELS[env.logLevel] ?? LEVELS.info);
}

function writeFileLine(line) {
  if (!env.logToFile) return;
  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(logFile, `${line}\n`, 'utf8');
  } catch {
    // Avoid crashing tests if log file cannot be written
  }
}

function formatLine(level, message, meta) {
  const ts = new Date().toISOString();
  const extra = meta ? ` ${safeStringify(meta)}` : '';
  return `[${ts}] [${level.toUpperCase()}] ${message}${extra}`;
}

function safeStringify(value) {
  try {
    if (value instanceof Error) {
      return JSON.stringify({ name: value.name, message: value.message, stack: value.stack });
    }
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function log(level, message, meta) {
  if (!shouldLog(level)) return;
  const line = formatLine(level, message, meta);
  // eslint-disable-next-line no-console
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  writeFileLine(line);
}

module.exports = {
  logFilePath: logFile,
  error: (message, meta) => log('error', message, meta),
  warn: (message, meta) => log('warn', message, meta),
  info: (message, meta) => log('info', message, meta),
  debug: (message, meta) => log('debug', message, meta),
};
