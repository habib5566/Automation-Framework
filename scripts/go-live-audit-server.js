/**
 * Go-Live Audit — local static UI + POST /api/scan (same origin).
 * Usage: node scripts/go-live-audit-server.js
 * Open: http://localhost:3940 (or PORT / GO_LIVE_AUDIT_PORT)
 * Vercel: see go-live-audit/VERCEL.md — Render: render.yaml + go-live-audit/LIVE.md
 */
require('./go-live-audit-smtp-env.cjs');

const http = require('http');
const fs = require('fs');
const path = require('path');
const { handleScan, sendJson } = require('./go-live-audit-core');
const { getRuntimeInfoSync, fetchNodeLatestLts } = require('./go-live-audit-runtime-info.cjs');
const { getEmailConfigStatus } = require('./go-live-audit-email-config.cjs');
const {
  handleBrandsGet,
  handleBrandsPost,
  handleWatchRun,
} = require('./go-live-audit-brands-api.cjs');

/** Render / Railway / Fly set PORT; local uses GO_LIVE_AUDIT_PORT or 3940. */
const PORT = Number(process.env.PORT || process.env.GO_LIVE_AUDIT_PORT || 3940);
const PUBLIC = path.join(__dirname, '..', 'go-live-audit', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

function safeJoin(root, requestPath) {
  const raw = decodeURIComponent((requestPath || '/').split('?')[0]);
  const trimmed = raw.replace(/^\/+/, '') || 'index.html';
  const normalized = path.normalize(path.join(root, trimmed));
  if (!normalized.startsWith(root)) return null;
  return normalized;
}

const server = http.createServer((req, res) => {
  const pathOnly = (req.url || '').split('?')[0];

  if (pathOnly === '/api/ping' && req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      route: '/api/ping',
      mode: 'full-node-server',
      hint: 'Same stack as npm run go-live:audit — real Playwright console scan.',
    });
    return;
  }

  if (pathOnly === '/api/email-status' && req.method === 'GET') {
    try {
      sendJson(res, 200, { ok: true, email: getEmailConfigStatus() });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: String((e && e.message) || e) });
    }
    return;
  }

  if (pathOnly === '/api/runtime' && req.method === 'GET') {
    (async () => {
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
    })();
    return;
  }

  if (pathOnly === '/api/scan') {
    handleScan(req, res).catch((err) => sendJson(res, 500, { error: String(err.message || err) }));
    return;
  }

  if (pathOnly === '/api/brands' && req.method === 'GET') {
    handleBrandsGet(res, sendJson).catch((e) => sendJson(res, 500, { ok: false, error: String(e.message || e) }));
    return;
  }
  if (pathOnly === '/api/brands' && req.method === 'POST') {
    handleBrandsPost(req, res, sendJson).catch((e) => sendJson(res, 500, { ok: false, error: String(e.message || e) }));
    return;
  }
  if (pathOnly === '/api/watch/run' && req.method === 'POST') {
    handleWatchRun(req, res, sendJson).catch((e) => sendJson(res, 500, { ok: false, error: String(e.message || e) }));
    return;
  }

  const filePath = safeJoin(PUBLIC, req.url || '/');
  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    const index = path.join(PUBLIC, 'index.html');
    if (fs.existsSync(index)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(index));
      return;
    }
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(fs.readFileSync(filePath));
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Go-Live Audit: http://localhost:${PORT}`);
  const em = getEmailConfigStatus();
  // eslint-disable-next-line no-console
  console.log('[go-live-audit] Email:', em.ready ? 'SMTP ready (' + (em.smtp.host || '') + ')' : em.detail);
  if (!em.ready) {
    // eslint-disable-next-line no-console
    console.log('[go-live-audit] Fix email: npm run go-live:email-setup');
  }
  // eslint-disable-next-line no-console
  console.log('Public URL tip: Vercel (see go-live-audit/VERCEL.md), Railway, Render, Fly, or ngrok: npx ngrok http ' + PORT);
});
