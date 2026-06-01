'use strict';

const {
  saveBrandReport,
  loadBrandReport,
  brandReportsStorageHint,
} = require('./go-live-audit-brand-reports.cjs');

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 6_000_000) {
        req.destroy();
        reject(new Error('body too large'));
      }
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

async function handleBrandReportGet(req, res, sendJson) {
  const u = new URL(req.url || '/', 'http://localhost');
  const key = u.searchParams.get('key') || u.searchParams.get('brand') || '';
  if (!key) {
    sendJson(res, 400, { ok: false, error: 'Missing ?key= or ?brand=' });
    return;
  }
  const report = await loadBrandReport(key);
  if (!report) {
    sendJson(res, 404, {
      ok: false,
      error: 'No saved report for this brand yet. Run a scan with Brand name first.',
      storage: brandReportsStorageHint(),
    });
    return;
  }
  sendJson(res, 200, { ok: true, report, storage: brandReportsStorageHint() });
}

async function handleBrandReportPost(req, res, sendJson) {
  let json;
  try {
    json = JSON.parse((await readBody(req)) || '{}');
  } catch (e) {
    sendJson(res, 400, { ok: false, error: 'Invalid JSON' });
    return;
  }
  if (!json.payload && !json.brandName) {
    sendJson(res, 400, { ok: false, error: 'Send brandName + payload or key + payload' });
    return;
  }
  const saved = await saveBrandReport(json);
  sendJson(res, 200, { ok: true, saved, storage: brandReportsStorageHint() });
}

module.exports = { handleBrandReportGet, handleBrandReportPost, brandReportsStorageHint };
