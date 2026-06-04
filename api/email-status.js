/**
 * GET /api/email-status — is Gmail SMTP configured on this server?
 */
const { sendJson } = require('./go-live-audit-send-json.cjs');
const { getEmailConfigStatus } = require('./go-live-audit-email-config.cjs');

module.exports = (req, res) => {
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
  const status = getEmailConfigStatus();
  sendJson(res, 200, { ok: true, email: status });
};
