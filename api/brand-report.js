/**
 * GET/POST /api/brand-report — full scan report per brand (file local, Vercel Blob live).
 */
const { sendJson } = require('./_scan-core.js');
const {
  handleBrandReportGet,
  handleBrandReportPost,
} = require('./go-live-audit-brand-reports-api.cjs');

function corsPreflight(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end();
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    corsPreflight(res);
    return;
  }
  try {
    if (req.method === 'GET') {
      await handleBrandReportGet(req, res, sendJson);
      return;
    }
    if (req.method === 'POST') {
      await handleBrandReportPost(req, res, sendJson);
      return;
    }
    sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: String((e && e.message) || e) });
  }
};
