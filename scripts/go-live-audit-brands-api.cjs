'use strict';

const {
  loadBrandsWatch,
  saveBrandsWatch,
  upsertBrand,
  listEnabledBrands,
  isReadOnlyDatastore,
} = require('./go-live-audit-brand-watch.cjs');
function readBody(req, opts) {
  const maxBytes = (opts && opts.maxBytes) || 500_000;
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > maxBytes) {
        req.destroy();
        reject(new Error('body too large (max ' + Math.round(maxBytes / 1024) + ' KB)'));
      }
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

async function handleBrandsGet(res, sendJson) {
  const doc = loadBrandsWatch();
  sendJson(res, 200, {
    ok: true,
    brands: doc.brands || [],
    updatedAt: doc.updatedAt,
    readOnly: isReadOnlyDatastore(),
  });
}

async function handleBrandsPost(req, res, sendJson) {
  let json;
  try {
    json = JSON.parse((await readBody(req)) || '{}');
  } catch {
    sendJson(res, 400, { ok: false, error: 'Invalid JSON' });
    return;
  }
  if (json.replace && Array.isArray(json.brands)) {
    try {
      const doc = loadBrandsWatch();
      doc.brands = json.brands;
      saveBrandsWatch(doc);
      sendJson(res, 200, { ok: true, brands: doc.brands });
    } catch (e) {
      if (e && e.code === 'READ_ONLY_DEPLOY') {
        sendJson(res, 503, { ok: false, readOnly: true, error: e.message });
        return;
      }
      throw e;
    }
    return;
  }
  if (json.name && json.url) {
    try {
      const b = upsertBrand(json);
      sendJson(res, 200, { ok: true, brand: b });
    } catch (e) {
      if (e && e.code === 'READ_ONLY_DEPLOY') {
        sendJson(res, 503, { ok: false, readOnly: true, error: e.message });
        return;
      }
      throw e;
    }
    return;
  }
  sendJson(res, 400, { ok: false, error: 'Send { name, url } or { replace: true, brands: [] }' });
}

function apiErrorString(err) {
  if (err == null) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err.message) return String(err.message);
  try {
    return JSON.stringify(err).slice(0, 500);
  } catch {
    return String(err);
  }
}

async function handleWatchRun(req, res, sendJson) {
  const { handleWatchRun: run } = require('./go-live-audit-watch-run-api.cjs');
  return run(req, res, sendJson);
}

async function handleWatchDigest(req, res, sendJson) {
  const { handleWatchDigest: digestHandler } = require('./go-live-audit-watch-digest-api.cjs');
  return digestHandler(req, res, sendJson);
}

module.exports = { handleBrandsGet, handleBrandsPost, handleWatchRun, handleWatchDigest };
