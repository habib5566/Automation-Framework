'use strict';

const dns = require('dns').promises;
const http = require('http');
const https = require('https');
const { URL } = require('url');

const PROBE_TIMEOUT_MS = 8_000;

const CATEGORY_LABELS = {
  information_gathering: 'Information gathering',
  vulnerability_scanning: 'Vulnerability scanning',
  web_application: 'Common web application attacks',
  sql_injection: 'SQL injection attacks (detection)',
  client_side: 'Client-side attacks',
  password_security: 'Password attacks & login security',
  antivirus_evasion: 'Antivirus evasion indicators',
  exposure: 'Sensitive file & path exposure',
};

const SENSITIVE_PATHS = [
  { path: '/.env', id: 'path_env', severity: 'critical', title: '/.env file exposed with secret content', verify: /APP_KEY=|DB_PASSWORD=|AWS_SECRET|DATABASE_URL=/i },
  { path: '/.git/HEAD', id: 'path_git', severity: 'critical', title: '/.git repository exposed', verify: /ref:\s*refs\/heads\//i },
  { path: '/wp-config.php.bak', id: 'path_wp_bak', severity: 'high', title: 'WordPress backup config exposed', verify: /DB_NAME|table_prefix/i },
  { path: '/phpinfo.php', id: 'path_phpinfo', severity: 'high', title: 'phpinfo() page exposed', verify: /phpinfo\(\)|PHP Version/i },
  { path: '/backup.zip', id: 'path_backup_zip', severity: 'high', title: 'Backup archive may be downloadable', verify: null, contentTypes: ['application/zip', 'application/octet-stream'] },
  { path: '/server-status', id: 'path_server_status', severity: 'medium', title: 'Server status page exposed', verify: /Apache Server Status|server status/i },
];

/** Login paths — informational only when reachable (normal for most sites). */
const LOGIN_PATHS = [
  { path: '/wp-login.php', id: 'path_wp_login', title: 'WordPress login endpoint reachable' },
  { path: '/login', id: 'path_login', title: 'Login endpoint reachable' },
  { path: '/admin/login', id: 'path_admin_login', title: 'Admin login endpoint reachable' },
];

const SQL_ERROR_RES =
  /SQL syntax.*MySQL|ORA-\d{5}|PostgreSQL.*ERROR|sqlite3\.OperationalError|Microsoft OLE DB Provider for SQL Server|Unclosed quotation mark after the character string|SQLSTATE\[\d+\]|mysqli_sql_exception|pg_query\(\): Query failed|Warning.*mysql_|SQLServer JDBC Driver|com\.mysql\.jdbc|Syntax error.*in query|Fatal error.*SQL|SQLite3::query\(\)/i;

const REMEDIATION = {
  missing_hsts: 'Enable HTTP Strict Transport Security (HSTS) on HTTPS responses.',
  missing_csp: 'Add a Content-Security-Policy header to reduce XSS and injection impact.',
  missing_xfo: 'Set X-Frame-Options or frame-ancestors in CSP to prevent clickjacking.',
  missing_xcto: 'Set X-Content-Type-Options: nosniff to reduce MIME-sniffing attacks.',
  cookie_insecure: 'Set Secure and HttpOnly flags on session cookies; use SameSite=Lax or Strict.',
  mixed_content: 'Load all assets over HTTPS or use relative/protocol-relative URLs.',
  inline_handlers: 'Remove inline on* event handlers; use external JS with CSP nonces/hashes.',
  javascript_url: 'Avoid javascript: URLs in links and forms — use proper event handlers.',
  login_http: 'Serve login pages only over HTTPS; redirect HTTP to HTTPS.',
  sql_error_exposed: 'Fix the underlying bug and show generic error pages — never expose DB errors.',
  path_exposed: 'Block public access to sensitive paths via web server config or remove files.',
  dns_no_spf: 'Add SPF (and DMARC) DNS records to reduce email spoofing risk.',
  referrer_policy_missing: 'Add header Referrer-Policy: strict-origin-when-cross-origin (nginx, Apache, or CDN).',
  permissions_policy_missing: 'Add Permissions-Policy to restrict camera, microphone, geolocation, etc.',
  server_banner: 'Hide version in Server header (e.g. nginx server_tokens off; generic Server name).',
  powered_by_banner: 'Remove X-Powered-By header in nginx/Apache or your framework config.',
  open_redirect: 'Validate redirect targets server-side; use allowlists for external URLs.',
  csrf_missing: 'Add CSRF tokens to state-changing forms and validate on the server.',
  autocomplete_password: 'Use autocomplete="new-password" or appropriate values; enforce HTTPS.',
  sqli_parameterize: 'Use prepared statements / ORM parameter binding — never concatenate user input into SQL.',
  password_minlength: 'Enforce minimum password length (12+) and complexity on registration and reset flows.',
  password_rate_limit: 'Add login rate limiting, CAPTCHA after failures, and account lockout — brute-force was NOT tested.',
  av_evasion_malware: 'Remove obfuscated scripts; investigate for malware injection or compromised CMS/theme.',
  basic_auth_exposed: 'Avoid Basic Auth over public internet; use HTTPS + app-level auth with MFA.',
};

let insecureAgent;
function getInsecureAgent() {
  if (!insecureAgent) insecureAgent = new https.Agent({ rejectUnauthorized: false });
  return insecureAgent;
}

function isBlockedHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  return (
    h === 'localhost' ||
    h.endsWith('.local') ||
    h.startsWith('127.') ||
    h === '::1' ||
    h.startsWith('10.') ||
    h.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

function parseHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function normalizeHeader(headers, name) {
  if (!headers) return '';
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? String(headers[key] || '').trim() : '';
}

function addFinding(findings, seen, row) {
  const key = (row.id || '') + '|' + (row.title || '');
  if (seen.has(key)) return;
  seen.add(key);
  findings.push({
    id: row.id,
    category: row.category,
    severity: row.severity,
    confidence: row.confidence || 'heuristic',
    title: row.title,
    detail: row.detail || '',
    remediation: row.remediation || REMEDIATION[row.id] || 'Review with your security team and apply vendor best practices.',
    source: row.source || 'attack-surface-scan',
  });
}

function analyzeSecurityHeaders(headers, finalUrl) {
  const findings = [];
  const seen = new Set();
  let isHttps = false;
  try {
    isHttps = new URL(finalUrl).protocol === 'https:';
  } catch {
    isHttps = false;
  }

  const hsts = normalizeHeader(headers, 'strict-transport-security');
  const csp = normalizeHeader(headers, 'content-security-policy');
  const xfo = normalizeHeader(headers, 'x-frame-options');
  const xcto = normalizeHeader(headers, 'x-content-type-options');
  const referrer = normalizeHeader(headers, 'referrer-policy');
  const permissions = normalizeHeader(headers, 'permissions-policy');

  if (isHttps && !hsts) {
    addFinding(findings, seen, {
      id: 'missing_hsts',
      category: 'vulnerability_scanning',
      severity: 'medium',
      confidence: 'confirmed',
      title: 'HSTS header missing on HTTPS site',
      detail: 'Browsers can be tricked into downgrade attacks without Strict-Transport-Security.',
      remediation: REMEDIATION.missing_hsts,
    });
  }
  if (!csp) {
    addFinding(findings, seen, {
      id: 'missing_csp',
      category: 'vulnerability_scanning',
      severity: 'medium',
      title: 'Content-Security-Policy (CSP) header missing',
      detail: 'No CSP detected — XSS and injected script impact is higher.',
      remediation: REMEDIATION.missing_csp,
    });
  }
  if (!xfo && (!csp || !/frame-ancestors/i.test(csp))) {
    addFinding(findings, seen, {
      id: 'missing_xfo',
      category: 'web_application',
      severity: 'medium',
      title: 'Clickjacking protection missing (X-Frame-Options / frame-ancestors)',
      detail: 'Page may be embeddable in malicious iframes.',
      remediation: REMEDIATION.missing_xfo,
    });
  }
  if (!xcto) {
    addFinding(findings, seen, {
      id: 'missing_xcto',
      category: 'vulnerability_scanning',
      severity: 'low',
      title: 'X-Content-Type-Options: nosniff missing',
      remediation: REMEDIATION.missing_xcto,
    });
  }
  if (!referrer) {
    addFinding(findings, seen, {
      id: 'referrer_policy_missing',
      category: 'information_gathering',
      severity: 'info',
      confidence: 'confirmed',
      title: 'Referrer-Policy header not set',
      detail: 'Informational — Referer URLs may leak to third-party sites when users follow external links.',
      remediation: REMEDIATION.referrer_policy_missing,
    });
  }
  if (!permissions) {
    addFinding(findings, seen, {
      id: 'permissions_policy_missing',
      category: 'information_gathering',
      severity: 'info',
      confidence: 'confirmed',
      title: 'Permissions-Policy header not set',
      detail: 'Informational — browser features (camera, mic, geolocation) are not restricted by policy.',
      remediation: REMEDIATION.permissions_policy_missing,
    });
  }

  const server = normalizeHeader(headers, 'server');
  const powered = normalizeHeader(headers, 'x-powered-by');
  if (server) {
    addFinding(findings, seen, {
      id: 'server_banner',
      category: 'information_gathering',
      severity: 'info',
      confidence: 'confirmed',
      title: 'Server banner disclosed: ' + server.slice(0, 80),
      detail: 'Informational — version in Server header can help attackers target known CVEs.',
      remediation: REMEDIATION.server_banner,
    });
  }
  if (powered) {
    addFinding(findings, seen, {
      id: 'powered_by_banner',
      category: 'information_gathering',
      severity: 'low',
      confidence: 'confirmed',
      title: 'X-Powered-By disclosed: ' + powered.slice(0, 80),
      detail: 'Framework/version visible in response headers.',
      remediation: REMEDIATION.powered_by_banner,
    });
  }

  return findings;
}

function analyzeCookies(headers) {
  const findings = [];
  const seen = new Set();
  const raw = headers['set-cookie'] || headers['Set-Cookie'];
  const cookies = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  for (const c of cookies.slice(0, 12)) {
    const line = String(c);
    const name = (line.split('=')[0] || 'cookie').trim();
    const lower = line.toLowerCase();
    const sessionLike = /session|auth|token|sid|jwt|laravel/i.test(name);
    if (!sessionLike) continue;
    if (!/;\s*secure/i.test(lower)) {
      addFinding(findings, seen, {
        id: 'cookie_insecure',
        category: 'web_application',
        severity: 'high',
        title: 'Session cookie missing Secure flag: ' + name,
        detail: 'Cookie may be sent over HTTP — session hijacking risk.',
        remediation: REMEDIATION.cookie_insecure,
      });
    }
    if (!/;\s*httponly/i.test(lower)) {
      addFinding(findings, seen, {
        id: 'cookie_no_httponly_' + name.slice(0, 20),
        category: 'client_side',
        severity: 'medium',
        title: 'Session cookie missing HttpOnly: ' + name,
        detail: 'JavaScript can read this cookie — XSS can steal sessions.',
        remediation: REMEDIATION.cookie_insecure,
      });
    }
    if (!/;\s*samesite=/i.test(lower)) {
      addFinding(findings, seen, {
        id: 'cookie_no_samesite_' + name.slice(0, 20),
        category: 'web_application',
        severity: 'low',
        title: 'Session cookie missing SameSite: ' + name,
        detail: 'CSRF risk may be higher without SameSite.',
      });
    }
  }
  return findings;
}

function analyzeHtmlAttacks(html, finalUrl) {
  const findings = [];
  const seen = new Set();
  const body = String(html || '');
  if (!body) return findings;

  let isHttps = false;
  try {
    isHttps = new URL(finalUrl).protocol === 'https:';
  } catch {
    isHttps = false;
  }

  if (isHttps && /(?:src|href)\s*=\s*["']http:\/\/[^"']+["']/i.test(body)) {
    addFinding(findings, seen, {
      id: 'mixed_content',
      category: 'client_side',
      severity: 'medium',
      title: 'Mixed content — HTTP resources on HTTPS page',
      detail: 'Browsers may block or weaken security for HTTP sub-resources.',
      remediation: REMEDIATION.mixed_content,
    });
  }

  if (/\s(onclick|onerror|onload|onmouseover)\s*=\s*["'][^"']+["']/i.test(body)) {
    addFinding(findings, seen, {
      id: 'inline_handlers',
      category: 'client_side',
      severity: 'medium',
      title: 'Inline JavaScript event handlers in HTML',
      detail: 'Inline handlers are XSS-friendly and blocked by strict CSP.',
      remediation: REMEDIATION.inline_handlers,
    });
  }

  if (/(?:href|src|action)\s*=\s*["']javascript:/i.test(body)) {
    addFinding(findings, seen, {
      id: 'javascript_url',
      category: 'client_side',
      severity: 'high',
      title: 'javascript: URL in page markup',
      remediation: REMEDIATION.javascript_url,
    });
  }

  if (SQL_ERROR_RES.test(body)) {
    addFinding(findings, seen, {
      id: 'sql_error_exposed',
      category: 'sql_injection',
      severity: 'high',
      confidence: 'confirmed',
      title: 'SQL / database error visible in page output',
      detail: 'Database error string found in HTML — common SQL injection indicator.',
      remediation: REMEDIATION.sql_error_exposed,
    });
  }

  const unionInScript = body.match(/<script[\s\S]{0,8000}?UNION\s+ALL\s+SELECT[\s\S]{0,8000}?<\/script>/i);
  if (unionInScript) {
    addFinding(findings, seen, {
      id: 'sqli_union_in_script',
      category: 'sql_injection',
      severity: 'high',
      confidence: 'confirmed',
      title: 'UNION SELECT SQL injection payload in script block',
      remediation: REMEDIATION.sqli_parameterize,
    });
  }

  if (
    /<form[^>]+method\s*=\s*["']post["'][^>]*action\s*=\s*["'][^"']*["'][^>]*>/i.test(body) &&
    !/csrf|_token|authenticity_token|__RequestVerificationToken/i.test(body) &&
    !/<meta[^>]+name\s*=\s*["']csrf-token["']/i.test(body)
  ) {
    addFinding(findings, seen, {
      id: 'csrf_missing',
      category: 'web_application',
      severity: 'info',
      confidence: 'heuristic',
      title: 'POST form without visible CSRF token (heuristic)',
      detail: 'Many frameworks use headers or meta tags — verify server-side CSRF protection manually.',
      remediation: REMEDIATION.csrf_missing,
    });
  }

  if (/location\.(?:href|replace)\s*=\s*[^;]+(?:search|query|param)/i.test(body)) {
    addFinding(findings, seen, {
      id: 'open_redirect',
      category: 'web_application',
      severity: 'medium',
      title: 'Possible open redirect via JavaScript URL parameter',
      detail: 'Validate all redirect targets server-side.',
      remediation: REMEDIATION.open_redirect,
    });
  }

  return findings;
}

function analyzePasswordSecurity(html, finalUrl, headers) {
  const findings = [];
  const seen = new Set();
  const body = String(html || '');
  if (!body) return findings;

  let isHttps = false;
  try {
    isHttps = new URL(finalUrl).protocol === 'https:';
  } catch {
    isHttps = false;
  }

  const passwordInputs = body.match(/<input[^>]+type\s*=\s*["']password["'][^>]*>/gi) || [];
  const hasLoginForm = /<form[^>]*(?:login|sign[\s-]?in|wp-login|auth)/i.test(body) || passwordInputs.length > 0;

  if (!isHttps && passwordInputs.length > 0) {
    addFinding(findings, seen, {
      id: 'login_http',
      category: 'password_security',
      severity: 'critical',
      title: 'Password form served over HTTP (not HTTPS)',
      remediation: REMEDIATION.login_http,
    });
  }

  if (hasLoginForm && passwordInputs.length) {
    let missingMin = 0;
    for (const inp of passwordInputs) {
      if (!/minlength\s*=\s*["']\d+["']/i.test(inp)) missingMin += 1;
    }
    if (missingMin > 0 && /<form[^>]*(?:register|signup|sign-up|create-account)/i.test(body)) {
      addFinding(findings, seen, {
        id: 'password_no_minlength',
        category: 'password_security',
        severity: 'low',
        confidence: 'heuristic',
        title: 'Registration form password field without minlength in HTML',
        detail: 'Server-side rules may still apply — verify password policy on the API.',
        remediation: REMEDIATION.password_minlength,
      });
    }
    addFinding(findings, seen, {
      id: 'password_login_surface',
      category: 'password_security',
      severity: 'info',
      confidence: 'confirmed',
      title: 'Login / password form present on scanned page',
      detail: 'Password brute-force was NOT run. Ensure rate limiting, lockout, MFA, and strong password policy.',
      remediation: REMEDIATION.password_rate_limit,
    });
  }

  if (/<input[^>]+type\s*=\s*["']password["'][^>]+autocomplete\s*=\s*["']off["']/i.test(body)) {
    addFinding(findings, seen, {
      id: 'autocomplete_password',
      category: 'password_security',
      severity: 'info',
      title: 'Password field with autocomplete disabled (review UX/security policy)',
    });
  }

  const wwwAuth = normalizeHeader(headers, 'www-authenticate');
  if (wwwAuth) {
    const overHttp = !isHttps;
    addFinding(findings, seen, {
      id: 'basic_auth_banner',
      category: 'password_security',
      severity: overHttp ? 'critical' : 'medium',
      title: 'HTTP Basic Authentication challenge detected' + (overHttp ? ' over HTTP' : ''),
      detail: 'Credentials sent with each request — vulnerable to sniffing and brute-force if not rate-limited.',
      remediation: REMEDIATION.basic_auth_exposed,
    });
  }

  if (/type\s*=\s*["']password["'][^>]+value\s*=\s*["'][^"']+["']/i.test(body)) {
    addFinding(findings, seen, {
      id: 'password_prefilled',
      category: 'password_security',
      severity: 'high',
      title: 'Password field has pre-filled value in HTML',
      detail: 'May expose credentials in source or logs.',
      remediation: 'Never embed password values in HTML.',
    });
  }

  return findings;
}

function analyzeAntivirusEvasion(html) {
  const findings = [];
  const seen = new Set();
  const body = String(html || '');
  if (!body || body.length < 20) return findings;

  const patterns = [
    {
      re: /eval\s*\(\s*atob\s*\(/i,
      id: 'av_evasion_eval_atob',
      severity: 'critical',
      title: 'AV evasion: eval(atob(...)) obfuscated payload',
    },
    {
      re: /eval\s*\(\s*(?:unescape|decodeURIComponent)\s*\(/i,
      id: 'av_evasion_eval_decode',
      severity: 'critical',
      title: 'AV evasion: eval + decode obfuscation',
    },
    {
      re: /String\.fromCharCode\s*\(\s*\d+\s*,\s*\d+\s*,\s*\d+/i,
      id: 'av_evasion_charcode',
      severity: 'high',
      title: 'AV evasion: String.fromCharCode obfuscated script',
    },
    {
      re: /document\.write\s*\(\s*unescape\s*\(/i,
      id: 'av_evasion_doc_write',
      severity: 'high',
      title: 'AV evasion: document.write(unescape(...)) pattern',
    },
    {
      re: /\\x[0-9a-f]{2}(?:\\x[0-9a-f]{2}){6,}/i,
      id: 'av_evasion_hex_strings',
      severity: 'medium',
      title: 'AV evasion: hex-encoded strings in script',
    },
    {
      re: /\$_0x[a-f0-9]{4,}|_\x24\w{2,}\s*\[/i,
      id: 'av_evasion_js_packer',
      severity: 'high',
      title: 'AV evasion: JavaScript packer / obfuscator variables',
    },
    {
      re: /powershell\s+-(?:enc|encodedcommand|e)\s+/i,
      id: 'av_evasion_powershell',
      severity: 'critical',
      title: 'AV evasion: PowerShell encoded command in page',
    },
    {
      re: /ActiveXObject\s*\(\s*['"]WScript/i,
      id: 'av_evasion_activex',
      severity: 'critical',
      title: 'AV evasion: WScript/ActiveX dropper pattern',
    },
    {
      re: /new\s+Function\s*\(\s*['"]return\s+eval/i,
      id: 'av_evasion_function_constructor',
      severity: 'high',
      title: 'AV evasion: Function constructor + eval chain',
    },
    {
      re: /<iframe[^>]+src\s*=\s*["']https?:\/\/[^"']+["'][^>]+style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0|width\s*:\s*0)/i,
      id: 'av_evasion_hidden_iframe',
      severity: 'high',
      title: 'Hidden iframe loading external URL (malware / injection loader)',
    },
    {
      re: /(?:fetch|XMLHttpRequest)\s*\([^)]*\)\s*\.then\s*\([^)]*eval/i,
      id: 'av_evasion_remote_eval',
      severity: 'critical',
      title: 'AV evasion: remote script fetch then eval',
    },
  ];

  for (const p of patterns) {
    if (p.re.test(body)) {
      addFinding(findings, seen, {
        id: p.id,
        category: 'antivirus_evasion',
        severity: p.severity,
        confidence: 'confirmed',
        title: p.title,
        detail: 'Pattern commonly used to bypass antivirus — investigate for hacked scripts or injected malware.',
        remediation: REMEDIATION.av_evasion_malware,
      });
    }
  }

  return findings;
}

function getRequest(urlStr) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(urlStr);
    } catch {
      return resolve({ ok: false, body: '', statusCode: null, contentType: '' });
    }
    if (isBlockedHost(u.hostname)) return resolve({ ok: false, body: '', statusCode: null, contentType: '' });
    const lib = u.protocol === 'https:' ? https : http;
    const opts = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'GET',
      headers: { 'User-Agent': 'GoLiveAudit/1.0 (safe security check)', Accept: 'text/html,*/*' },
      timeout: PROBE_TIMEOUT_MS,
    };
    if (u.protocol === 'https:' && process.env.GO_LIVE_AUDIT_TLS_INSECURE === '1') {
      opts.agent = getInsecureAgent();
    }
    const req = lib.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => {
        chunks.push(c);
        if (chunks.reduce((n, b) => n + b.length, 0) > 120_000) res.destroy();
      });
      res.on('end', () => {
        const ct = String(res.headers['content-type'] || '').split(';')[0].trim();
        resolve({
          ok: true,
          statusCode: res.statusCode,
          contentType: ct,
          body: Buffer.concat(chunks).toString('utf8').slice(0, 120_000),
        });
      });
    });
    req.on('error', () => resolve({ ok: false, body: '', statusCode: null, contentType: '' }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, body: '', statusCode: null, contentType: '' });
    });
    req.end();
  });
}

function isProbeReflected(body, probeValue) {
  if (!body || !probeValue) return false;
  if (!body.includes(probeValue)) return false;
  return probeValue.includes("'") || /(?:\sOR\s|\sAND\s)/i.test(probeValue);
}

async function probeSqlInjectionSafe(finalUrl) {
  const findings = [];
  const seen = new Set();
  let base;
  try {
    base = new URL(finalUrl);
  } catch {
    return findings;
  }
  if (isBlockedHost(base.hostname)) return findings;

  const probes = [
    { value: "1'", id: 'sqli_quote_probe', label: "quote (')" },
    { value: "1' OR '1'='1", id: 'sqli_tautology_probe', label: "tautology OR '1'='1" },
    { value: '1 AND 1=1', id: 'sqli_and_probe', label: 'AND 1=1' },
  ];

  for (const p of probes) {
    const u = new URL(base.href);
    u.searchParams.set('go_live_audit_sqli', p.value);
    const res = await getRequest(u.href);
    if (!res.ok || !res.body) continue;

    if (SQL_ERROR_RES.test(res.body)) {
      addFinding(findings, seen, {
        id: p.id + '_error',
        category: 'sql_injection',
        severity: 'critical',
        confidence: 'confirmed',
        title: 'SQL injection likely — database error after safe probe (' + p.label + ')',
        detail: 'Non-destructive GET probe triggered a SQL error. Site may be vulnerable to SQL injection.',
        remediation: REMEDIATION.sqli_parameterize,
      });
      break;
    }

    if (isProbeReflected(res.body, p.value)) {
      addFinding(findings, seen, {
        id: p.id + '_reflect',
        category: 'sql_injection',
        severity: 'high',
        confidence: 'heuristic',
        title: 'Input reflection after SQL probe — review for injection/XSS',
        detail: 'Parameter go_live_audit_sqli reflected in output (' + p.label + ').',
        remediation: REMEDIATION.sqli_parameterize,
      });
    }
  }

  return findings;
}

function headRequest(urlStr) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(urlStr);
    } catch {
      return resolve({ ok: false, statusCode: null });
    }
    if (isBlockedHost(u.hostname)) return resolve({ ok: false, statusCode: null });
    const lib = u.protocol === 'https:' ? https : http;
    const opts = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'HEAD',
      headers: { 'User-Agent': 'GoLiveAudit/1.0 (passive security check)' },
      timeout: PROBE_TIMEOUT_MS,
    };
    if (u.protocol === 'https:' && process.env.GO_LIVE_AUDIT_TLS_INSECURE === '1') {
      opts.agent = getInsecureAgent();
    }
    const req = lib.request(opts, (res) => {
      res.resume();
      resolve({ ok: true, statusCode: res.statusCode });
    });
    req.on('error', () => resolve({ ok: false, statusCode: null }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, statusCode: null });
    });
    req.end();
  });
}

async function probeSensitivePaths(finalUrl) {
  const findings = [];
  const seen = new Set();
  let base;
  try {
    base = new URL(finalUrl);
  } catch {
    return findings;
  }
  if (isBlockedHost(base.hostname)) return findings;

  for (const item of SENSITIVE_PATHS) {
    const target = new URL(item.path, base).href;
    const head = await headRequest(target);
    if (!head.ok || head.statusCode !== 200) continue;

    const getRes = await getRequest(target);
    if (!getRes.ok || !getRes.body) continue;

    if (item.verify && item.verify.test(getRes.body)) {
      addFinding(findings, seen, {
        id: item.id,
        category: 'exposure',
        severity: item.severity,
        confidence: 'confirmed',
        title: item.title + ' (verified content)',
        detail: 'GET response body matches sensitive file signature for ' + item.path,
        remediation: REMEDIATION.path_exposed,
      });
      continue;
    }

    if (item.contentTypes && getRes.contentType) {
      const ct = String(getRes.contentType).toLowerCase();
      if (item.contentTypes.some((t) => ct.includes(t))) {
        addFinding(findings, seen, {
          id: item.id,
          category: 'exposure',
          severity: item.severity,
          confidence: 'confirmed',
          title: item.title + ' (binary content-type)',
          detail: 'Path returned downloadable content-type: ' + ct,
          remediation: REMEDIATION.path_exposed,
        });
      }
    }
  }

  for (const item of LOGIN_PATHS) {
    const target = new URL(item.path, base).href;
    const head = await headRequest(target);
    if (!head.ok || head.statusCode == null) continue;
    if (head.statusCode >= 200 && head.statusCode < 400) {
      addFinding(findings, seen, {
        id: item.id,
        category: 'password_security',
        severity: 'info',
        confidence: 'confirmed',
        title: item.title + ' (HTTP ' + head.statusCode + ')',
        detail: 'Normal for many sites — ensure rate limiting, MFA, and lockout against password attacks.',
        remediation: REMEDIATION.password_rate_limit,
      });
    }
  }

  return findings;
}

async function gatherDnsInfo(hostname) {
  const findings = [];
  const seen = new Set();
  if (!hostname || isBlockedHost(hostname)) return { findings, records: {} };

  const apex = hostname.replace(/^www\./i, '');
  const hostsToCheck = hostname === apex ? [hostname] : [hostname, apex];

  const records = { a: [], mx: [], txt: [] };
  try {
    records.a = await dns.resolve4(hostname);
  } catch {
    records.a = [];
  }
  try {
    records.mx = await dns.resolveMx(hostname);
  } catch {
    try {
      records.mx = await dns.resolveMx(apex);
    } catch {
      records.mx = [];
    }
  }

  let flatTxt = '';
  for (const h of hostsToCheck) {
    try {
      const txt = await dns.resolveTxt(h);
      flatTxt += ' ' + txt.map((r) => r.join('')).join(' ');
    } catch {
      /* try next */
    }
  }

  if (records.a.length) {
    addFinding(findings, seen, {
      id: 'dns_a_records',
      category: 'information_gathering',
      severity: 'info',
      confidence: 'confirmed',
      title: 'DNS A records: ' + records.a.slice(0, 4).join(', '),
      detail: 'Verified via DNS lookup.',
    });
  }
  if (records.mx.length) {
    addFinding(findings, seen, {
      id: 'dns_mx_records',
      category: 'information_gathering',
      severity: 'info',
      confidence: 'confirmed',
      title: 'Mail (MX) records configured',
      detail: records.mx
        .slice(0, 3)
        .map((m) => m.exchange + ' (prio ' + m.priority + ')')
        .join('; '),
    });
  }
  if (flatTxt.trim() && !/v=spf1/i.test(flatTxt)) {
    addFinding(findings, seen, {
      id: 'dns_no_spf',
      category: 'information_gathering',
      severity: 'low',
      confidence: 'heuristic',
      title: 'No SPF TXT record found for this host/apex',
      remediation: REMEDIATION.dns_no_spf,
    });
  }

  return { findings, records: { a: records.a, mx: records.mx, txt: flatTxt.trim() } };
}

function groupByCategory(findings) {
  const categories = [];
  const byId = {};
  for (const [id, label] of Object.entries(CATEGORY_LABELS)) {
    byId[id] = { id, label, findings: [] };
  }
  for (const f of findings) {
    const cat = byId[f.category] || byId.information_gathering;
    cat.findings.push(f);
  }
  for (const cat of Object.values(byId)) {
    if (cat.findings.length) categories.push(cat);
  }
  return categories;
}

function computeScore(findings) {
  let score = 100;
  for (const f of findings) {
    if (f.severity === 'critical') score -= 25;
    else if (f.severity === 'high') score -= 12;
    else if (f.severity === 'medium') score -= 6;
    else if (f.severity === 'low') score -= 2;
  }
  return Math.max(0, Math.min(100, score));
}

/**
 * Passive security / attack-surface audit (detection only — no exploitation).
 */
async function buildAttackSurfaceReport(opts) {
  const finalUrl = opts && opts.finalUrl ? opts.finalUrl : '';
  const headers = (opts && opts.headers) || {};
  const html = (opts && opts.html) || '';
  const hostname = parseHostname(finalUrl);

  const headerFindings = analyzeSecurityHeaders(headers, finalUrl);
  const cookieFindings = analyzeCookies(headers);
  const htmlFindings = analyzeHtmlAttacks(html, finalUrl);
  const passwordFindings = analyzePasswordSecurity(html, finalUrl, headers);
  const avEvasionFindings = analyzeAntivirusEvasion(html);
  const sqliProbeFindings = await probeSqlInjectionSafe(finalUrl);
  const pathFindings = await probeSensitivePaths(finalUrl);
  const dnsResult = await gatherDnsInfo(hostname);

  const findings = headerFindings
    .concat(cookieFindings, htmlFindings, passwordFindings, avEvasionFindings, sqliProbeFindings, pathFindings, dnsResult.findings);
  const categories = groupByCategory(findings);
  const critical = findings.filter((f) => f.severity === 'critical').length;
  const high = findings.filter((f) => f.severity === 'high').length;
  const medium = findings.filter((f) => f.severity === 'medium').length;
  const score = computeScore(findings.filter((f) => f.severity !== 'info'));
  const confirmedCritical = findings.filter((f) => f.severity === 'critical' && f.confidence === 'confirmed').length;
  const confirmedHigh = findings.filter((f) => f.severity === 'high' && f.confidence === 'confirmed').length;
  const shouldAlert = confirmedCritical > 0 || confirmedHigh >= 2;

  let headline = 'Attack-surface checks passed — no critical issues in this passive scan';
  let panelTone = 'good';
  if (critical > 0) {
    headline = critical + ' critical attack-surface issue(s) — review before go-live';
    panelTone = 'bad';
  } else if (high > 0) {
    headline = high + ' high-risk finding(s) — web attack / exposure indicators detected';
    panelTone = 'warn';
  } else if (medium > 0) {
    headline = medium + ' medium finding(s) — harden headers and client-side security';
    panelTone = 'warn';
  }

  return {
    ok: true,
    hostname,
    headline,
    panelTone,
    score,
    summary: { critical, high, medium, low: findings.filter((f) => f.severity === 'low').length, info: findings.filter((f) => f.severity === 'info').length, total: findings.length },
    categories,
    findings,
    dns: dnsResult.records,
    shouldAlert,
    scannedAt: new Date().toISOString(),
    scopeNote:
      'Genuine checks only: confirmed = verified signal (DNS, file content, DB error, malware pattern). Heuristic = review manually. No brute-force. SQL probes are read-only GET tests.',
  };
}

module.exports = {
  buildAttackSurfaceReport,
  CATEGORY_LABELS,
  analyzeSecurityHeaders,
  analyzeHtmlAttacks,
  analyzePasswordSecurity,
  analyzeAntivirusEvasion,
  probeSqlInjectionSafe,
  probeSensitivePaths,
};
