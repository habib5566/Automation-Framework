'use strict';

/**
 * Automatic multi-brand security watch — run all brands in brands-watch.json.
 * Usage:
 *   npm run go-live:watch          # one pass
 *   npm run go-live:watch:daemon   # repeat every GO_LIVE_WATCH_INTERVAL_MIN (default 30)
 *
 * Requires audit server OR runs scans in-process via runScanInternal (no HTTP).
 */
require('./go-live-audit-smtp-env.cjs');

const { listEnabledBrands } = require('./go-live-audit-brand-watch.cjs');
const { getAlertEmail } = require('./go-live-audit-defaults.cjs');
const { extractBrandScanSummary } = require('./go-live-audit-brand-matrix.cjs');
const { buildWatchDigestEntry, maybeSendWatchDigestEmail } = require('./go-live-audit-email-notify.js');

function isServerlessWatch() {
  return !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

function watchBatchLimit(requestJson) {
  if (requestJson && requestJson.limit != null) {
    const n = Number(requestJson.limit);
    if (Number.isFinite(n) && n > 0) return Math.min(Math.floor(n), 10);
  }
  return isServerlessWatch() ? 1 : 9999;
}

/** Public site URL for optional external /api/scan (must be UI origin — not VERCEL_URL alone). */
function getSelfScanApiBase(requestJson) {
  const uiOrigin = String(
    (requestJson && (requestJson.publicOrigin || requestJson.scanPublicOrigin)) || ''
  )
    .trim()
    .replace(/\/$/, '');
  if (uiOrigin && /^https?:\/\//i.test(uiOrigin)) return uiOrigin;
  const pub = String(process.env.GO_LIVE_AUDIT_PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (pub) return pub;
  return '';
}

/**
 * Vercel watch: call /api/scan per brand (identical to single-brand scan in the UI).
 */
async function scanOneBrandThroughScanApi(brand, requestJson) {
  const remoteBase = String((requestJson && requestJson.scanApiBase) || '').trim().replace(/\/$/, '');
  const base = remoteBase || getSelfScanApiBase(requestJson);
  if (!base) {
    throw new Error('No public scan URL — use in-process watch scan');
  }
  const bypass = String(
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET ||
      process.env.GO_LIVE_AUDIT_VERCEL_BYPASS ||
      ''
  ).trim();
  const body = {
    url: brand.url,
    brandName: brand.name,
    captureConsole: requestJson.captureConsole !== false,
    skipEmail: true,
    watchBatch: false,
    securityWatch: true,
  };
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'Automation-Framework-GoLiveAudit-Watch/1.0',
    'Bypass-Tunnel-Reminder': 'true',
    'ngrok-skip-browser-warning': 'true',
  };
  if (bypass) headers['x-vercel-protection-bypass'] = bypass;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 58_000);
  let r;
  try {
    r = await fetch(base + '/api/scan', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const text = await r.text();
  let result;
  try {
    result = JSON.parse(text || '{}');
  } catch {
    throw new Error('Scan API returned non-JSON (HTTP ' + r.status + '): ' + text.slice(0, 160));
  }
  if (!r.ok || result.ok === false) {
    const errMsg =
      typeof result.error === 'string'
        ? result.error
        : result.error && result.error.message
          ? String(result.error.message)
          : 'Scan failed HTTP ' + r.status;
    throw new Error(errMsg);
  }
  return { brand, result };
}

function mergeWatchSmtpFromRequest(json, requestJson) {
  const uiPass = String(
    (requestJson && (requestJson.gmailAppPassword || requestJson.smtpPass)) || ''
  )
    .trim()
    .replace(/\s+/g, '');
  const envPass = String(
    process.env.GO_LIVE_AUDIT_SMTP_PASS || process.env.GO_LIVE_AUDIT_GMAIL_APP_PASSWORD || ''
  )
    .trim()
    .replace(/\s+/g, '');
  const pickUi = uiPass.length >= 16 && !uiPass.includes('@');
  const pickEnv = envPass.length >= 16 && !envPass.includes('@');
  const pass = pickUi ? uiPass : pickEnv ? envPass : '';
  if (pass.length >= 16) {
    json.smtpUser =
      String((requestJson && requestJson.smtpUser) || '').trim() ||
      process.env.GO_LIVE_AUDIT_SMTP_USER ||
      getAlertEmail();
    json.smtpPass = pass;
    json.gmailAppPassword = pass;
    json.gmailUser = json.smtpUser;
  }
}

function buildScanJsonForBrand(brand, requestJson) {
  const json = {
    url: brand.url,
    brandName: brand.name,
    sendEmail: false,
    emailReport: false,
    skipEmail: true,
    watchBatch: false,
    securityWatch: true,
    captureConsole: requestJson.captureConsole !== false,
    reportEmail: getAlertEmail(),
  };
  if (requestJson.scanApiBase) json.scanApiBase = requestJson.scanApiBase;
  mergeWatchSmtpFromRequest(json, requestJson);
  return json;
}

async function scanOneBrand(brand, requestJson) {
  requestJson = requestJson || {};
  const json = buildScanJsonForBrand(brand, requestJson);

  // In-process scan (reliable on Vercel watch/run). External /api/scan only when UI sends publicOrigin.
  const canTryExternal =
    !!(requestJson.scanApiBase || getSelfScanApiBase(requestJson)) && requestJson.useExternalScanApi === true;
  if (canTryExternal) {
    try {
      return await scanOneBrandThroughScanApi(brand, requestJson);
    } catch (extErr) {
      // eslint-disable-next-line no-console
      console.warn(
        '[go-live-watch]',
        brand.name,
        'external scan failed — in-process fallback:',
        String((extErr && extErr.message) || extErr).slice(0, 100)
      );
    }
  }

  try {
    const { runScanInternal } = require('./go-live-audit-core');
    const result = await runScanInternal(json);
    return { brand, result };
  } catch (e) {
    const msg = String((e && e.message) || e);
    return {
      brand,
      result: {
        ok: false,
        brandName: brand.name,
        requestedUrl: brand.url,
        error: msg,
        availability: {
          state: 'unreachable',
          headline: 'Watch scan failed on server',
          detail: msg.slice(0, 240),
        },
      },
    };
  }
}

function summarizeEmailReport(email) {
  const er = email || {};
  if (er.sent) {
    return { status: 'sent', to: er.sentTo || getAlertEmail(), hint: er.deliveryHint || '' };
  }
  if (er.skipped) {
    return { status: 'skipped', reason: String(er.reason || 'skipped').slice(0, 240) };
  }
  if (er.error) {
    return { status: 'failed', error: String(er.error || 'send failed').slice(0, 240) };
  }
  return { status: 'unknown' };
}

async function runWatchPass(requestJson) {
  requestJson = requestJson || {};
  const allBrands = listEnabledBrands();
  const alertEmail = getAlertEmail();
  const offset = Math.max(0, Number(requestJson.offset) || 0);
  const limit = watchBatchLimit(requestJson);
  const brands = allBrands.slice(offset, offset + limit);
  const totalBrands = allBrands.length;
  const hasMore = offset + brands.length < totalBrands;
  const nextOffset = hasMore ? offset + brands.length : null; 

  if (!totalBrands) {
    console.log(
      '[go-live-watch] No brands in go-live-audit/data/brands-watch.json — add brands in the UI or edit the file.'
    );
    return {
      scanned: 0,
      alerts: 0,
      alertEmail,
      emailsSent: 0,
      emailsFailed: 0,
      emailsSkipped: 0,
      brands: [],
      totalBrands: 0,
      offset: 0,
      limit,
      hasMore: false,
      nextOffset: null,
      serverless: isServerlessWatch(),
    };
  }

  if (!brands.length) {
    return {
      scanned: 0,
      alerts: 0,
      alertEmail,
      emailsSent: 0,
      emailsFailed: 0,
      emailsSkipped: 0,
      brands: [],
      totalBrands,
      offset,
      limit,
      hasMore: false,
      nextOffset: null,
      serverless: isServerlessWatch(),
    };
  }

  console.log(
    '[go-live-watch] Scanning',
    brands.length,
    'of',
    totalBrands,
    'brand(s) (offset',
    offset + ')… alerts →',
    alertEmail
  );
  let alerts = 0;
  let emailsSent = 0;
  let emailsFailed = 0;
  let emailsSkipped = 0;
  const brandRows = [];
  const digestEntries = [];

  for (const brand of brands) {
    try {
      console.log('[go-live-watch]', brand.name, '→', brand.url);
      let scanOutcome = await scanOneBrand(brand, requestJson);
      let result = scanOutcome.result;
      if (result && result.ok === false && isServerlessWatch()) {
        await new Promise((r) => setTimeout(r, 5000));
        scanOutcome = await scanOneBrand(brand, requestJson);
        result = scanOutcome.result;
      }
      if (result && result.ok !== false) {
        try {
          const { saveBrandReport } = require('./go-live-audit-brand-reports.cjs');
          await saveBrandReport({
            brandName: brand.name,
            url: brand.url,
            payload: result,
          });
        } catch (storeErr) {
          console.warn('[go-live-watch] brand report store:', String(storeErr.message || storeErr).slice(0, 80));
        }
      }
      const sec = result.security || {};
      const digest = buildWatchDigestEntry(brand, result);
      digestEntries.push(digest);
      const emailSummary = {
        status: 'digest_pending',
        reason: 'Per-brand email off — combined report after all brands finish',
      };
      if (sec.shouldAlert || sec.alertLevel === 'critical') {
        alerts += 1;
        console.log('  ⚠ ALERT', sec.headline || sec.alertLevel);
      } else {
        console.log('  ✓', sec.headline || 'OK');
      }
      brandRows.push({
        name: brand.name,
        url: brand.url,
        securityAlert: !!(sec.shouldAlert || sec.alertLevel === 'critical'),
        email: emailSummary,
        digest,
        snapshot: extractBrandScanSummary(result),
        ok: result.ok !== false,
      });
    } catch (e) {
      const errMsg = String((e && e.message) || e);
      console.error('  ✗', brand.name, errMsg);
      const failResult = {
        ok: false,
        brandName: brand.name,
        requestedUrl: brand.url,
        error: errMsg,
        availability: {
          state: 'unreachable',
          headline: 'Watch scan error',
          detail: errMsg.slice(0, 240),
        },
      };
      brandRows.push({
        name: brand.name,
        url: brand.url,
        securityAlert: false,
        email: { status: 'failed', error: errMsg.slice(0, 240) },
        digest: buildWatchDigestEntry(brand, failResult),
        snapshot: extractBrandScanSummary(failResult),
        ok: false,
      });
    }
  }
  let digestEmail = null;
  const wantDigest =
    requestJson.sendWatchDigest !== false &&
    requestJson.sendEmail !== false &&
    requestJson.emailReport !== false;
  const allBrandsThisRun = offset === 0 && !hasMore && digestEntries.length >= totalBrands;

  if (wantDigest && digestEntries.length > 0 && allBrandsThisRun) {
    try {
      digestEmail = await maybeSendWatchDigestEmail(requestJson, digestEntries);
      if (digestEmail && digestEmail.sent) {
        emailsSent = 1;
        console.log('[go-live-watch] Combined digest email sent →', digestEmail.sentTo || alertEmail);
      } else if (digestEmail && digestEmail.skipped) {
        emailsSkipped = 1;
        console.log('[go-live-watch] Digest email skipped:', digestEmail.reason || '');
      } else if (digestEmail && digestEmail.error) {
        emailsFailed = 1;
        console.log('[go-live-watch] Digest email failed:', digestEmail.error || '');
      }
    } catch (digestErr) {
      emailsFailed = 1;
      digestEmail = { error: String((digestErr && digestErr.message) || digestErr).slice(0, 240) };
      console.warn('[go-live-watch] Digest email error:', digestEmail.error);
    }
  }

  console.log(
    '[go-live-watch] Batch done.',
    alerts,
    'alert(s); digest email:',
    digestEmail && digestEmail.sent ? 'sent' : hasMore ? 'pending (more brands)' : 'client will send',
    '→',
    alertEmail
  );
  return {
    scanned: brands.length,
    alerts,
    alertEmail,
    emailsSent,
    emailsSkipped,
    emailsFailed,
    brands: brandRows,
    digestEntries,
    digestEmail,
    digestPending: wantDigest && digestEntries.length > 0 && !digestEmail,
    totalBrands,
    offset,
    limit,
    hasMore,
    nextOffset,
    serverless: isServerlessWatch(),
  };
}

async function main() {
  const daemon = process.argv.includes('--daemon');
  const intervalMin = Number(process.env.GO_LIVE_WATCH_INTERVAL_MIN || 30) || 30;

  let offset = 0;
  let summary;
  do {
    summary = await runWatchPass({ offset, limit: isServerlessWatch() ? 1 : 9999 });
    offset = summary.nextOffset;
  } while (summary && summary.hasMore && summary.nextOffset != null);

  if (daemon) {
    console.log('[go-live-watch] Daemon mode — next pass in', intervalMin, 'minutes.');
    setInterval(() => {
      (async () => {
        let o = 0;
        let s;
        do {
          s = await runWatchPass({ offset: o, limit: isServerlessWatch() ? 1 : 9999 });
          o = s.nextOffset;
        } while (s && s.hasMore && s.nextOffset != null);
      })().catch((e) => console.error('[go-live-watch]', e));
    }, intervalMin * 60 * 1000);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { runWatchPass, scanOneBrand, isServerlessWatch, watchBatchLimit };
