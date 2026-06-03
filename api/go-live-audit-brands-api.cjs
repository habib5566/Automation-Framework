'use strict';

const {
  loadBrandsWatch,
  saveBrandsWatch,
  upsertBrand,
  listEnabledBrands,
  isReadOnlyDatastore,
} = require('./go-live-audit-brand-watch.cjs');
const { runWatchPass } = require('./go-live-audit-watch-runner.cjs');
const { maybeSendWatchDigestEmail } = require('./go-live-audit-email-notify.js');

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 500_000) {
        req.destroy();
        reject(new Error('body too large'));
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

async function handleWatchRun(req, res, sendJson) {
  let requestJson = {};
  try {
    const raw = await readBody(req);
    if (raw) requestJson = JSON.parse(raw);
  } catch {
    requestJson = {};
  }
  runWatchPass(requestJson)
    .then((summary) => sendJson(res, 200, { ok: true, summary, enabled: listEnabledBrands().length }))
    .catch((e) => sendJson(res, 500, { ok: false, error: String(e.message || e) }));
}

async function handleWatchDigest(req, res, sendJson) {
  let requestJson = {};
  try {
    const raw = await readBody(req);
    if (raw) requestJson = JSON.parse(raw);
  } catch {
    requestJson = {};
  }
  const entries = requestJson.entries || requestJson.digestEntries;
  if (!Array.isArray(entries) || !entries.length) {
    sendJson(res, 400, { ok: false, error: 'Send { entries: [...] } from completed watch run' });
    return;
  }
  try {
    const digestEmail = await maybeSendWatchDigestEmail(requestJson, entries);
    sendJson(res, 200, { ok: true, digestEmail, brandCount: entries.length });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: String(e.message || e) });
  }
}

module.exports = { handleBrandsGet, handleBrandsPost, handleWatchRun, handleWatchDigest };
