'use strict';

const crypto = require('crypto');

/** @type {Array<{ id: string, severity: 'critical'|'warn'|'info', re: RegExp, message: string, kind?: string }>} */
const RULES = [
  { id: 'crypto_miner', severity: 'critical', kind: 'malware', re: /coinhive|cryptonight|crypto-loot|coin-hive|minero\.|webmine|deepMiner/i, message: 'Possible cryptocurrency miner script' },
  { id: 'obfuscated_js', severity: 'critical', kind: 'malware', re: /eval\s*\(\s*(?:atob|unescape|decodeURIComponent)\s*\(/i, message: 'Heavily obfuscated JavaScript (eval + decode)' },
  { id: 'php_shell', severity: 'critical', kind: 'intrusion', re: /c99shell|r57shell|FilesMan|b374k|wso\s*shell|php\s*shell|passthru\s*\(\s*\$_(?:GET|POST)/i, message: 'Possible PHP web shell signature in page' },
  { id: 'defacement', severity: 'critical', kind: 'defacement', re: /hacked\s+by|defaced\s+by|owned\s+by|pwned\s+by|cyber\s*attack/i, message: 'Defacement / hack message in HTML' },
  {
    id: 'seed_phrase_phish',
    severity: 'critical',
    kind: 'compromise',
    re: /seed\s*phrase|recovery\s*phrase|secret\s*recovery|mnemonic\s*phrase|12[-\s]?word|24[-\s]?word/i,
    message: 'Wallet seed / recovery phrase prompt (common drainer / hack page)',
  },
  {
    id: 'ransom_note',
    severity: 'critical',
    kind: 'compromise',
    re: /your\s+files?\s+(?:have\s+been\s+)?encrypted|pay\s+(?:us\s+)?(?:in\s+)?bitcoin|\.onion/i,
    message: 'Possible ransomware / extortion message on site',
  },
  { id: 'seo_spam', severity: 'warn', kind: 'spam', re: /viagra|cialis|casino\s*online|payday\s*loan|replica\s*watch/i, message: 'SEO spam / pharma keywords (often injection)' },
  { id: 'hidden_iframe', severity: 'warn', kind: 'injection', re: /<iframe[^>]+(?:width|height)\s*=\s*["']?[01]["']?/i, message: 'Hidden iframe (possible clickjacking or injection)' },
  { id: 'suspicious_redirect', severity: 'warn', kind: 'redirect', re: /<meta[^>]+http-equiv\s*=\s*["']refresh["'][^>]+url\s*=\s*https?:\/\//i, message: 'Meta refresh redirect detected' },
  { id: 'sql_error', severity: 'warn', kind: 'exposure', re: /SQL syntax.*MySQL|ORA-\d{5}|PostgreSQL.*ERROR|sqlite3\.OperationalError/i, message: 'Database error exposed in page (possible SQLi probe)' },
  { id: 'git_exposed', severity: 'critical', kind: 'exposure', re: /\[core\]\s*repositoryformatversion|ref:\s*refs\/heads\/main/i, message: 'Possible .git repository content exposed in HTML' },
  { id: 'env_leak', severity: 'critical', kind: 'exposure', re: /APP_KEY=base64:|DB_PASSWORD=|AWS_SECRET_ACCESS_KEY=/i, message: 'Possible .env / secrets leaked in response' },
  { id: 'base64_blob', severity: 'info', kind: 'malware', re: /[A-Za-z0-9+/]{4000,}={0,2}/, message: 'Very large base64 blob in HTML (often inline assets — review if unexpected)' },
  { id: 'external_password_form', severity: 'warn', kind: 'phishing', re: /<form[^>]+action\s*=\s*["']https?:\/\/(?!localhost)[^"']+["'][^>]*(?:password|login)/i, message: 'Login form posts to external domain' },
];

/** True when page title looks unrelated to the brand name (possible takeover). */
function brandTitleMismatch(brandName, title) {
  const bn = String(brandName || '').trim();
  const t = String(title || '').trim().toLowerCase();
  if (!bn || bn.length < 3 || !t) return false;
  const tokens = bn
    .toLowerCase()
    .split(/[\s\-_.]+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter((w) => w.length >= 4);
  if (tokens.length) return !tokens.some((tok) => t.includes(tok));
  const compact = bn.toLowerCase().replace(/[^a-z0-9]/g, '');
  return compact.length >= 4 && !t.includes(compact.slice(0, Math.min(compact.length, 8)));
}

/** Hostname suggests a brand site but title is crypto-scam themed (e.g. logogrand.com → BTC Airdrop). */
function hostnameCryptoTitleMismatch(finalUrl, title) {
  let host = '';
  try {
    host = new URL(finalUrl || 'http://x').hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return false;
  }
  const brandPart = (host.split('.')[0] || '').replace(/[^a-z0-9]/g, '');
  const t = String(title || '').toLowerCase();
  if (brandPart.length < 4 || !t) return false;
  const cryptoTitle = /airdrop|btc|bitcoin|wallet\s*drain|connect\s*wallet|claim\s+(?:your|the)?\s*reward|crypto\s*reward/i.test(
    t
  );
  if (!cryptoTitle) return false;
  return !t.includes(brandPart.slice(0, Math.min(brandPart.length, 8)));
}

/**
 * Multi-signal compromise: crypto wallet phishing, fake airdrops, site takeover content.
 * @returns {{ addThreat: object } | null}
 */
function detectCompromiseProfile(html, opts) {
  const body = String(html || '');
  if (!body || body.length < 80) return null;
  const title = (body.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
  const titleLower = title.toLowerCase();
  const textLower = body.toLowerCase();

  const signals = [];
  const mark = (id) => {
    if (!signals.includes(id)) signals.push(id);
  };

  if (/connect\s+(?:your\s+)?wallet|wallet\s*connect|link\s+(?:your\s+)?wallet/i.test(body)) mark('connect_wallet');
  if (/btc\s*airdrop|bitcoin\s*airdrop|crypto\s*airdrop|token\s*airdrop|x\s*btc\s*airdrop/i.test(body)) mark('crypto_airdrop');
  if (
    /(?:claim|receive|get)\s+(?:your\s+)?(?:\$?\d+|free\s+)?(?:btc|bitcoin|eth|crypto|reward|airdrop)/i.test(body) ||
    /claim(?:ed)?\s+today/i.test(body)
  ) {
    mark('claim_reward');
  }
  if (/\$\d+\s*(?:worth\s+of\s+)?(?:₿|btc|bitcoin)|free\s+btc|btc\s+reward/i.test(body)) mark('money_lure');
  if (/(?:eligible\s+wallets?|wallet\s+address|non-custodial\s+wallet|active\s+btc\s+wallets?)/i.test(body)) {
    mark('wallet_targeting');
  }
  if (/(?:metamask|walletconnect|trust\s*wallet|phantom|unisat|xverse|ledger|trezor)/i.test(body)) mark('wallet_apps');
  if (/campaign\s+progress|participants\s*\(24h\)|remaining\s+spots/i.test(body)) mark('fake_campaign_ui');

  const cryptoTitle = /airdrop|btc|bitcoin|wallet|claim|crypto\s*reward/i.test(titleLower);
  const brandMismatch =
    (opts.brandName && brandTitleMismatch(opts.brandName, title) && signals.length >= 1) ||
    hostnameCryptoTitleMismatch(opts.finalUrl, title);

  const strongCombo =
    (signals.includes('connect_wallet') &&
      (signals.includes('crypto_airdrop') || signals.includes('claim_reward') || signals.includes('money_lure'))) ||
    (signals.includes('crypto_airdrop') && signals.includes('claim_reward')) ||
    (cryptoTitle && signals.includes('connect_wallet'));

  const score = signals.length;
  if (!strongCombo && score < 3 && !brandMismatch) return null;

  let message = 'Possible HACK / site compromise — crypto wallet phishing or fake airdrop content detected';
  if (brandMismatch) {
    message =
      'Possible HACK / takeover — page title and content do not match the brand (crypto scam / drainer pattern)';
  } else if (signals.includes('connect_wallet') && signals.includes('crypto_airdrop')) {
    message = 'Possible HACK — fake BTC/crypto airdrop with Connect Wallet (wallet drainer risk)';
  }

  return {
    id: 'site_compromised',
    kind: 'compromise',
    severity: 'critical',
    message,
    signals,
    score,
    pageTitle: title.trim().slice(0, 160) || null,
  };
}

function fingerprintPage(html, finalUrl) {
  const body = String(html || '').slice(0, 120_000);
  let host = '';
  try {
    host = new URL(finalUrl || 'http://x').hostname;
  } catch {
    host = '';
  }
  const title = (body.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
  const scriptSrcs = (body.match(/<script[^>]+src\s*=\s*["']([^"']+)["']/gi) || []).length;
  const iframeCount = (body.match(/<iframe\b/gi) || []).length;
  const formCount = (body.match(/<form\b/gi) || []).length;
  const sig = [host, title.trim().slice(0, 120), scriptSrcs, iframeCount, formCount, body.length].join('|');
  const hash = crypto.createHash('sha256').update(sig).digest('hex').slice(0, 16);
  return { hash, title: title.trim().slice(0, 200), scriptSrcs, iframeCount, formCount };
}

/**
 * @param {object} opts
 * @param {string} opts.html
 * @param {Record<string,string>} [opts.headers]
 * @param {string} [opts.finalUrl]
 * @param {object} [opts.pageIssues]
 * @param {object} [opts.consoleIssues]
 * @param {object} [opts.baseline] prior fingerprint from brand watch
 * @param {string} [opts.brandName] expected brand (title mismatch → takeover signal)
 */
function detectSecurityThreats(opts) {
  const html = String((opts && opts.html) || '');
  const headers = opts.headers || {};
  const threats = [];
  const seen = new Set();

  function add(t) {
    const key = t.id + '|' + t.message;
    if (seen.has(key)) return;
    seen.add(key);
    threats.push(t);
  }

  for (const rule of RULES) {
    if (rule.re.test(html)) {
      add({
        id: rule.id,
        kind: rule.kind || 'threat',
        severity: rule.severity,
        message: rule.message,
      });
    }
  }

  const compromise = detectCompromiseProfile(html, {
    finalUrl: opts.finalUrl,
    brandName: opts.brandName,
  });
  if (compromise) add(compromise);

  const xPowered = String(headers['x-powered-by'] || headers['X-Powered-By'] || '');
  if (/sqlmap|nikto|masscan|ZmEu/i.test(xPowered)) {
    add({ id: 'scanner_header', kind: 'probe', severity: 'warn', message: 'Suspicious X-Powered-By scanner fingerprint' });
  }

  const pi = opts.pageIssues;
  if (pi && Array.isArray(pi.items)) {
    for (const it of pi.items) {
      const msg = String(it.message || '');
      const isDownAvailability = it.kind === 'availability' && it.severity === 'error';
      const isServerHttp =
        it.kind === 'http' &&
        it.severity === 'error' &&
        /HTTP 5\d\d|HTTP 521|likely down|server error/i.test(msg);
      if (isDownAvailability || isServerHttp) {
        add({
          id: 'site_down',
          kind: 'availability',
          severity: 'critical',
          message: msg || 'Site unreachable or HTTP server error',
        });
      }
    }
  }

  const ci = opts.consoleIssues;
  if (ci && Array.isArray(ci.items)) {
    const { isNoisyConsoleMessage } = require('./go-live-audit-page-issues.cjs');
    let consoleWarns = 0;
    for (const it of ci.items.slice(0, 15)) {
      if (it.severity !== 'error') continue;
      const msg = String(it.message || '');
      if (isNoisyConsoleMessage(msg)) continue;
      consoleWarns += 1;
      if (consoleWarns > 6) break;
      add({
        id: 'console_error',
        kind: 'console',
        severity: 'warn',
        message: 'Console: ' + msg.slice(0, 200),
      });
    }
  }

  const fp = fingerprintPage(html, opts.finalUrl);
  let baselineDrift = null;
  const baseline = opts.baseline;
  if (baseline && baseline.hash && baseline.hash !== fp.hash) {
    baselineDrift = {
      changed: true,
      previousTitle: baseline.title || '—',
      currentTitle: fp.title || '—',
      message: 'Page fingerprint changed since last clean scan (possible defacement or major deploy)',
    };
    add({
      id: 'baseline_drift',
      kind: 'integrity',
      severity: 'warn',
      message: baselineDrift.message,
    });
  }

  const criticalCount = threats.filter((t) => t.severity === 'critical').length;
  const warnCount = threats.filter((t) => t.severity === 'warn').length;
  const compromised = threats.some((t) => t.id === 'site_compromised' || t.kind === 'compromise');
  let alertLevel = 'ok';
  if (criticalCount > 0) alertLevel = 'critical';
  else if (warnCount > 0) alertLevel = 'warn';

  let headline = 'No known threat signatures';
  if (compromised) {
    headline = 'Possible HACK / compromise — site may be defaced or running a crypto scam';
  } else if (criticalCount > 0) {
    headline = criticalCount + ' critical threat(s) detected';
  } else if (warnCount > 0) {
    headline = warnCount + ' security warning(s)';
  }

  return {
    alertLevel,
    criticalCount,
    warnCount,
    total: threats.length,
    threats,
    fingerprint: fp,
    baselineDrift,
    compromised,
    shouldAlert:
      criticalCount > 0 ||
      compromised ||
      (warnCount >= 2 && baselineDrift && baselineDrift.changed),
    headline,
  };
}

module.exports = {
  detectSecurityThreats,
  detectCompromiseProfile,
  fingerprintPage,
  brandTitleMismatch,
  hostnameCryptoTitleMismatch,
  RULES,
};
