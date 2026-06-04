'use strict';

/**
 * POST /api/watch/run — handler only (lazy-loads watch runner + scan core on scan).
 */
const { readBody } = require('./go-live-audit-send-json.cjs');
const { listEnabledBrands } = require('./go-live-audit-brand-watch.cjs');

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
  let requestJson = {};
  try {
    const raw = await readBody(req);
    if (raw) requestJson = JSON.parse(raw);
  } catch {
    requestJson = {};
  }
  try {
    const { runWatchPass } = require('./go-live-audit-watch-runner.cjs');
    const summary = await runWatchPass(requestJson);
    sendJson(res, 200, { ok: true, summary, enabled: listEnabledBrands().length });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: apiErrorString(e) });
  }
}

module.exports = { handleWatchRun };
