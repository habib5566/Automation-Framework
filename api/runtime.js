/**
 * GET /api/runtime — Node/npm, repo package version, key deps, latest Node LTS (from nodejs.org).
 */
const { sendJson } = require('./go-live-audit-send-json.cjs');
const { getRuntimeInfoSync, fetchNodeLatestLts } = require('./go-live-audit-runtime-info.cjs');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }
  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }
  try {
    const runtime = getRuntimeInfoSync();
    const lts = await fetchNodeLatestLts();
    if (lts && lts.version) {
      runtime.nodeLatestLts = lts.version;
      runtime.nodeLatestLtsCodename = lts.codename || null;
    }
    sendJson(res, 200, { ok: true, runtime });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: String((e && e.message) || e) });
  }
};
