require('dotenv').config();

function readNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const env = {
  baseURL: process.env.BASE_URL || 'http://localhost:3789',
  validUsername: process.env.VALID_USERNAME || 'admin',
  validPassword: process.env.VALID_PASSWORD || 'admin123',
  logLevel: (process.env.LOG_LEVEL || 'info').toLowerCase(),
  logToFile: String(process.env.LOG_TO_FILE ?? 'true').toLowerCase() !== 'false',
  actionTimeoutMs: readNumber(process.env.ACTION_TIMEOUT_MS, 15_000),
};

module.exports = { env };
