/**
 * POST /api/watch/run — scan all brands (one pass; 60s max on Vercel).
 */
if (process.env.VERCEL) {
  process.env.AWS_LAMBDA_JS_RUNTIME = process.env.AWS_LAMBDA_JS_RUNTIME || 'nodejs22.x';
  process.env.GO_LIVE_AUDIT_USE_SERVERLESS_CHROMIUM = '1';
}
require('../go-live-audit-chromium-env.cjs');

const { sendJson } = require('../go-live-audit-send-json.cjs');
const { handleWatchRun } = require('../go-live-audit-watch-run-api.cjs');

function corsPreflight(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end();
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    corsPreflight(res);
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }
  try {
    await handleWatchRun(req, res, sendJson);
  } catch (e) {
    sendJson(res, 500, { ok: false, error: String((e && e.message) || e) });
  }
};
