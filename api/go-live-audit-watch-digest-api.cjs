'use strict';

/**
 * POST /api/watch/digest-email — email only (no scan core / chromium).
 */
require('./go-live-audit-smtp-env.cjs');

const { readBody } = require('./go-live-audit-send-json.cjs');
const { maybeSendWatchDigestEmail } = require('./go-live-audit-email-notify.js');

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

async function handleWatchDigest(req, res, sendJson) {
  let requestJson = {};
  try {
    const raw = await readBody(req, { maxBytes: 3_500_000 });
    if (raw) requestJson = JSON.parse(raw);
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (/too large/i.test(msg)) {
      sendJson(res, 413, {
        ok: false,
        error:
          'Watch digest request too large. Redeploy latest code (compact payload). Or scan fewer brands per run.',
        digestEmail: { error: msg },
      });
      return;
    }
    sendJson(res, 400, {
      ok: false,
      error: 'Invalid JSON body: ' + msg.slice(0, 160),
      digestEmail: { error: msg },
    });
    return;
  }
  const entries = requestJson.entries || requestJson.digestEntries;
  if (!Array.isArray(entries) || !entries.length) {
    sendJson(res, 400, {
      ok: false,
      error: 'Send { entries: [...] } from completed watch run',
      digestEmail: { error: 'No entries' },
    });
    return;
  }
  try {
    const digestEmail = await maybeSendWatchDigestEmail(requestJson, entries);
    sendJson(res, 200, { ok: true, digestEmail, brandCount: entries.length });
  } catch (e) {
    const msg = apiErrorString(e);
    sendJson(res, 500, { ok: false, error: msg, digestEmail: { error: msg } });
  }
}

module.exports = { handleWatchDigest };
