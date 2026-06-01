/**
 * Vercel serverless: POST /api/scan
 * Body: { "url": "https://example.com" }
 */
if (process.env.VERCEL) {
  process.env.AWS_LAMBDA_JS_RUNTIME = process.env.AWS_LAMBDA_JS_RUNTIME || 'nodejs22.x';
  process.env.GO_LIVE_AUDIT_USE_SERVERLESS_CHROMIUM = '1';
}
require('./go-live-audit-chromium-env.cjs');

const { handleScan, sendJson } = require('./_scan-core.js');

module.exports = async (req, res) => {
  try {
    await handleScan(req, res);
  } catch (err) {
    sendJson(res, 500, { error: String(err && err.message ? err.message : err) });
  }
};
