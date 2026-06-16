/**
 * Shared scan logic for local Node server and Vercel serverless (`api/scan.js`).
 * @see scripts/go-live-audit-server.js — static file server + this core
 */
const http = require('http');
const https = require('https');
const { URL } = require('url');
const path = require('path');

require(path.join(__dirname, 'go-live-audit-smtp-env.cjs'));
const { ensureServerlessChromiumEnv } = require('./go-live-audit-chromium-env.cjs');
ensureServerlessChromiumEnv();

/** Corporate proxy / MITM: set GO_LIVE_AUDIT_TLS_INSECURE=1 only if you accept MITM risk for outbound scans. */
const HTTPS_AGENT =
  process.env.GO_LIVE_AUDIT_TLS_INSECURE === '1'
    ? new https.Agent({ rejectUnauthorized: false })
    : undefined;

let TLS_RELAX_AGENT;
function getInsecureHttpsAgent() {
  if (!TLS_RELAX_AGENT) TLS_RELAX_AGENT = new https.Agent({ rejectUnauthorized: false });
  return TLS_RELAX_AGENT;
}

function isTlsFetchError(err) {
  const code = err && err.code ? String(err.code) : '';
  const msg = String((err && err.message) || err || '');
  return (
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'CERT_HAS_EXPIRED' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    /certificate|ssl|tls|unable to verify/i.test(msg)
  );
}

function normalizeErrorValue(err) {
  if (err == null || err === '') return '';
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    if (typeof err.message === 'string' && err.message) return err.message;
    if (err.error != null) return normalizeErrorValue(err.error);
    if (err.code && err.message) return String(err.code) + ': ' + String(err.message);
    try {
      const s = JSON.stringify(err);
      if (s && s !== '{}') return s.slice(0, 400);
    } catch {
      /* ignore */
    }
  }
  return String(err);
}

function sendJson(res, status, obj) {
  let payload = obj;
  if (payload && typeof payload === 'object' && payload.error != null && typeof payload.error !== 'string') {
    payload = Object.assign({}, payload, { error: normalizeErrorValue(payload.error) });
  }
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(payload));
}

const { maybeSendScanEmail } = require('./go-live-audit-email-notify');
const { detectSiteStack } = require('./go-live-audit-site-stack.cjs');
const { enrichSiteStackVersions } = require('./go-live-audit-laravel-version.cjs');
const { getAlertEmail } = require('./go-live-audit-defaults.cjs');
const {
  detectHtmlRuntimeIssues,
  issuesFromAvailability,
  issuesFromPlaywrightConsole,
  issuesFromHtmlScriptHints,
  mergeIssues,
  summarizeIssues,
  summarizeMaterialIssues,
  computeConsoleDisplaySummary,
} = require('./go-live-audit-page-issues.cjs');
const {
  enrichInteractiveFromHtml,
  fetchDeepFollowUpSamples,
  issuesFromScriptSrcProbe,
} = require('./go-live-audit-deep-http-scan.cjs');
const { captureBrowserConsole } = require('./go-live-audit-playwright-console.cjs');
const { buildBrandMatrix, pickConsoleIssues, pickNonConsoleIssues } = require('./go-live-audit-brand-matrix.cjs');
const { buildVulnerabilities } = require('./go-live-audit-vulnerabilities.cjs');
const { detectSecurityThreats } = require('./go-live-audit-security-threats.cjs');
const { buildDomainSslReport } = require('./go-live-audit-domain-ssl.cjs');
const { buildAttackSurfaceReport } = require('./go-live-audit-attack-surface.cjs');
const { findBrand, loadBrandsWatch, recordScanForBrand } = require('./go-live-audit-brand-watch.cjs');

/**
 * When the client asks for email (sendEmail) or GO_LIVE_AUDIT_EMAIL_ALWAYS=1, run SMTP
 * before responding so the JSON includes emailReport. Otherwise skip (no surprise mail).
 */
function enrichScanReportPayload(payload, ctx) {
  const pageIssues = payload.pageIssues || { items: [], summary: { errors: 0, warns: 0, total: 0 } };
  payload.consoleIssues = pickConsoleIssues(pageIssues);
  const materialSum = summarizeMaterialIssues(pageIssues.items || [], payload.scanMeta);
  payload.consoleIssues.displaySummary = computeConsoleDisplaySummary(
    materialSum.filtered || payload.consoleIssues.items,
    payload.scanMeta
  );
  payload.consoleIssues.materialSummary = {
    errors: materialSum.errors,
    warns: materialSum.warns,
    total: materialSum.total,
  };
  payload.siteIssues = pickNonConsoleIssues(pageIssues);
  const siteMat = summarizeMaterialIssues(payload.siteIssues.items || [], payload.scanMeta);
  payload.siteIssues.summary = {
    errors: siteMat.errors,
    warns: siteMat.warns,
    total: siteMat.total,
  };
  const brandName = ctx.brandName || payload.brandName;
  let baseline = null;
  if (brandName) {
    const doc = loadBrandsWatch();
    const b = findBrand(doc, brandName);
    if (b && b.baselineFingerprint) baseline = b.baselineFingerprint;
  }

  payload.security = detectSecurityThreats({
    html: ctx.htmlBody || '',
    headers: ctx.headers || {},
    finalUrl: payload.finalUrl || payload.requestedUrl,
    pageIssues,
    consoleIssues: payload.consoleIssues,
    baseline,
    brandName: brandName || payload.brandName || null,
  });

  payload.brandMatrix = buildBrandMatrix({
    brandName: ctx.brandName || payload.brandName,
    reachable: ctx.reachable,
    statusCode: ctx.statusCode,
    availability: payload.availability,
    overallSummary: payload.overallSummary,
    pageIssues,
    siteIssuesSummary: payload.siteIssues.summary,
    siteStack: payload.siteStack,
    requestedUrl: payload.requestedUrl,
    finalUrl: payload.finalUrl,
    consoleDisplaySummary: payload.consoleIssues.displaySummary,
    security: payload.security,
    autoChecks: payload.autoChecks,
  });
  try {
    payload.securityWatch = recordScanForBrand(brandName, payload);
  } catch (watchErr) {
    payload.securityWatch = {
      brandName: brandName || null,
      monitored: false,
      error: String((watchErr && watchErr.message) || watchErr).slice(0, 200),
    };
  }
  if (payload.security.shouldAlert) payload.securityAlert = true;
  const { isServerlessChromiumRuntime } = require('./go-live-audit-playwright-console.cjs');
  payload.deployHints = {
    readOnlyData: process.env.VERCEL === '1',
    serverlessChrome: isServerlessChromiumRuntime(),
  };
  payload.domainSsl = ctx.domainSsl || null;
  if (payload.domainSsl && payload.domainSsl.shouldAlert) payload.securityAlert = true;
  payload.attackSurface = ctx.attackSurface || null;
  if (payload.attackSurface && payload.attackSurface.shouldAlert) payload.securityAlert = true;

  payload.vulnerabilities = buildVulnerabilities({
    security: payload.security,
    siteStack: payload.siteStack,
    pageIssues,
    siteIssues: payload.siteIssues,
    consoleIssues: payload.consoleIssues,
    scanMeta: payload.scanMeta,
    domainSsl: payload.domainSsl,
    attackSurface: payload.attackSurface,
  });
}

function scanWantsEmail(requestJson, scanPayload) {
  if (requestJson && requestJson.skipEmail === true) return false;
  const { scanNeedsDangerEmail } = require('./go-live-audit-email-notify');
  return (
    process.env.GO_LIVE_AUDIT_EMAIL_ALWAYS === '1' ||
    scanNeedsDangerEmail(scanPayload) ||
    requestJson.sendEmail === true ||
    requestJson.emailReport === true ||
    requestJson.email === true
  );
}

async function flushScanEmailIfNeeded(requestJson, scanPayload) {
  if (!scanWantsEmail(requestJson, scanPayload)) return;
  const onVercel = process.env.VERCEL === '1';
  const emailTimeoutMs = Number(
    process.env.GO_LIVE_AUDIT_EMAIL_TIMEOUT_MS || (onVercel ? 8_000 : 14_000)
  );
  let emailReport;
  try {
    emailReport = await Promise.race([
      maybeSendScanEmail(requestJson, scanPayload),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Email send timed out after ' + emailTimeoutMs + 'ms')), emailTimeoutMs)
      ),
    ]);
  } catch (e) {
    emailReport = { error: String((e && e.message) || e) };
  }
  scanPayload.emailReport = emailReport || {
    skipped: true,
    reason: 'Email step returned no status — set GO_LIVE_AUDIT_SMTP_USER + GO_LIVE_AUDIT_SMTP_PASS on Vercel (see VERCEL-EMAIL-SETUP.md) or paste Sender Gmail + App Password in the form.',
  };
  if (emailReport && emailReport.sent) {
    scanPayload.emailSent = true;
  }
}

function ensureEmailReportOnPayload(requestJson, scanPayload) {
  if (!scanWantsEmail(requestJson, scanPayload)) return;
  if (scanPayload.emailReport) return;
  const { envSmtpConfigured } = require('./go-live-audit-email-notify');
  scanPayload.emailReport = {
    skipped: true,
    reason: envSmtpConfigured()
      ? 'Email did not run (server timeout or old deploy). Redeploy latest code and scan again.'
      : '[GMAIL_SMTP_REQUIRED] Add GO_LIVE_AUDIT_SMTP_USER + GO_LIVE_AUDIT_SMTP_PASS in Vercel → Environment Variables → Redeploy. Or paste Sender Gmail + App Password in the scan form (App Password must be for that sender account, not the alert inbox).',
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 2e6) {
        req.destroy();
        reject(new Error('body too large'));
      }
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

function isBlockedHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.local')) return true;
  if (h === '0.0.0.0') return true;
  if (h.startsWith('127.')) return true;
  if (h === '::1') return true;
  if (h.startsWith('10.')) return true;
  if (h.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h.endsWith('.internal')) return true;
  return false;
}

