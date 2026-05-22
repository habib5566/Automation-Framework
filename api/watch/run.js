/**
 * POST /api/watch/run — scan all brands (one pass; 60s max on Vercel).
 */
const { sendJson } = require('../_scan-core.js');
const { handleWatchRun } = require('../go-live-audit-brands-api.cjs');

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
