/**
 * POST /api/watch/digest-email — combined watch email (lightweight; no scan/chromium core).
 */
require('../go-live-audit-smtp-env.cjs');

const { sendJson } = require('../go-live-audit-send-json.cjs');
const { handleWatchDigest } = require('../go-live-audit-watch-digest-api.cjs');

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
    const msg = String((e && e.message) || e);
    sendJson(res, 500, {
      ok: false,
      error: msg,
      digestEmail: { error: msg },
    });
  }
};