function isServerlessFetchRuntime() {
  return !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

function defaultFetchOpts() {
  const onSrv = isServerlessFetchRuntime();
  const ua =
    String(process.env.GO_LIVE_AUDIT_FETCH_UA || '').trim() ||
    (onSrv
      ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 GoLiveAudit/1.0'
      : 'Mozilla/5.0 (compatible; GoLiveAudit/1.0; +https://github.com/)');
  return {
    timeoutMs: onSrv ? 28_000 : 20_000,
    userAgent: ua,
  };
}

function fetchUrlOnce(targetUrl, maxRedirects = 5, fetchOpts = {}) {
  const defs = defaultFetchOpts();
  const timeoutMs =
    typeof fetchOpts === 'object' &&
    fetchOpts != null &&
    fetchOpts.timeoutMs != null &&
    Number.isFinite(Number(fetchOpts.timeoutMs))
      ? Math.min(60_000, Math.max(3000, Number(fetchOpts.timeoutMs)))
      : defs.timeoutMs;
  const userAgent =
    (fetchOpts && fetchOpts.userAgent) || defs.userAgent;
  const forceInsecure = !!(fetchOpts && fetchOpts.forceInsecure);
  return new Promise((resolve, reject) => {
    const tryOnce = (urlStr, redirectsLeft) => {
      let u;
      try {
        u = new URL(urlStr);
      } catch (e) {
        reject(new Error('Invalid URL'));
        return;
      }
      if (!/^https?:$/i.test(u.protocol)) {
        reject(new Error('Only http and https URLs are allowed'));
        return;
      }
      if (isBlockedHost(u.hostname)) {
        reject(new Error('That host is not allowed for scan (private/local).'));
        return;
      }

      const lib = u.protocol === 'https:' ? https : http;
      const opts = {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'GET',
        headers: {
          'User-Agent': userAgent,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: timeoutMs,
      };
      if (u.protocol === 'https:') {
        if (HTTPS_AGENT) opts.agent = HTTPS_AGENT;
        else if (forceInsecure) opts.agent = getInsecureHttpsAgent();
      }

      const req = lib.request(opts, (res) => {
        const loc = res.headers.location;
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && loc && redirectsLeft > 0) {
          const next = new URL(loc, u).href;
          res.resume();
          tryOnce(next, redirectsLeft - 1);
          return;
        }

        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const maxBytes = 1_500_000;
          const body = buf.slice(0, maxBytes).toString('utf8');
          const ct = String(res.headers['content-type'] || '').split(';')[0].trim();
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            finalUrl: u.href,
            body,
            contentType: ct,
            tlsRelaxed: forceInsecure,
          });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.on('error', reject);
      req.end();
    };

    tryOnce(targetUrl, maxRedirects);
  });
}

/**
 * Fetch with one automatic TLS-relaxed retry (local PC + corporate SSL inspection).
 * Vercel/AWS usually does not need this — fixes “site down on localhost, up on live”.
 */
function fetchUrl(targetUrl, maxRedirects = 5, fetchOpts = {}) {
  const opts = typeof fetchOpts === 'object' && fetchOpts != null ? fetchOpts : {};
  return fetchUrlOnce(targetUrl, maxRedirects, opts).catch((err) => {
    if (opts.forceInsecure || opts.allowInsecureRetry === false || HTTPS_AGENT) throw err;
    if (!isTlsFetchError(err)) throw err;
    return fetchUrlOnce(targetUrl, maxRedirects, {
      ...opts,
      forceInsecure: true,
      allowInsecureRetry: false,
    });
  });
}

/**
 * When fetchUrl throws — classify for UI (DNS down vs refused vs timeout vs TLS).
 */
function classifyAvailabilityError(err) {
  const code = err && err.code ? String(err.code) : '';
  const msg = String((err && err.message) || err || '');
  const lower = msg.toLowerCase();

  if (
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    lower.includes('getaddrinfo') ||
    lower.includes('enotfound')
  ) {
    return {
      state: 'dns_failed',
      headline: 'Hostname does not resolve (DNS)',
      detail:
        'The domain name could not be resolved. The site may be misconfigured, expired, or offline.',
      code,
    };
  }
  if (code === 'ECONNREFUSED') {
    return {
      state: 'connection_refused',
      headline: 'Connection refused — server likely down or port closed',
      detail:
        'Nothing accepted the connection. The web server may be stopped, or a firewall is blocking access.',
      code,
    };
  }
  if (
    code === 'ETIMEDOUT' ||
    code === 'ESOCKETTIMEDOUT' ||
    lower.includes('timeout') ||
    msg === 'Request timeout'
  ) {
    return {
      state: 'timeout',
      headline: 'Timed out — site may be down or overloaded',
      detail:
        'No response before the deadline. The origin may be offline, saturated, or blocking this scanner.',
      code,
    };
  }
  if (code === 'ECONNRESET' || code === 'EPIPE') {
    return {
      state: 'connection_reset',
      headline: 'Connection reset by remote host',
      detail: 'The other side closed the connection — unstable network or protective edge device.',
      code,
    };
  }
  if (/certificate|ssl|tls|unable to verify|cert/i.test(msg)) {
    return {
      state: 'tls_error',
      headline: 'TLS / certificate verification failed',
      detail:
        msg +
        ' On trusted networks you may try GO_LIVE_AUDIT_TLS_INSECURE=1 (understand MITM risk first).',
      code,
    };
  }

  return {
    state: 'unreachable',
    headline: 'Cannot reach this URL',
    detail: msg || 'Unknown network error.',
    code,
  };
}

/** After a response is received — interpret HTTP status for “up vs server error”. */
function summarizeHttpAvailability(statusCode, finalUrl) {
  const sc = Number(statusCode) || 0;
  const urlShort = finalUrl || '';

  if (sc >= 200 && sc < 300) {
    return {
      state: 'up',
      headline: 'Site is up — response received',
      detail: `HTTP ${sc} from ${urlShort}`,
    };
  }
  if (sc === 521) {
    return {
      state: 'server_error',
      headline: 'HTTP 521 — origin server down (Cloudflare)',
      detail:
        'Cloudflare could not reach your web server. Fix hosting (server stopped, wrong DNS, or firewall) — this is the site you scanned, not the audit tool.',
    };
  }
  if (sc >= 500) {
    return {
      state: 'server_error',
      headline: 'Remote server error (site may be down or broken)',
      detail: `HTTP ${sc} — the origin returned a server error. Users may see errors or downtime.`,
    };
  }
  if (sc === 404) {
    return {
      state: 'page_not_found',
      headline: 'Host responded — this page was not found',
      detail: `HTTP 404 — server is reachable but this path does not exist.`,
    };
  }
  if (sc >= 400) {
    return {
      state: 'client_error',
      headline: 'HTTP error (request rejected)',
      detail: `HTTP ${sc} — the server rejected this request (check URL, auth, or redirects).`,
    };
  }
  if (sc >= 300 && sc < 400) {
    return {
      state: 'redirect_only',
      headline: 'Unusual final HTTP status after redirects',
      detail: `HTTP ${sc} — verify redirect configuration.`,
    };
  }
  return {
    state: 'unknown_http',
    headline: 'Unexpected HTTP status',
    detail: `HTTP ${sc}`,
  };
}

/**
 * When the response is not a normal 2xx HTML page, skip {@link buildAutoChecks} so we do not
 * mark e.g. C01 Pass on an nginx 502 body or an empty connection page.
 */
function shouldSkipContentAutoChecks(statusCode, html) {
  const sc = Number(statusCode) || 0;
  if (sc < 200 || sc >= 400) {
    const extra =
      sc === 521
        ? ' Cloudflare 521 = your origin server is offline or unreachable — start/fix the site, then scan again.'
        : '';
    return {
      skip: true,
      reason:
        'HTTP ' +
        sc +
        ': not a successful 2xx page — automated checklist rows are skipped (error or access pages must not be scored like real content).' +
        extra,
    };
  }
  if (html && html.isHtmlDocument === false) {
    return {
      skip: true,
      reason:
        'This response does not look like HTML — automated checklist rows are skipped. Confirm the public URL returns a real HTML document.',
    };
  }
  return { skip: false, reason: '' };
}

/**
 * Plain-language rollup for the UI: is this URL broadly OK or problematic from one-page scan + checklist counts.
 */
function buildOverallSummary({
  reachable,
  availability,
  statusCode,
  autoChecks,
  scanWarnings,
  html,
}) {
  const counts = { pass: 0, fail: 0, pending: 0, notScored: 0 };
  for (const ac of autoChecks || []) {
    if (!ac || !ac.status) continue;
    if (ac.status === 'pass') counts.pass += 1;
    else if (ac.status === 'fail') counts.fail += 1;
    else if (ac.status === 'na') counts.notScored += 1;
    else counts.pending += 1;
  }

  const sc = Number(statusCode) || 0;
  const avState = availability && availability.state ? String(availability.state) : '';

  const failedItems = (autoChecks || [])
    .filter((ac) => ac && ac.status === 'fail')
    .map((ac) => ({
      id: ac.id,
      note: String(ac.note || '').replace(/\s+/g, ' ').trim().slice(0, 160),
    }));

  const contentFlags =
    html &&
    (html.loremIpsumDetected ||
      html.comingSoonDetected ||
      html.placeholderPhrasesDetected);

  if (!reachable) {
    return {
      level: 'bad',
      headline: 'Overall: scan could not finish',
      subline:
        'The site did not load like a normal visit — check DNS, TLS, firewall, or whether hosting is down.',
      counts,
    };
  }

  if (sc >= 500 || avState === 'server_error') {
    return {
      level: 'bad',
      headline: 'Overall: serious availability risk',
      subline: `HTTP ${sc || '5xx'} from the server — users may see errors until this is fixed.`,
      counts,
    };
  }

  if (sc === 404 || (sc >= 400 && sc < 500)) {
    return {
      level: 'concern',
      headline: 'Overall: URL or access problem',
      subline:
        sc === 404
          ? 'This exact path returned 404 — wrong link or page missing.'
          : `HTTP ${sc} — request was rejected (auth, blocking, or bad URL).`,
      counts,
      failedItems,
    };
  }

  if (counts.fail >= 7) {
    const ids = failedItems.map((f) => f.id).join(', ');
    return {
      level: 'concern',
      headline: 'Overall: multiple automated failures',
      subline: `${counts.fail} rows failed (${ids}) — fix on the live site, or scroll the checklist and filter by Fail.`,
      counts,
      failedItems,
    };
  }

  if (counts.fail >= 3 && counts.fail < 7) {
    const ids = failedItems.map((f) => f.id).join(', ');
    return {
      level: 'caution',
      headline: 'Overall: a few items to review',
      subline: `${counts.fail} automated flag(s) (${ids}) — many sites pass with minor warnings; verify each row.`,
      counts,
      failedItems,
    };
  }

  if (counts.fail === 1) {
    const one = failedItems[0];
    return {
      level: 'caution',
      headline: 'Overall: one automated failure',
      subline: one
        ? `Row ${one.id} failed — see checklist below (search for ${one.id}).`
        : 'Fix or verify the failing row — do not treat the site as fully cleared yet.',
      counts,
      failedItems,
    };
  }

  if (scanWarnings && scanWarnings.length > 0) {
    return {
      level: 'caution',
      headline: 'Overall: mostly OK — scan warnings',
      subline: 'No failing rows, but warnings below need a quick read before release.',
      counts,
    };
  }

  if (contentFlags) {
    return {
      level: 'caution',
      headline: 'Overall: quality flags on this page',
      subline:
        'Placeholder / “coming soon” / lorem-style text detected — clean up before customer-facing go-live.',
      counts,
    };
  }

  if (avState === 'redirect_only' || avState === 'unknown_http') {
    return {
      level: 'caution',
      headline: 'Overall: double-check HTTP behaviour',
      subline: availability && availability.detail ? availability.detail : 'Confirm redirects and final status.',
      counts,
    };
  }

  const pendingHint =
    counts.pending > 0
      ? ` About ${counts.pending} row(s) need manual review — normal for this shallow scan.`
      : '';
  const naHint =
    counts.notScored > 0
      ? ` ${counts.notScored} row(s) marked “not auto-tested” — the scan cannot pass/fail them here.`
      : '';

  return {
    level: 'good',
    headline: 'Overall: quick scan looks healthy',
    subline:
      `Page responded (${sc}), no automated checklist failures.${pendingHint}${naHint}`.trim(),
    counts,
  };
}

function analyzeHtml(body, finalUrl, contentTypeHeader) {
  const lower = body.toLowerCase();
  const telCount = (body.match(/\bhref\s*=\s*["']tel:/gi) || []).length;
  const mailtoCount = (body.match(/\bhref\s*=\s*["']mailto:/gi) || []).length;
  const formCount = (body.match(/<form\b/gi) || []).length;
  const hasViewport = /<meta[^>]+name\s*=\s*["']viewport["']/i.test(body);
  const hasCharset =
    /<meta[^>]+charset\s*=/i.test(body) || /charset\s*=\s*["'][^"']+["']/i.test(body);
  const titleMatch = body.match(/<title[^>]*>([^<]*)<\/title>/i);
  const ogTitleMatch = body.match(
    /<meta[^>]+property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']*)["']/i
  );
  const title = (titleMatch ? titleMatch[1].trim() : '') || (ogTitleMatch ? ogTitleMatch[1].trim() : '');
  const metaDesc =
    (body.match(/<meta[^>]+name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["']/i) || [])[1] ||
    (body.match(/<meta[^>]+property\s*=\s*["']og:description["'][^>]*content\s*=\s*["']([^"']*)["']/i) || [])[1] ||
    '';
  const favicon =
    /<link[^>]+rel\s*=\s*["'](?:shortcut\s+)?icon["']/i.test(body) ||
    /<link[^>]+href\s*=\s*["'][^"']*favicon/i.test(body);
  const robotsMeta =
    /<meta[^>]+name\s*=\s*["']robots["'][^>]*content\s*=\s*["'][^"']*(noindex|nofollow)/i.test(body) ||
    /<meta[^>]+content\s*=\s*["'][^"']*(noindex|nofollow)[^"']*["'][^>]+name\s*=\s*["']robots["']/i.test(body);
  const zendesk =
    /zendesk/i.test(body) && (/zdassets|ekr\.zendesk|static\.zdassets/i.test(body) || /zendesk.*widget/i.test(lower));
  const lorem = /\blorem\s+ipsum\b/i.test(body);
  const comingSoon = /\bcoming\s+soon\b/i.test(lower);
  const placeholderText =
    /\bplaceholder\s+text\b/i.test(lower) ||
    /\btodo:\b/i.test(lower) ||
    /\bdummy\s+content\b/i.test(lower);
  const imgTags = body.match(/<img\b[^>]*>/gi) || [];
  let emptyAlt = 0;
  for (const t of imgTags) {
    if (!/\salt\s*=/i.test(t)) emptyAlt += 1;
  }
  const hasHttps = /^https:/i.test(finalUrl);
  const isHtmlish =
    /html|text\/plain/i.test(String(contentTypeHeader || '')) || /<html[\s>]/i.test(body.slice(0, 2000));

  const mailtoEmails = new Set();
  const mailtoRe = /\bhref\s*=\s*["']mailto:([^"'>\s]+)/gi;
  let mm;
  while ((mm = mailtoRe.exec(body)) !== null) {
    try {
      mailtoEmails.add(decodeURIComponent(mm[1].split('?')[0]).toLowerCase());
    } catch {
      mailtoEmails.add(mm[1].split('?')[0].toLowerCase());
    }
  }
  const mailtoUniqueCount = mailtoEmails.size;

  const formHasRequiredAttr = /<(?:input|textarea|select)[^>]+\brequired\b/i.test(body);

  let internalLinkCount = 0;
  try {
    const originHost = new URL(finalUrl).hostname;
    const hrefRe = /\bhref\s*=\s*["']([^"']+)["']/gi;
    let hm;
    while ((hm = hrefRe.exec(body)) !== null) {
      const href = hm[1].trim();
      if (!href || href.startsWith('#') || /^javascript:/i.test(href)) continue;
      try {
        const u = new URL(href, finalUrl);
        if (u.hostname === originHost) internalLinkCount++;
      } catch {
        if (/^\//.test(href) || /^\.\.?\//.test(href)) internalLinkCount++;
      }
    }
  } catch {
    internalLinkCount = 0;
  }

  const logoLikely =
    /<header[^>]*>[\s\S]{0,15000}<img[^>]+>/i.test(body) ||
    /role\s*=\s*["']banner["'][\s\S]{0,15000}<img[^>]+>/i.test(body);

  const modernImageExt = /\.(webp|avif)(\?|#|"|'|$)/i.test(body);

  const legalLinkHints = /href\s*=\s*["'][^"']*(privacy|terms|legal|cookie-policy|cookies)[^"']*["']/i.test(
    body
  );

  const ssrHints =
    /__NEXT_DATA__|data-server-rendered|ng-version|data-reactroot|hydrateRoot/i.test(body);

  const hasMainLandmark = /<main\b/i.test(body) || /role\s*=\s*["']main["']/i.test(body);
  const hasHeaderOrNav = /<header\b/i.test(body) || /<nav\b/i.test(body);
  const layoutSemanticsOk = !!(hasViewport && hasMainLandmark && hasHeaderOrNav);

  const buttonCount = (body.match(/<button\b/gi) || []).length;
  const anchorHrefCount = (body.match(/<a\s[^>]*href\s*=/gi) || []).length;
  const interactiveApprox = buttonCount + anchorHrefCount;

  return {
    isHtmlDocument: isHtmlish,
    hasHttps,
    telCount,
    mailtoCount,
    mailtoUniqueCount,
    formCount,
    formHasRequiredAttr,
    internalLinkCount,
    logoLikely,
    modernImageExt,
    legalLinkHints,
    ssrHints,
    interactiveApprox,
    hasViewport,
    hasCharset,
    titleLength: title.length,
    hasTitle: title.length > 0,
    metaDescriptionLength: metaDesc.trim().length,
    hasMetaDescription: metaDesc.trim().length > 0,
    hasFaviconLink: favicon,
    robotsMetaNoindex: robotsMeta,
    zendeskSnippetDetected: zendesk,
    loremIpsumDetected: lorem,
    comingSoonDetected: comingSoon,
    placeholderPhrasesDetected: placeholderText,
    imageTags: imgTags.length,
    imagesMissingOrEmptyAlt: emptyAlt,
    layoutSemanticsOk,
  };
}

/** Must stay in sync with go-live-audit/public/index.html ITEMS[].id order. */
const CHECKLIST_IDS = [
  'C01',
  'F01',
  'F02',
  'F03',
  'F04',
  'E01',
  'E02',
  'E03',
  'S01',
  'S02',
  'SEO1',
  'R01',
  'U01',
  'U02',
  'U03',
  'U04',
  'Z01',
  'Z02',
  'C02',
  'C03',
  'M01',
  'M02',
  'P01',
  'P02',
  'P03',
  'B01',
  'L01',
  'L02',
  'L03',
  'L04',
  'L05',
  'I01',
  'I02',
  'I03',
  'I04',
];

function securityHeaderScore(headersLower) {
  let n = 0;
  if (headersLower['strict-transport-security']) n++;
  if (headersLower['x-content-type-options']) n++;
  if (headersLower['x-frame-options']) n++;
  if (headersLower['content-security-policy']) n++;
  if (headersLower['referrer-policy']) n++;
  return n;
}

function headersToLower(headers) {
  const hLow = {};
  for (const k of Object.keys(headers || {})) hLow[String(k).toLowerCase()] = headers[k];
  return hLow;
}

function normalizeUrlForCompare(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    let p = x.pathname;
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    x.pathname = p || '/';
    return x.href;
  } catch {
    return u;
  }
}

/**
 * If cwd has Playwright config referencing 2+ browser engines, B01 can auto-pass
 * (automation exists in this repo — not proof the scanned URL was tested in each).
 */
function detectPlaywrightMultiBrowserFromCwd() {
  const fs = require('fs');
  const path = require('path');
  const names = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs'];
  for (const filename of names) {
    const fp = path.join(process.cwd(), filename);
    if (!fs.existsSync(fp)) continue;
    let text;
    try {
      text = fs.readFileSync(fp, 'utf8');
    } catch {
      continue;
    }
    const low = text.toLowerCase();
    const tokens = ['chromium', 'firefox', 'webkit', 'msedge'];
    const hit = new Set();
    for (const t of tokens) {
      if (low.includes(t)) hit.add(t);
    }
    const projectBlocks = (text.match(/\{\s*\r?\n\s*name\s*:\s*['"]/g) || []).length;
    if (hit.size >= 2 || projectBlocks >= 2) {
      const detail =
        hit.size >= 2 ? `engines: ${[...hit].join(', ')}` : `${projectBlocks} Playwright project(s)`;
      return `[auto] ${filename} (${detail}) — automated browser tests are configured in this repo. Still run them against your go-live URL.`;
    }
  }
  return null;
}

function buildAutoChecks(requestedUrl, finalUrl, statusCode, headers, html, robotsInfo, bodySlice) {
  const hLow = headersToLower(headers);
  const secScore = securityHeaderScore(hLow);
  const xRobots = String(hLow['x-robots-tag'] || '').toLowerCase();
  const xRobotsNoindex = xRobots.includes('noindex');
  const headerNofollow = xRobots.includes('nofollow');
  const indexSignal = xRobotsNoindex || headerNofollow || html.robotsMetaNoindex;

  const trackHit = /googletagmanager|gtag\(|google-analytics|facebook\.net\/tr|clarity\.ms/i.test(
    bodySlice || ''
  );

  const scanWarnings = [];
  if (!html.isHtmlDocument && statusCode === 200) {
    scanWarnings.push({
      message: `Response may not be HTML (Content-Type: ${html._contentType || 'unknown'}). Might be an SPA or empty shell — automated signals are limited.`,
    });
  }

  const dummy =
    html.loremIpsumDetected || html.comingSoonDetected || html.placeholderPhrasesDetected;

  const pwBrowserNote = detectPlaywrightMultiBrowserFromCwd();

  const mParts = [];
  if (html.hasTitle) mParts.push('title OK');
  else mParts.push('title missing/empty');
  if (html.hasMetaDescription) mParts.push('meta description OK');
  else mParts.push('meta description missing');
  if (html.hasFaviconLink) mParts.push('favicon link OK');
  else mParts.push('favicon link not detected');
  let m01status = 'pending';
  if (!html.hasTitle) m01status = 'fail';
  else if (html.hasTitle && html.hasMetaDescription && html.hasFaviconLink) m01status = 'pass';

  const redirected = normalizeUrlForCompare(requestedUrl) !== normalizeUrlForCompare(finalUrl);

  /** @type {Map<string, { id: string, status: string, note: string }>} */
  const byId = new Map();

  byId.set('I01', {
    id: 'I01',
    status: html.hasHttps ? 'pass' : 'fail',
    note: html.hasHttps
      ? '[auto] Final URL uses HTTPS.'
      : '[auto] Final URL is not HTTPS — fix SSL / enforce HTTPS.',
  });

  byId.set('SEO1', {
    id: 'SEO1',
    status: indexSignal ? 'pass' : 'pending',
    note: indexSignal
      ? '[auto] noindex/nofollow signal found (meta robots and/or X-Robots-Tag). Confirm with your release policy / approver.'
      : '[auto] No clear noindex/nofollow on this page — confirm staging vs production policy.',
  });

  byId.set('M01', { id: 'M01', status: m01status, note: `[auto] ${mParts.join('; ')}.` });

  byId.set('E03', {
    id: 'E03',
    status: html.telCount > 0 ? 'pass' : 'pending',
    note:
      html.telCount > 0
        ? `[auto] Found ${html.telCount} tel: link(s).`
        : '[auto] No tel: links in this HTML — check contact/footer or other pages.',
  });

  const mailtoU = html.mailtoUniqueCount != null ? html.mailtoUniqueCount : 0;
  let e01status = 'pending';
  let e01note = `[auto] ~${mailtoU} unique mailto: target(s) — confirm one approved email is used sitewide.`;
  if (mailtoU === 1) {
    e01status = 'pass';
    e01note = '[auto] Single mailto: pattern on this page — likely consistent (verify other pages).';
  } else if (mailtoU === 0) {
    e01note = '[auto] No mailto: link in this HTML — check email CTAs on other pages.';
  }

  byId.set('E01', { id: 'E01', status: e01status, note: e01note });

  let e02status = 'pending';
  let e02note = `[auto] ${html.telCount} tel: link(s) — confirm one approved phone number is used sitewide.`;
  if (html.telCount === 1) {
    e02status = 'pass';
    e02note = '[auto] One tel: link on this page — likely consistent (verify other pages).';
  } else if (html.telCount === 0) {
    e02note = '[auto] No tel: link in this HTML — check phone in content/footer on other pages.';
  }

  byId.set('E02', { id: 'E02', status: e02status, note: e02note });

  byId.set('C01', {
    id: 'C01',
    status: dummy ? 'fail' : 'pass',
    note: dummy
      ? '[auto] Flagged lorem / “coming soon” / placeholder-style text (this page only).'
      : '[auto] No common dummy phrases on this page (full-site crawl not performed).',
  });

  let u03status = 'pending';
  let u03note =
    '[auto] No <img> tags in this HTML snapshot — confirm images render as expected (other routes / lazy load).';
  if (html.imageTags > 0) {
    const imgN = html.imageTags || 0;
    const miss = html.imagesMissingOrEmptyAlt || 0;
    const missRatio = imgN > 0 ? miss / imgN : 0;
    if (imgN === 0) {
      u03status = 'pending';
      u03note = '[auto] No images in this HTML slice — check other pages manually.';
    } else if (missRatio <= 0.35) {
      u03status = 'pass';
      u03note = `[auto] ${imgN} image(s); ${miss} missing alt attribute (empty alt="" is OK for decorative).`;
    } else if (missRatio <= 0.6) {
      u03status = 'pending';
      u03note = `[auto] ~${miss}/${imgN} images lack alt — review important images; decorative may use alt="".`;
    } else {
      u03status = 'fail';
      u03note = `[auto] ~${miss}/${imgN} images missing alt attribute — add alt text for content images.`;
    }
  }

  byId.set('U03', { id: 'U03', status: u03status, note: u03note });

  byId.set('Z01', {
    id: 'Z01',
    status: 'pending',
    note: html.zendeskSnippetDetected
      ? '[auto] Zendesk-like snippet detected — exercise the widget manually.'
      : '[auto] No Zendesk snippet in this HTML (may load lazily). Still verify chat on live site.',
  });

  byId.set('Z02', {
    id: 'Z02',
    status: 'pending',
    note: html.zendeskSnippetDetected
      ? '[auto] Popup/widget behaviour requires manual QA.'
      : '[auto] Popup/widget not confirmed from this scrape — verify on production.',
  });

  if (html.formCount > 0) {
    const formWhere =
      (html._followUpPagesSampled || 0) > 0
        ? `across the start URL plus ${html._followUpPagesSampled} linked same-origin page sample(s) (not exhaustive)`
        : 'on this URL';
    byId.set('F01', {
      id: 'F01',
      status: 'pending',
      note:
        `[auto] Found ${html.formCount} <form> element(s) ${formWhere} — the scanner does not submit forms.\n` +
        'Next: on staging or production, submit each form with realistic data; confirm thank-you/error behaviour; add Pass/Fail + evidence below.',
    });
    byId.set('F02', {
      id: 'F02',
      status: html.formHasRequiredAttr ? 'pass' : 'pending',
      note: html.formHasRequiredAttr
        ? '[auto] Some HTML5 “required” attributes present — review remaining validation rules manually.\nNext: try empty submit, wrong formats, max length — match behaviour to spec.'
        : '[auto] No obvious HTML5 required attributes — validation rules need manual review.\nNext: test required fields, formats, and error messages against requirements.',
    });
    byId.set('F03', {
      id: 'F03',
      status: 'na',
      note:
        '[auto] Sanitization / abuse resistance — not fuzz-tested by this scan (out of automated scope).\n' +
        'Next: in staging only, try invalid or unexpected input; confirm server rejects or escapes per policy — then set Pass/Fail with evidence.',
    });
    byId.set('F04', {
      id: 'F04',
      status: 'na',
      note:
        '[auto] Delivery to inbox/CRM/API — not verified by this scan (out of automated scope).\n' +
        'Next: send test submissions; confirm recipient, fields, and automation — then set Pass/Fail with proof.',
    });
  } else {
    const nf =
      '[auto] No <form> on this URL — forms may exist on other routes only.';
    byId.set('F01', { id: 'F01', status: 'pending', note: nf });
    byId.set('F02', { id: 'F02', status: 'pending', note: nf });
    byId.set('F03', { id: 'F03', status: 'pending', note: nf });
    byId.set('F04', { id: 'F04', status: 'pending', note: nf });
  }

  byId.set('L05', {
    id: 'L05',
    status: 'pass',
    note: redirected
      ? `[auto] Redirect chain OK: ${requestedUrl} → ${finalUrl}`
      : '[auto] Request URL matches final URL (no extra redirect seen in this chain).',
  });

  if (robotsInfo.fetched && robotsInfo.status === 200) {
    byId.set('I02', {
      id: 'I02',
      status: robotsInfo.hasSitemapLine ? 'pass' : 'pending',
      note: robotsInfo.hasSitemapLine
        ? '[auto] robots.txt present with a Sitemap: line.'
        : '[auto] robots.txt returned 200 but Sitemap: line missing or unclear — verify.',
    });
  } else {
    byId.set('I02', {
      id: 'I02',
      status: 'pending',
      note: `[auto] robots.txt: ${robotsInfo.error || 'not fetched or non-OK HTTP status'}`,
    });
  }

  byId.set('I03', {
    id: 'I03',
    status: trackHit ? 'pass' : 'pending',
    note: trackHit
      ? '[auto] Common tracking strings (GTM/GA/Clarity-like) found — verify tags fire correctly in the browser.'
      : '[auto] No common tracking strings in this HTML slice — tags may load from another bundle; verify manually.',
  });

  let s01status = 'pending';
  let s01note = `[auto] ~${secScore}/5 common security headers seen (HSTS, XCTO, XFO, CSP, Referrer-Policy).`;
  if (secScore >= 3) {
    s01status = 'pass';
    s01note = `[auto] Strong security header coverage (${secScore}) — full penetration test still recommended separately.`;
  } else if (secScore === 0 && html.hasHttps) {
    s01status = 'pending';
    s01note =
      '[auto] HTTPS OK; optional security headers not all present — common on CDNs; review if policy requires strict headers.';
  }

  byId.set('S01', { id: 'S01', status: s01status, note: s01note });

  byId.set('S02', {
    id: 'S02',
    status: 'pending',
    note: html.ssrHints
      ? '[auto] SSR / framework markers detected — confirm rendering approach matches requirements.'
      : '[auto] No obvious SSR markers — confirm SPA vs SSR architecture with your team.',
  });

  let r01status = 'pending';
  let r01note =
    '[auto] viewport meta not in HTML — may be injected by JS; confirm mobile layout in browser.';
  if (html.hasViewport) {
    r01status = 'pass';
    r01note = '[auto] viewport meta tag present — still test on real devices.';
  } else if (statusCode >= 200 && statusCode < 400 && html.hasTitle) {
    r01status = 'pending';
    r01note =
      '[auto] No viewport in static HTML but page title exists — common on SPAs; verify mobile in browser.';
  }
  byId.set('R01', { id: 'R01', status: r01status, note: r01note });

  const u01FewInteractive = html.interactiveApprox <= 0;
  byId.set('U01', {
    id: 'U01',
    status: u01FewInteractive ? 'pending' : 'pending',
    note: u01FewInteractive
      ? '[auto] Few/no links or buttons in raw HTML — common on JS-heavy sites (React/Vue). Page may still be fine; verify in a real browser.'
      : `[auto] ~${html.interactiveApprox} buttons/links — exercise clicks and routing manually or with Playwright.`,
  });

  byId.set('U02', {
    id: 'U02',
    status: 'pending',
    note:
      html.internalLinkCount > 0
        ? `[auto] ~${html.internalLinkCount} internal href hints — broken-link crawl not run.`
        : '[auto] Few or no internal links in this HTML — review navigation, mega-menus, or JS routing.',
  });

  byId.set('U04', {
    id: 'U04',
    status: 'pending',
    note: '[auto] Typography — design QA only; scan cannot measure type scale sitewide.',
  });

  byId.set('C02', {
    id: 'C02',
    status: 'pending',
    note: '[auto] CTA behaviour — exercise paths manually or with Playwright.',
  });

  const c03HasContact = mailtoU > 0 || html.telCount > 0;
  byId.set('C03', {
    id: 'C03',
    status: 'pending',
    note: c03HasContact
      ? '[auto] mailto/tel present — verify contact details match everywhere on the site.'
      : '[auto] No mailto/tel in this HTML — review contact sections on other pages.',
  });

  byId.set('M02', {
    id: 'M02',
    status: html.logoLikely ? 'pass' : 'pending',
    note: html.logoLikely
      ? '[auto] Image near header/banner region — confirm branding and link targets manually.'
      : '[auto] Logo/header image pattern not clear from this HTML — verify manually.',
  });

  byId.set('P01', {
    id: 'P01',
    status: 'pending',
    note: '[auto] Run Lighthouse/WebPageTest separately — not part of this quick scan.',
  });

  byId.set('P02', {
    id: 'P02',
    status: html.modernImageExt ? 'pass' : 'pending',
    note: html.modernImageExt
      ? '[auto] webp/avif references found — review remaining assets separately.'
      : '[auto] No obvious webp/avif references — verify compression pipeline.',
  });

  byId.set('P03', {
    id: 'P03',
    status: 'pending',
    note: '[auto] Broken images / CLS — requires runtime QA or Playwright.',
  });

  byId.set('B01', {
    id: 'B01',
    status: pwBrowserNote ? 'pass' : 'pending',
    note:
      pwBrowserNote ||
      '[auto] Cross-browser matrix — Playwright projects or manual browsers (no multi-browser Playwright config found in server cwd).',
  });

  const layoutNa =
    '[auto] Layout / spacing — visual QA only (single-page snapshot); viewport + main + header/nav not all detected.';
  const l01Pass = !!html.layoutSemanticsOk;
  byId.set('L01', {
    id: 'L01',
    status: l01Pass ? 'pass' : 'pending',
    note: l01Pass
      ? '[auto] Viewport meta + <main> (or role=main) + <header> or <nav> found — basic responsive structure; still verify alignment/spacing visually sitewide.'
      : layoutNa,
  });
  byId.set('L02', {
    id: 'L02',
    status: 'pending',
    note: '[auto] Header/footer across all templates — check multiple pages manually.',
  });
  byId.set('L03', {
    id: 'L03',
    status: 'pending',
    note: html.legalLinkHints
      ? '[auto] Privacy/terms/legal href hints found — confirm pages and copy.'
      : '[auto] No clear legal page links in this HTML — verify Privacy/Terms exist where required.',
  });
  byId.set('L04', {
    id: 'L04',
    status: 'pending',
    note: '[auto] Thank-you and error flows — manual testing.',
  });

  byId.set('I04', {
    id: 'I04',
    status: 'pending',
    note: '[auto] CRM / chat / email integrations — manual verification.',
  });

  const autoChecks = CHECKLIST_IDS.map((id) => {
    const row = byId.get(id);
    if (row) return row;
    return {
      id,
      status: 'pending',
      note: '[auto] No automated signal mapped — complete manually.',
    };
  });

  return { autoChecks, scanWarnings };
}

/** When HTTP is not 2xx — still auto-set Pass/Fail (mostly Fail) instead of leaving checklist empty. */
function buildAutoChecksForErrorResponse(statusCode, finalUrl, requestedUrl) {
  const sc = Number(statusCode) || 0;
  const down = sc === 0 || sc >= 500 || sc === 521;
  const clientErr = sc >= 400 && sc < 500;
  const failNote = down
    ? `[auto] HTTP ${sc || 'error'} — origin not serving a normal page (fix hosting, then scan again).`
    : clientErr
      ? `[auto] HTTP ${sc} — request blocked or page missing.`
      : `[auto] HTTP ${sc} — not a successful 2xx page.`;

  const failOnError = new Set([
    'C01',
    'M01',
    'M02',
    'R01',
    'U01',
    'U02',
    'U03',
    'P03',
    'S01',
    'I01',
    'I02',
    'I03',
    'L01',
    'L05',
    'E01',
    'E02',
    'E03',
    'C03',
    'F01',
    'F02',
  ]);
  const naOnError = new Set([
    'F03',
    'F04',
    'Z01',
    'Z02',
    'C02',
    'L02',
    'L03',
    'L04',
    'I04',
    'B01',
    'P01',
    'P02',
    'U04',
    'S02',
    'SEO1',
  ]);

  const autoChecks = CHECKLIST_IDS.map((id) => {
    if (failOnError.has(id)) {
      return { id, status: 'fail', note: failNote };
    }
    if (naOnError.has(id)) {
      return {
        id,
        status: 'na',
        note: `[auto] Not scored while HTTP ${sc} — re-test after the site returns 200 OK.`,
      };
    }
    return { id, status: 'pending', note: failNote };
  });

  return {
    autoChecks,
    scanWarnings: [
      {
        message:
          `[auto] Checklist auto Pass/Fail applied for HTTP ${sc} — fix the live site, then re-scan for full 2xx signals.`,
      },
    ],
  };
}

/** Merge console / page-issue signals into checklist rows after browser pass. */
function enrichAutoChecksFromPageIssues(autoChecks, pageIssues, scanMeta) {
  if (!Array.isArray(autoChecks) || !autoChecks.length) return autoChecks;
  const items = (pageIssues && pageIssues.items) || [];
  const sum = summarizeMaterialIssues(items, scanMeta || { consoleCapture: pageIssues && pageIssues.consoleCapture });
  const errs = Number(sum.errors) || 0;
  const warns = Number(sum.warns) || 0;
  const cap = String((scanMeta && scanMeta.consoleCapture) || (pageIssues && pageIssues.consoleCapture) || '');
  const byId = new Map(autoChecks.map((ac) => [ac.id, { ...ac }]));

  if (errs >= 12) {
    byId.set('P03', {
      id: 'P03',
      status: 'fail',
      note: `[auto] ${errs} material console/network error(s) on this scan (third-party/ad-block noise excluded).`,
    });
    byId.set('U02', {
      id: 'U02',
      status: 'pending',
      note: '[auto] Several failed resources in console — verify broken assets or links.',
    });
  } else if (errs >= 1) {
    byId.set('P03', {
      id: 'P03',
      status: 'pending',
      note: `[auto] ${errs} console error(s) — review; may be third-party tags or non-blocking.`,
    });
  } else if (/playwright|serverless-puppeteer|vercel-http-console|html-only/i.test(cap)) {
    byId.set('P03', {
      id: 'P03',
      status: 'pass',
      note: '[auto] No material console errors on this pass (spot-check other pages).',
    });
  }

  if (warns >= 8 && byId.get('P03') && byId.get('P03').status !== 'fail') {
    byId.set('P03', {
      id: 'P03',
      status: 'pending',
      note: `[auto] ${warns} console warning(s) — review if any affect UX.`,
    });
  }

  return CHECKLIST_IDS.map((id) => byId.get(id) || { id, status: 'pending', note: '[auto] No signal.' });
}

const FOLLOWUP_ASSET_EXT = /\.(css|js|mjs|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|pdf|zip|mp4|webm|json)(\?|#|$)/i;

/** Up to `max` same-origin page URLs from HTML (excludes start URL, skips obvious assets). */
function collectSameOriginPageUrls(finalUrl, body, max) {
  const out = [];
  const seen = new Set();
  try {
    const origin = new URL(finalUrl);
    const originHost = origin.hostname;
    seen.add(origin.href.split('#')[0]);

    const hrefRe = /\bhref\s*=\s*["']([^"']+)["']/gi;
    let hm;
    const routeRe = /"(?:href|as|pathname)"\s*:\s*"(\/(?!\/)[^"\\]{1,180})"/gi;
    let rm;
    while ((rm = routeRe.exec(body)) !== null && out.length < max * 2) {
      const path = rm[1].trim();
      if (!path || path.length < 2) continue;
      try {
        const abs = new URL(path, finalUrl);
        if (abs.hostname !== originHost) continue;
        const key = abs.href.split('#')[0];
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(key);
      } catch {
        /* skip */
      }
    }

    while ((hm = hrefRe.exec(body)) !== null && out.length < max) {
      const href = hm[1].trim();
      if (
        !href ||
        href.startsWith('#') ||
        /^javascript:/i.test(href) ||
        /^mailto:/i.test(href) ||
        /^tel:/i.test(href)
      ) {
        continue;
      }
      if (FOLLOWUP_ASSET_EXT.test(href)) continue;
      let abs;
      try {
        abs = new URL(href, finalUrl);
      } catch {
        continue;
      }
      if (abs.hostname !== originHost) continue;
      if (!/^https?:$/i.test(abs.protocol)) continue;
      const key = abs.href.split('#')[0];
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
  } catch {
    /* noop */
  }
  return out;
}

function countMailtoAcrossBodies(bodies) {
  const mailtoEmails = new Set();
  let mailtoCount = 0;
  const mailtoRe = /\bhref\s*=\s*["']mailto:([^"'>\s]+)/gi;
  for (const raw of bodies) {
    const b = String(raw || '');
    mailtoCount += (b.match(/\bhref\s*=\s*["']mailto:/gi) || []).length;
    let mm;
    mailtoRe.lastIndex = 0;
    while ((mm = mailtoRe.exec(b)) !== null) {
      try {
        mailtoEmails.add(decodeURIComponent(mm[1].split('?')[0]).toLowerCase());
      } catch {
        mailtoEmails.add(mm[1].split('?')[0].toLowerCase());
      }
    }
  }
  return { mailtoUniqueCount: mailtoEmails.size, mailtoCount };
}

function mergeHtmlSignals(primary, mainBody, extras) {
  if (!extras.length) return primary;
  const analyzed = extras.map((e) => analyzeHtml(e.body, e.finalUrl, e.contentType));
  const m = { ...primary };
  let formCount = Number(primary.formCount) || 0;
  let telCount = Number(primary.telCount) || 0;
  let formHasRequiredAttr = !!primary.formHasRequiredAttr;
  let imageTags = Number(primary.imageTags) || 0;
  let imagesMissingOrEmptyAlt = Number(primary.imagesMissingOrEmptyAlt) || 0;
  let interactiveApprox = Number(primary.interactiveApprox) || 0;
  let internalLinkCount = Number(primary.internalLinkCount) || 0;

  for (const o of analyzed) {
    formCount += Number(o.formCount) || 0;
    telCount += Number(o.telCount) || 0;
    formHasRequiredAttr = formHasRequiredAttr || !!o.formHasRequiredAttr;
    imageTags += Number(o.imageTags) || 0;
    imagesMissingOrEmptyAlt += Number(o.imagesMissingOrEmptyAlt) || 0;
    interactiveApprox = Math.min(8000, interactiveApprox + (Number(o.interactiveApprox) || 0));
    internalLinkCount = Math.max(internalLinkCount, Number(o.internalLinkCount) || 0);
    m.loremIpsumDetected = m.loremIpsumDetected || o.loremIpsumDetected;
    m.comingSoonDetected = m.comingSoonDetected || o.comingSoonDetected;
    m.placeholderPhrasesDetected = m.placeholderPhrasesDetected || o.placeholderPhrasesDetected;
    m.zendeskSnippetDetected = m.zendeskSnippetDetected || o.zendeskSnippetDetected;
    m.modernImageExt = m.modernImageExt || o.modernImageExt;
    m.legalLinkHints = m.legalLinkHints || o.legalLinkHints;
    m.ssrHints = m.ssrHints || o.ssrHints;
    m.logoLikely = m.logoLikely || o.logoLikely;
    m.robotsMetaNoindex = m.robotsMetaNoindex || o.robotsMetaNoindex;
    m.hasViewport = m.hasViewport || o.hasViewport;
    m.hasCharset = m.hasCharset || o.hasCharset;
    m.hasTitle = m.hasTitle || o.hasTitle;
    m.hasMetaDescription = m.hasMetaDescription || o.hasMetaDescription;
    m.hasFaviconLink = m.hasFaviconLink || o.hasFaviconLink;
    m.layoutSemanticsOk = m.layoutSemanticsOk || o.layoutSemanticsOk;
  }

  const mailAgg = countMailtoAcrossBodies([mainBody, ...extras.map((e) => e.body)]);
  m.formCount = formCount;
  m.telCount = telCount;
  m.mailtoCount = mailAgg.mailtoCount;
  m.mailtoUniqueCount = mailAgg.mailtoUniqueCount;
  m.formHasRequiredAttr = formHasRequiredAttr;
  m.imageTags = imageTags;
  m.imagesMissingOrEmptyAlt = imagesMissingOrEmptyAlt;
  m.interactiveApprox = interactiveApprox;
  m.internalLinkCount = internalLinkCount;
  m._followUpPagesSampled = extras.length;
  return m;
}

/**
 * Sequential GET of a few same-origin pages linked from the start HTML (bounded time).
 * @returns {{ samples: Array<{ body: string; finalUrl: string; contentType: string }>; queuedUrls: string[] }}
 */
async function fetchFollowUpSameOriginSamples(finalUrl, mainBody, opts = {}) {
  const maxPages = opts.maxPages != null ? opts.maxPages : 2;
  const maxTotalMs = opts.maxTotalMs != null ? opts.maxTotalMs : 20_000;
  const perPageTimeoutMs = opts.perPageTimeoutMs != null ? opts.perPageTimeoutMs : 10_000;
  const deadline = Date.now() + maxTotalMs;
  const urls = collectSameOriginPageUrls(finalUrl, mainBody, maxPages);
  /** @type {Array<{ body: string; finalUrl: string; contentType: string }>} */
  const samples = [];
  for (const href of urls) {
    if (Date.now() > deadline) break;
    try {
      const b = await fetchUrl(href, 3, { timeoutMs: perPageTimeoutMs });
      if (b.statusCode >= 200 && b.statusCode < 400 && b.body) {
        const ct = String(b.contentType || '');
        if (/html|text\/plain/i.test(ct) || /<html[\s>]/i.test(b.body.slice(0, 2500))) {
          samples.push({
            body: b.body,
            finalUrl: b.finalUrl,
            contentType: ct,
          });
        }
      }
    } catch {
      /* skip */
    }
  }
  return { samples, queuedUrls: urls };
}

async function fetchRobotsTxt(originHref) {
  const out = { fetched: false, status: null, hasSitemapLine: false, error: '', preview: '' };
  try {
    const u = new URL('/robots.txt', originHref);
    const r = await fetchUrl(u.href, 3);
    out.fetched = true;
    out.status = r.statusCode;
    const b = r.body || '';
    out.preview = b.slice(0, 400).replace(/\r/g, '');
    out.hasSitemapLine = /^\s*sitemap\s*:/im.test(b);
    if (r.statusCode >= 400) out.error = `HTTP ${r.statusCode}`;
  } catch (e) {
    out.error = String(e.message || e);
  }
  return out;
}

function normalizeScanApiBase(raw) {
  const s = String(raw || '').trim().replace(/\/+$/, '');
  if (!s || !/^https?:\/\//i.test(s)) return '';
  try {
    const u = new URL(s);
    if (isBlockedHost(u.hostname)) return '';
    return u.origin;
  } catch {
    return '';
  }
}

function explainNonJsonTunnelResponse(text, status, base) {
  const sample = String(text || '').slice(0, 800).toLowerCase();
  if (status === 511 || /tunnel reminder|bypass-tunnel-reminder|loca\.lt/i.test(sample)) {
    return (
      'Tunnel returned an HTML warning page (localtunnel), not scan JSON. Fix: (1) On your PC run npm run go-live:audit:tunnel and keep it open. (2) Open the tunnel URL once in your browser and click Continue. (3) Paste the fresh https URL into Scan API base. Or leave Scan API base empty to scan on Vercel only.'
    );
  }
  if (/ngrok|tunnel\.ngrok/i.test(sample) || status === 404) {
    return (
      'Tunnel is down or the URL changed — ngrok/localtunnel gives a new link each time. Run npm run go-live:audit:tunnel again, paste the new https URL, or clear Scan API base to use Vercel scan only.'
    );
  }
  if (/<!doctype html|<html[\s>]/i.test(sample)) {
    return (
      'Scan API base returned HTML instead of JSON (tunnel expired, PC server stopped, or wrong URL). Clear Scan API base for Vercel-only scan, or restart: npm run go-live:audit:tunnel'
    );
  }
  return (
    'Scan API base returned non-JSON (HTTP ' +
    status +
    '). Check tunnel is running at ' +
    base +
    ' or leave Scan API base empty.'
  );
}

/** Vercel UI can POST here with scanApiBase — server forwards to tunnel/Render (no browser CORS). */
async function proxyScanToRemoteBase(res, json) {
  const base = normalizeScanApiBase(json.scanApiBase || json.apiBase);
  if (!base) return false;
  const target = base + '/api/scan';
  const payload = { ...json };
  delete payload.scanApiBase;
  delete payload.apiBase;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 55_000);
  const proxyHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'Automation-Framework-GoLiveAudit/1.0',
    'Bypass-Tunnel-Reminder': 'true',
    'ngrok-skip-browser-warning': 'true',
  };
  try {
    const r = await fetch(target, {
      method: 'POST',
      headers: proxyHeaders,
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text || '{}');
    } catch {
      sendJson(res, 502, {
        ok: false,
        error: explainNonJsonTunnelResponse(text, r.status, base),
        proxyTarget: target,
        proxyHttpStatus: r.status,
        emailReport: json.sendEmail || json.emailReport ? {
          skipped: true,
          reason: 'Email not attempted because Scan API base did not return scan JSON. Clear Scan API base for Vercel scan, then run again.',
        } : undefined,
      });
      return true;
    }
    const status = r.status >= 400 && data.ok !== true ? r.status : 200;
    sendJson(res, status, data);
    return true;
  } catch (e) {
    sendJson(res, 502, {
      ok: false,
      error:
        'Scan API base unreachable: ' +
        String(e.message || e) +
        '. Run npm run go-live:audit:tunnel on your PC (keep terminal open) or clear Scan API base.',
      emailReport: json.sendEmail || json.emailReport ? {
        skipped: true,
        reason: 'Email not attempted because Scan API base was unreachable. Clear Scan API base for Vercel scan, then run again.',
      } : undefined,
    });
    return true;
  } finally {
    clearTimeout(timer);
  }
}

async function augmentConsoleWithStaticFallback(pw, htmlBody, pageUrl, onServerless) {
  if (!onServerless || !htmlBody) return pw;
  const hasLogs = pw && Array.isArray(pw.logs) && pw.logs.length > 0;
  if (hasLogs) return pw;
  try {
    const { buildStaticConsoleSignals } = require('./go-live-audit-static-console.cjs');
    const { logs } = await buildStaticConsoleSignals(htmlBody, pageUrl, fetchUrl);
    if (!logs.length) return pw;
    return {
      logs,
      pageStats: pw && pw.pageStats ? pw.pageStats : null,
      runtime: 'vercel-http-console',
      error: pw && pw.error ? pw.error : undefined,
    };
  } catch {
    return pw;
  }
}

async function handleScan(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  let requestedUrl = '';
  let json = {};
  try {
    const raw = await readBody(req);
    try {
      json = JSON.parse(raw || '{}');
    } catch {
      sendJson(res, 400, { ok: false, error: 'Invalid JSON body' });
      return;
    }
    requestedUrl = String(json.url || '').trim();
    const brandName = String(json.brandName || json.brand || '').trim().slice(0, 120);
    if (!requestedUrl) {
      sendJson(res, 400, { ok: false, error: 'Missing url' });
      return;
    }

    if (await proxyScanToRemoteBase(res, json)) return;

    function applyPlaywrightConsoleResult(pw, lists, onServerless) {
      let consoleCapture = 'html-only';
      let consoleCaptureDetail = '';
      const logs = Array.isArray(pw)
        ? pw
        : pw && Array.isArray(pw.logs)
          ? pw.logs
          : [];
      const err = pw && pw.error ? String(pw.error) : '';

      if (logs.length) {
        lists.push(issuesFromPlaywrightConsole(logs));
        consoleCapture = onServerless ? 'playwright-vercel' : 'playwright';
        const viaHttp = pw && pw.runtime === 'vercel-http-console';
        consoleCaptureDetail =
          (viaHttp ? 'deep HTTP console (Vercel) — ' : pw && pw.runtime ? pw.runtime + ' — ' : '') +
          logs.length +
          ' browser log line(s)';
      } else if (err) {
        consoleCapture = onServerless ? 'playwright-vercel-failed' : 'playwright-failed';
        consoleCaptureDetail = err.slice(0, 200);
        lists.push([
          {
            kind: 'console',
            severity: 'warn',
            message: 'Browser console capture failed on server: ' + err.slice(0, 160),
          },
        ]);
      } else if (pw) {
        consoleCapture = onServerless ? 'playwright-vercel-empty' : 'playwright-empty';
        consoleCaptureDetail = onServerless
          ? 'Browser ran on Vercel but logged no errors (tracking scripts may differ from your PC).'
          : 'Browser opened; no console errors logged.';
      }
      return { consoleCapture, consoleCaptureDetail };
    }

    async function buildPageIssuesForScan(htmlBody, avail, sc, pageUrl, cachedPw, scanOpts) {
      const lists = [issuesFromAvailability(avail, sc), detectHtmlRuntimeIssues(htmlBody)];
      const onSrv = scanOpts && scanOpts.onServerless;
      let consoleCapture = 'html-only';
      let consoleCaptureDetail = '';
      const wantPw =
        json.captureConsole !== false &&
        process.env.GO_LIVE_AUDIT_NO_PLAYWRIGHT_CONSOLE !== '1' &&
        sc >= 200 &&
        sc < 400;
      if (wantPw) {
        const { isServerlessChromiumRuntime } = require('./go-live-audit-playwright-console.cjs');
        const onServerless = isServerlessChromiumRuntime();
        let pw =
          cachedPw !== undefined && cachedPw !== null
            ? cachedPw
            : await captureBrowserConsole(pageUrl || requestedUrl, {
                timeoutMs: onServerless ? (watchBatch ? 12_000 : 28_000) : 18_000,
                waitAfterMs: onServerless ? (watchBatch ? 2500 : 6000) : 3000,
              });
        if (onServerless && htmlBody) {
          pw = await augmentConsoleWithStaticFallback(pw, htmlBody, pageUrl || requestedUrl, onServerless);
        }
        const applied = applyPlaywrightConsoleResult(pw, lists, onServerless);
        consoleCapture = applied.consoleCapture;
        consoleCaptureDetail = applied.consoleCaptureDetail;
        if ((onServerless || onSrv) && htmlBody) {
          if (consoleCapture === 'playwright-vercel-failed' || consoleCapture === 'playwright-vercel-empty') {
            lists.push(issuesFromHtmlScriptHints(htmlBody));
          }
          try {
            const scriptIssues = await issuesFromScriptSrcProbe(htmlBody, pageUrl || requestedUrl, fetchUrl);
            if (scriptIssues.length) lists.push(scriptIssues);
          } catch {
            /* probe optional */
          }
        }
      }
      const items = mergeIssues(lists);
      return { items, summary: summarizeIssues(items), consoleCapture, consoleCaptureDetail };
    }

    let bundle;
    try {
      bundle = await fetchUrl(requestedUrl, 5, defaultFetchOpts());
    } catch (fetchErr) {
      const availability = classifyAvailabilityError(fetchErr);
      const downChecks = buildAutoChecksForErrorResponse(0, requestedUrl, requestedUrl);
      const overallSummary = buildOverallSummary({
        reachable: false,
        availability,
        statusCode: 0,
        autoChecks: downChecks.autoChecks,
        scanWarnings: downChecks.scanWarnings,
        html: null,
      });
      const pageIssuesDown = await buildPageIssuesForScan('', availability, 0, requestedUrl);
      const unreachablePayload = {
        ok: false,
        requestedUrl,
        brandName: brandName || null,
        alertEmail: getAlertEmail(),
        availability,
        error: String(fetchErr.message || fetchErr),
        autoChecks: downChecks.autoChecks,
        contentAutoChecksSkipped: true,
        contentAutoChecksSkipReason: availability.headline || 'Site unreachable',
        overallSummary,
        pageIssues: pageIssuesDown,
        statusCode: 0,
        siteStack: {
          host: '',
          headline: 'Site unreachable — stack unknown',
          subline: availability.detail || String(fetchErr.message || fetchErr),
          panelTone: 'bad',
          items: [],
          alerts: [
            {
              level: 'bad',
              message: 'Could not fetch the URL — no headers or HTML to detect Laravel, WordPress, PHP, etc.',
            },
          ],
          scannedAt: new Date().toISOString(),
        },
      };
      enrichScanReportPayload(unreachablePayload, {
        brandName,
        reachable: false,
        statusCode: 0,
        htmlBody: '',
        headers: {},
      });
      await flushScanEmailIfNeeded(json, unreachablePayload);
      ensureEmailReportOnPayload(json, unreachablePayload);
      sendJson(res, 200, unreachablePayload);
      return;
    }

    const { statusCode, headers, finalUrl, body, contentType } = bundle;
    const availability = summarizeHttpAvailability(statusCode, finalUrl);

    /** @type {Array<{ message: string }>} */
    const tlsRelaxedWarnings = [];
    if (bundle.tlsRelaxed) {
      tlsRelaxedWarnings.push({
        message:
          '[auto] TLS certificate could not be verified from this PC (common with office antivirus/proxy). Scan retried with relaxed HTTPS verify so availability matches Vercel. For a permanent local fix: npm run go-live:audit:insecure-tls (trusted network only).',
      });
    }

    const { isServerlessChromiumRuntime } = require('./go-live-audit-playwright-console.cjs');
    const onServerlessDeploy = isServerlessChromiumRuntime();
    const watchBatch = !!(json.watchBatch);
    let cachedConsolePw = null;
    const wantConsoleOnServerless =
      onServerlessDeploy &&
      json.captureConsole !== false &&
      process.env.GO_LIVE_AUDIT_NO_PLAYWRIGHT_CONSOLE !== '1' &&
      statusCode >= 200 &&
      statusCode < 400;

    const html = analyzeHtml(body, finalUrl, contentType);
    html._contentType = contentType;
    if (onServerlessDeploy) {
      enrichInteractiveFromHtml(body, html);
    }

    let robotsInfo = { fetched: false, status: null, hasSitemapLine: false, error: '', preview: '' };
    let followUpSamples = [];
    let deepHttpScan = false;

    if (statusCode && statusCode < 500) {
      if (onServerlessDeploy) {
        try {
          robotsInfo = await fetchRobotsTxt(finalUrl);
        } catch (e) {
          robotsInfo.error = String(e.message || e);
        }
        if (statusCode >= 200 && statusCode < 400 && html.isHtmlDocument) {
          try {
            followUpSamples = await fetchDeepFollowUpSamples(finalUrl, body, fetchUrl, {
              maxPages: watchBatch ? 1 : 3,
              maxTotalMs: watchBatch ? 10_000 : 20_000,
              perPageTimeoutMs: watchBatch ? 6_000 : 8_000,
              helpers: { collectSameOriginPageUrls, fetchFollowUpSameOriginSamples },
            });
            deepHttpScan = true;
          } catch {
            followUpSamples = [];
          }
        }
        if (wantConsoleOnServerless) {
          cachedConsolePw = await captureBrowserConsole(finalUrl || requestedUrl, {
            timeoutMs: watchBatch ? 12_000 : 22_000,
            waitAfterMs: watchBatch ? 2500 : 4500,
          });
        }
      } else {
        try {
          robotsInfo = await fetchRobotsTxt(finalUrl);
        } catch (e) {
          robotsInfo.error = String(e.message || e);
        }
        if (statusCode >= 200 && statusCode < 400 && html.isHtmlDocument) {
          const fu = await fetchFollowUpSameOriginSamples(finalUrl, body, {
            maxPages: 2,
            maxTotalMs: 20_000,
          });
          followUpSamples = fu.samples;
        }
      }
    }

    const mergedHtml =
      followUpSamples.length > 0 ? mergeHtmlSignals(html, body, followUpSamples) : html;
    mergedHtml._contentType = contentType;

    if (cachedConsolePw && cachedConsolePw.pageStats) {
      const ps = cachedConsolePw.pageStats;
      if (ps.interactiveApprox != null && ps.interactiveApprox > 0) {
        mergedHtml.interactiveApprox = Math.max(mergedHtml.interactiveApprox || 0, ps.interactiveApprox);
      }
      if (ps.buttonCount != null) {
        mergedHtml._browserButtonCount = ps.buttonCount;
      }
      if (ps.anchorHrefCount != null) {
        mergedHtml._browserAnchorCount = ps.anchorHrefCount;
      }
    }

    const bodySlice = [body, ...followUpSamples.map((s) => s.body)]
      .map((b) => String(b || '').slice(0, 80_000))
      .join('\n')
      .slice(0, 180_000);

    const xRobots = String(headers['x-robots-tag'] || '').toLowerCase();
    const xRobotsNoindex = xRobots.includes('noindex');

    const skipCh = shouldSkipContentAutoChecks(statusCode, mergedHtml);
    let autoChecks;
    /** @type {Array<{ message: string }>} */
    let scanWarnings;
    if (skipCh.skip) {
      const errBuilt = buildAutoChecksForErrorResponse(statusCode, finalUrl, requestedUrl);
      autoChecks = errBuilt.autoChecks;
      scanWarnings = [
        { message: skipCh.reason + ' Fix hosting or the URL, then run the scan again.' },
        ...errBuilt.scanWarnings,
      ];
    } else {
      const built = buildAutoChecks(
        requestedUrl,
        finalUrl,
        statusCode,
        headers,
        mergedHtml,
        robotsInfo,
        bodySlice
      );
      autoChecks = built.autoChecks;
      scanWarnings = built.scanWarnings;
    }

    if (tlsRelaxedWarnings.length) {
      scanWarnings = [...tlsRelaxedWarnings, ...(scanWarnings || [])];
    }

    if (statusCode >= 500 && !skipCh.skip) {
      scanWarnings.unshift({
        message: `HTTP ${statusCode}: origin server error — treat as possible downtime or misconfiguration.`,
      });
    }

    if (followUpSamples.length > 0) {
      scanWarnings.push({
        message: `[auto] Follow-up pass: merged ${followUpSamples.length} extra same-origin HTML page(s) linked from the start URL (sample only; not a full crawl).`,
      });
    } else if (onServerlessDeploy && html.isHtmlDocument) {
      scanWarnings.push({
        message:
          '[live] No extra pages merged — try sitemap or internal links; for full parity with local scan use tunnel + Scan API base.',
      });
    }

    let siteStack = skipCh.skip
      ? {
          host: (() => {
            try {
              return new URL(finalUrl).hostname;
            } catch {
              return '';
            }
          })(),
          headline: 'Stack scan skipped',
          subline: skipCh.reason,
          panelTone: 'warn',
          items: [],
          alerts: [
            {
              level: 'warn',
              message:
                'Checklist auto-fill was skipped — framework detection needs HTTP 2xx HTML from the live site.',
            },
          ],
          scannedAt: new Date().toISOString(),
        }
      : detectSiteStack(headers, bodySlice, finalUrl);

    if (!skipCh.skip && siteStack && siteStack.items) {
      siteStack = await enrichSiteStackVersions(siteStack, bodySlice, finalUrl, fetchUrl);
    }

    const pageIssues = await buildPageIssuesForScan(
      bodySlice,
      availability,
      statusCode,
      finalUrl,
      cachedConsolePw,
      { onServerless: onServerlessDeploy, deepHttpScan }
    );
    autoChecks = enrichAutoChecksFromPageIssues(autoChecks, pageIssues, {
      consoleCapture: pageIssues.consoleCapture,
    });
    if (pageIssues.items.length) {
      for (const it of pageIssues.items) {
        if (it.severity === 'error' || it.severity === 'warn') {
          scanWarnings.push({
            message: `[${it.kind || 'issue'}] ${it.message}`,
          });
        }
      }
    }
    if (
      onServerlessDeploy &&
      pageIssues.consoleCapture &&
      String(pageIssues.consoleCapture).includes('failed')
    ) {
      scanWarnings.unshift({
        message:
          '[live] Real browser could not start on Vercel — used deep HTTP scan (extra pages, script checks, HTML hints). For the same console + vulnerabilities as local: open http://localhost:3940 or set Scan API base to an ngrok tunnel (npm run go-live:audit:tunnel).',
      });
    }

    const overallSummary = buildOverallSummary({
      reachable: true,
      availability,
      statusCode,
      autoChecks,
      scanWarnings,
      html: mergedHtml,
    });

    let domainSsl = null;
    try {
      domainSsl = await buildDomainSslReport(finalUrl || requestedUrl);
      if (domainSsl && domainSsl.alerts && domainSsl.alerts.length) {
        for (const a of domainSsl.alerts) {
          scanWarnings.push({
            message: '[' + (a.type || 'expiry') + '] ' + (a.headline || 'Renewal attention needed'),
          });
        }
      }
    } catch (domainSslErr) {
      domainSsl = {
        ok: false,
        error: String((domainSslErr && domainSslErr.message) || domainSslErr).slice(0, 200),
        headline: 'SSL / domain expiry check failed',
        panelTone: 'neutral',
        shouldAlert: false,
        items: [],
        alerts: [],
      };
    }

    let attackSurface = null;
    try {
      const attackSurfaceTimeoutMs = onServerlessDeploy ? 8_000 : 15_000;
      attackSurface = await Promise.race([
        buildAttackSurfaceReport({
          finalUrl,
          headers,
          html: bodySlice,
        }),
        new Promise((resolve) =>
          setTimeout(() => {
            resolve({
              ok: false,
              headline: 'Attack-surface scan timed out (partial)',
              panelTone: 'neutral',
              shouldAlert: false,
              findings: [],
              categories: [],
              scopeNote:
                'Attack-surface checks timed out for this URL; core scan still completed. Re-run scan or test locally.',
            });
          }, attackSurfaceTimeoutMs)
        ),
      ]);
      if (attackSurface && attackSurface.findings && attackSurface.findings.length) {
        for (const f of attackSurface.findings.filter((x) => x.severity === 'critical' || x.severity === 'high')) {
          scanWarnings.push({
            message: '[' + (f.category || 'security') + '] ' + (f.title || 'Attack-surface finding'),
          });
        }
      }
    } catch (attackSurfaceErr) {
      attackSurface = {
        ok: false,
        error: String((attackSurfaceErr && attackSurfaceErr.message) || attackSurfaceErr).slice(0, 200),
        headline: 'Attack-surface scan failed',
        panelTone: 'neutral',
        shouldAlert: false,
        findings: [],
        categories: [],
      };
    }

    const successPayload = {
      ok: true,
      requestedUrl,
      brandName: brandName || null,
      alertEmail: getAlertEmail(),
      pageIssues,
      availability,
      siteStack,
      domainSsl,
      attackSurface,
      contentAutoChecksSkipped: skipCh.skip,
      contentAutoChecksSkipReason: skipCh.skip ? skipCh.reason : null,
      finalUrl,
      statusCode,
      contentType: contentType || null,
      xRobotsTag: headers['x-robots-tag'] || null,
      xRobotsNoindex,
      htmlSignals: mergedHtml,
      robotsTxt: robotsInfo,
      autoChecks,
      scanWarnings,
      overallSummary,
      scanMeta: {
        followUpPagesFetched: followUpSamples.length,
        followUpPageUrls: followUpSamples.map((s) => s.finalUrl),
        consoleCapture: pageIssues.consoleCapture || 'unknown',
        consoleCaptureDetail: pageIssues.consoleCaptureDetail || '',
        scannedOnServerless: onServerlessDeploy,
        scanDetailMode: onServerlessDeploy ? 'vercel-full' : 'local-full',
        deepHttpScan: !!deepHttpScan,
        browserScanOk:
          (pageIssues.consoleCapture === 'playwright-vercel' ||
            pageIssues.consoleCapture === 'playwright') &&
          !(pageIssues.consoleCaptureDetail || '').includes('failed on server'),
      },
      disclaimer:
        'Scan uses the start URL and robots.txt, then may fetch up to two same-origin pages linked from that HTML (time-capped) to widen signals. Form delivery, Zendesk, CLS, and full-site crawling still need manual QA or Playwright.',
    };
    enrichScanReportPayload(successPayload, {
      brandName,
      reachable: true,
      statusCode,
      htmlBody: bodySlice,
      headers,
      domainSsl,
      attackSurface,
    });
    await flushScanEmailIfNeeded(json, successPayload);
    ensureEmailReportOnPayload(json, successPayload);
    const bnSave = brandName || successPayload.brandName;
    if (bnSave) {
      try {
        const { saveBrandReport } = require('./go-live-audit-brand-reports.cjs');
        successPayload.brandReportStored = await saveBrandReport({
          brandName: bnSave,
          url: requestedUrl,
          payload: successPayload,
          checklistState: json.checklistState,
        });
      } catch (storeErr) {
        successPayload.brandReportStored = {
          ok: false,
          error: String((storeErr && storeErr.message) || storeErr).slice(0, 160),
        };
      }
    }
    sendJson(res, 200, successPayload);
  } catch (e) {
    const failPayload = { ok: false, error: normalizeErrorValue(e), requestedUrl };
    ensureEmailReportOnPayload(json, failPayload);
    sendJson(res, 400, failPayload);
  }
}

/**
 * Run a full scan in-process (for watch daemon / automation).
 * @param {Record<string, unknown>} json Same body as POST /api/scan
 */
function runScanInternal(json) {
  return new Promise((resolve, reject) => {
    const http = require('http');
    const body = JSON.stringify(json || {});
    const req = new http.IncomingMessage();
    req.push(body);
    req.push(null);
    req.method = 'POST';
    req.headers = { 'content-type': 'application/json' };

    const res = {
      statusCode: 200,
      writeHead() {},
      end(data) {
        try {
          resolve(JSON.parse(String(data || '{}')));
        } catch (e) {
          reject(e);
        }
      },
    };

    handleScan(req, res).catch(reject);
  });
}

module.exports = { handleScan, sendJson, runScanInternal };
