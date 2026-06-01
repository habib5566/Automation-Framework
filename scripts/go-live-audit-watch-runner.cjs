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
const { runScanInternal } = require('./go-live-audit-core');
const { getAlertEmail } = require('./go-live-audit-defaults.cjs');
const { extractBrandScanSummary } = require('./go-live-audit-brand-matrix.cjs');

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

async function scanOneBrand(brand, requestJson) {
  const json = {
    url: brand.url,
    brandName: brand.name,
    sendEmail: true,
    emailReport: true,
    securityWatch: true,
    captureConsole: true,
    reportEmail: getAlertEmail(),
  };
  mergeWatchSmtpFromRequest(json, requestJson);
  const result = await runScanInternal(json);
  return { brand, result };
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

  for (const brand of brands) {
    try {
      console.log('[go-live-watch]', brand.name, '→', brand.url);
      const { result } = await scanOneBrand(brand, requestJson);
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
      const email = result.emailReport || {};
      const emailSummary = summarizeEmailReport(email);
      if (sec.shouldAlert || sec.alertLevel === 'critical') {
        alerts += 1;
        console.log('  ⚠ ALERT', sec.headline || sec.alertLevel);
      } else {
        console.log('  ✓', sec.headline || 'OK');
      }
      if (emailSummary.status === 'sent') {
        emailsSent += 1;
        console.log('  Email sent →', emailSummary.to);
      } else if (emailSummary.status === 'skipped') {
        emailsSkipped += 1;
        console.log('  Email NOT sent (skipped):', emailSummary.reason || '');
      } else if (emailSummary.status === 'failed') {
        emailsFailed += 1;
        console.log('  Email NOT sent (error):', emailSummary.error || '');
      }
      brandRows.push({
        name: brand.name,
        url: brand.url,
        securityAlert: !!(sec.shouldAlert || sec.alertLevel === 'critical'),
        email: emailSummary,
        snapshot: extractBrandScanSummary(result),
        ok: result.ok !== false,
      });
    } catch (e) {
      emailsFailed += 1;
      console.error('  ✗', brand.name, String(e.message || e));
      brandRows.push({
        name: brand.name,
        url: brand.url,
        securityAlert: false,
        email: { status: 'failed', error: String(e.message || e).slice(0, 240) },
        snapshot: null,
        ok: false,
      });
    }
  }
  console.log(
    '[go-live-watch] Batch done.',
    alerts,
    'alert(s); email sent:',
    emailsSent,
    'skipped:',
    emailsSkipped,
    'failed:',
    emailsFailed,
    hasMore ? '(more brands remain)' : '(all done)',
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
