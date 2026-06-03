/**
 * POST /api/watch/digest-email — one combined email after all brands scanned (Vercel batches).
 */
if (process.env.VERCEL) {
  process.env.AWS_LAMBDA_JS_RUNTIME = process.env.AWS_LAMBDA_JS_RUNTIME || 'nodejs22.x';
}
require('../go-live-audit-smtp-env.cjs');

const { sendJson } = require('../_scan-core.js');
const { handleWatchDigest } = require('../go-live-audit-brands-api.cjs');

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
    await handleWatchDigest(req, res, sendJson);
  } catch (e) {
    sendJson(res, 500, { ok: false, error: String((e && e.message) || e) });
  }
};
