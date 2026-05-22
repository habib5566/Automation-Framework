/**
 * GET/POST /api/brands — brand watch list (read-only on Vercel).
 */
const { sendJson } = require('./_scan-core.js');
const {
  handleBrandsGet,
  handleBrandsPost,
} = require('./go-live-audit-brands-api.cjs');

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
      await handleBrandsGet(res, sendJson);
      return;
    }
    if (req.method === 'POST') {
      await handleBrandsPost(req, res, sendJson);
      return;
    }
    sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: String((e && e.message) || e) });
  }
};
