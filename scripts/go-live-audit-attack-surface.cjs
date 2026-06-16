'use strict';

const dns = require('dns').promises;
const http = require('http');
const https = require('https');
const { URL } = require('url');

const PROBE_TIMEOUT_MS = 8_000;
const ATTACK_SURFACE_BUDGET_MS = 16_000;

function isServerlessRuntime() {
  return !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

function probeTimeoutMs() {
  return isServerlessRuntime() ? 4_000 : PROBE_TIMEOUT_MS;
}

function attackSurfaceBudgetMs() {
  return isServerlessRuntime() ? 7_000 : ATTACK_SURFACE_BUDGET_MS;
}

function withTimeoutValue(promise, ms, fallback) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, Math.max(250, Number(ms) || 0));
    Promise.resolve(promise)
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

const CATEGORY_LABELS = {
  information_gathering: 'Information gathering',
  vulnerability_scanning: 'Vulnerability scanning',
  web_application: 'Common web application attacks',
  sql_injection: 'SQL injection attacks (detection)',
  client_side: 'Client-side attacks',
  password_security: 'Password attacks & login security',
  antivirus_evasion: 'Antivirus evasion indicators',
  exposure: 'Sensitive file & path exposure',
  advanced_web_attacks: 'Advanced web attacks (OSWE / WEB-300 detection)',
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
  password_weak_minlength: 'Raise minimum password length to at least 12 characters on registration and password change.',
  password_no_complexity: 'Require mixed case, numbers, and symbols (or use a passphrase policy) server-side.',
  password_no_confirm: 'Add a confirm-password field on registration and validate both match server-side.',
  password_reset_http: 'Serve forgot-password and reset links only over HTTPS.',
  password_no_captcha: 'Add CAPTCHA or bot protection on login after repeated failures.',
  password_no_mfa: 'Offer MFA (TOTP, WebAuthn, or SMS backup) especially for admin and privileged accounts.',
  password_user_enum: 'Use generic login errors ("Invalid credentials") — do not reveal whether username or email exists.',
  password_login_get: 'Never submit passwords via GET — use POST over HTTPS only.',
  password_breached_advisory: 'Block top breached/common passwords (e.g. password, 123456) via server-side deny-list or HIBP-style check.',
  password_hash_weak: 'Store passwords with bcrypt, scrypt, or Argon2 — never MD5, SHA1, or unsalted SHA256.',
  password_no_rate_limit_headers: 'Return rate-limit headers or enforce throttling server-side on authentication endpoints.',
  pp_unsafe_merge: 'Reject __proto__/constructor/prototype keys in merges; use Object.create(null) or schema validation.',
  pp_merge_endpoint: 'Audit JSON merge endpoints — never recursively merge untrusted objects into prototypes.',
  ssrf_url_param: 'Validate and allow-list outbound fetch URLs; resolve host to IP and block private/loopback ranges.',
  sast_unsafe_sink: 'Remove dangerous sinks or bind user input with parameterization / safe APIs only.',
  persistent_xss_form: 'Sanitize and encode stored user content; deploy strict CSP on pages that render user HTML.',
  session_id_url: 'Never put session identifiers in URLs — use HttpOnly cookies only.',
  session_predictable: 'Generate session IDs with a CSPRNG (128+ bits); never sequential counters or md5(counter).',
  dotnet_deser: 'Disable TypeNameHandling / BinaryFormatter; use safe serializers and signed ViewState.',
  rce_cmdi_surface: 'Never pass user input to shell commands; use allow-listed arguments without a shell.',
  blind_sqli_oracle: 'Use parameterized queries; boolean/time oracles must not leak query truth via exists/timing.',
  data_exfil_webhook: 'Validate webhook/callback URLs server-side; block internal and metadata IP ranges.',
  file_upload_weak: 'Allow-list extensions and MIME types server-side; scan uploads; store outside web root.',
  av_evasion_malware: 'Remove obfuscated scripts; investigate for malware injection or compromised CMS/theme.',
  basic_auth_exposed: 'Avoid Basic Auth over public internet; use HTTPS + app-level auth with MFA.',
};

/** Top breached/common passwords (passlab training wordlists — advisory only, no cracking). */
const COMMON_BREACHED_PASSWORDS = [
  'password',
  'password123',
  '123456',
  'qwerty',
  'letmein',
  'admin',
  'welcome',
  'monkey',
  'dragon',
  'P@ssw0rd1',
];

const WEAK_HASH_PATTERNS = [
  {
    re: /(?:HASH_DRIVER|PASSWORD_HASH|BCRYPT_ROUNDS|AUTH_HASH)\s*=\s*(?:md5|sha1)\b/i,
    id: 'hash_weak_env_config',
    detail: 'Environment/config names a weak password hash algorithm.',
  },
  {
    re: /md5\s*\(\s*\$?(?:password|passwd|pass)\s*\)/i,
    id: 'hash_weak_md5_call',
    detail: 'Source or config references md5() for password hashing.',
  },
  {
    re: /sha1\s*\(\s*\$?(?:password|passwd|pass)\s*\)/i,
    id: 'hash_weak_sha1_call',
    detail: 'Source or config references sha1() for password hashing.',
  },
  {
    re: /password.*(?:md5|sha1)(?:_hash)?/i,
    id: 'hash_weak_named_field',
    detail: 'Password storage may use a legacy MD5/SHA1 scheme.',
  },
];

const CAPTCHA_RE =
  /g-recaptcha|recaptcha|hcaptcha|h-captcha|turnstile|cf-turnstile|data-sitekey\s*=\s*["']|class\s*=\s*["'][^"']*captcha/i;
const MFA_RE =
  /(?:2fa|two[\s-]?factor|mfa|totp|authenticator|one[\s-]?time(?:\s+password)?|verification[\s-]?code|otp[\s-]?code|security[\s-]?code)/i;
const COMPLEXITY_RE =
  /password[\s_-]?(?:strength|meter|policy|rules|requirements)|(?:uppercase|lowercase|special\s+character|symbol|number).{0,40}password|pattern\s*=\s*["'][^"']{8,}["']/i;
const USER_ENUM_RE =
  /(?:user(?:name)?|email|account)\s+(?:not\s+found|does\s+not\s+exist|is\s+not\s+registered|unknown)|no\s+account\s+(?:found|exists)|invalid\s+user(?:name)?(?!\s+or\s+password)/i;
const GENERIC_LOGIN_ERROR_RE =
  /invalid\s+(?:credentials|login|username\s+or\s+password)|incorrect\s+(?:username\s+or\s+password|credentials)|wrong\s+(?:username\s+or\s+password|credentials)/i;
const RESET_PATH_RE = /(?:href|action)\s*=\s*["']([^"']*(?:forgot|reset|recover|password)[^"']*)["']/gi;

function parseMinLengthFromInput(inputHtml) {
  const m = String(inputHtml || '').match(/minlength\s*=\s*["'](\d+)["']/i);
  return m ? parseInt(m[1], 10) : null;
}

function hasCaptchaInHtml(body) {
  return CAPTCHA_RE.test(body);
}

function hasMfaHintsInHtml(body) {
  return MFA_RE.test(body);
}

function hasPasswordComplexityHints(body) {
  return COMPLEXITY_RE.test(body);
}

function detectUserEnumerationHints(body) {
  if (GENERIC_LOGIN_ERROR_RE.test(body)) return false;
  return USER_ENUM_RE.test(body);
}

function analyzeWeakHashInText(text, category) {
  const findings = [];
  const seen = new Set();
  const sample = String(text || '').slice(0, 50_000);
  if (!sample) return findings;
  if (/\$2[aby]\$|argon2/i.test(sample)) return findings;
  for (const item of WEAK_HASH_PATTERNS) {
    if (!item.re.test(sample)) continue;
    addFinding(findings, seen, {
      id: item.id,
      category: category || 'password_security',
      severity: 'high',
      confidence: 'heuristic',
      title: 'Weak password hashing indicated in exposed content',
      detail: item.detail,
      remediation: REMEDIATION.password_hash_weak,
      source: 'passlab-hash-auditor',
    });
    break;
  }
  return findings;
}

function analyzeRateLimitHeaders(headers, hasAuthSurface) {
  const findings = [];
  const seen = new Set();
  if (!hasAuthSurface || !headers) return findings;

  const rateHeaders = [
    'x-ratelimit-limit',
    'x-ratelimit-remaining',
    'x-ratelimit-reset',
    'retry-after',
    'ratelimit-limit',
    'ratelimit-remaining',
  ];
  const hasRate = rateHeaders.some((h) => normalizeHeader(headers, h));
  if (!hasRate) {
    addFinding(findings, seen, {
      id: 'password_no_rate_limit_headers',
      category: 'password_security',
      severity: 'info',
      confidence: 'heuristic',
      title: 'No rate-limit response headers on authentication page',
      detail:
        'Absence of X-RateLimit-* or Retry-After does not prove missing throttling — verify server-side login rate limits and lockout.',
      remediation: REMEDIATION.password_no_rate_limit_headers,
      source: 'passlab-online-auditor',
    });
  }
  return findings;
}

function findHttpResetLinks(body) {
  const links = [];
  let m;
  const re = RESET_PATH_RE;
  re.lastIndex = 0;
  while ((m = re.exec(body)) !== null) {
    const raw = m[1] || '';
    if (/^https?:\/\//i.test(raw) && /^http:\/\//i.test(raw)) links.push(raw);
    else if (/^\/\//.test(raw)) links.push('http:' + raw);
  }
  return links;
}

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

/** OSWE / WEB-300 style passive detection from HTML, inline scripts, and headers (no exploitation). */
function analyzeAdvancedWebAttacks(html, finalUrl, headers) {
  const findings = [];
  const seen = new Set();
  const body = String(html || '');
  if (!body || body.length < 20) return findings;

  const scripts = [];
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let sm;
  while ((sm = scriptRe.exec(body)) !== null) {
    scripts.push(sm[1] || '');
  }
  const scriptBlob = scripts.join('\n').slice(0, 80_000);
  const haystack = body.slice(0, 120_000) + '\n' + scriptBlob;
  const csp = normalizeHeader(headers, 'content-security-policy');

  // 1. JavaScript Prototype Pollution
  if (/__proto__|constructor\s*\.\s*prototype|Object\.prototype/i.test(haystack)) {
    addFinding(findings, seen, {
      id: 'pp_proto_key_hint',
      category: 'advanced_web_attacks',
      severity: 'medium',
      confidence: 'heuristic',
      title: 'Prototype pollution indicators (__proto__ / constructor.prototype)',
      detail: 'Client or server code references prototype-walking keys — audit recursive JSON merge endpoints.',
      remediation: REMEDIATION.pp_unsafe_merge,
      source: 'weblab-prototype-pollution',
    });
  }
  if (/lodash\.(?:merge|defaultsDeep)|deepmerge|\.extend\s*\(\s*true|mergeDeep|assignDeep/i.test(haystack)) {
    addFinding(findings, seen, {
      id: 'pp_unsafe_merge_lib',
      category: 'advanced_web_attacks',
      severity: 'low',
      confidence: 'heuristic',
      title: 'Deep-merge utility detected (prototype pollution risk if fed untrusted JSON)',
      detail: 'Libraries like lodash.merge with untrusted input can pollute Object.prototype.',
      remediation: REMEDIATION.pp_unsafe_merge,
      source: 'weblab-prototype-pollution',
    });
  }
  if (/\/api\/[^"'\s]*merge|profile\/merge|mergeProfile|deepMerge/i.test(body)) {
    addFinding(findings, seen, {
      id: 'pp_merge_endpoint',
      category: 'advanced_web_attacks',
      severity: 'info',
      confidence: 'heuristic',
      title: 'JSON merge API endpoint referenced in page',
      detail: 'Verify merge handlers reject __proto__, constructor, and prototype keys.',
      remediation: REMEDIATION.pp_merge_endpoint,
      source: 'weblab-prototype-pollution',
    });
  }

  // 2. Advanced SSRF — sink discovery only (no outbound probe)
  if (
    /<(?:input|select|textarea)[^>]+name\s*=\s*["'](?:url|uri|link|proxy|fetch|target|redirect|webhook|callback|import)["']/i.test(
      body
    )
  ) {
    addFinding(findings, seen, {
      id: 'ssrf_url_input_field',
      category: 'advanced_web_attacks',
      severity: 'medium',
      confidence: 'heuristic',
      title: 'Server-side fetch URL input field detected',
      detail: 'Forms accepting URLs can become SSRF sinks — resolve host to IP and block loopback/private ranges.',
      remediation: REMEDIATION.ssrf_url_param,
      source: 'weblab-advanced-ssrf',
    });
  }
  if (/(?:\/proxy|\/fetch|\/import|\/webhook|\/preview)\?[^"'\s]*(?:url|uri|link)=/i.test(body)) {
    addFinding(findings, seen, {
      id: 'ssrf_sink_path_hint',
      category: 'advanced_web_attacks',
      severity: 'info',
      confidence: 'heuristic',
      title: 'URL-fetch endpoint pattern in page links/scripts',
      remediation: REMEDIATION.ssrf_url_param,
      source: 'weblab-advanced-ssrf',
    });
  }

  // 4. Source code analysis (inline SAST-lite on served HTML/JS)
  const sastRules = [
    {
      re: /\.innerHTML\s*=\s*[^;\n]+(?:location|document\.|window\.|search|hash|param)/i,
      id: 'sast_dom_innerhtml_sink',
      title: 'DOM XSS sink: innerHTML fed from URL/DOM input',
      severity: 'high',
    },
    {
      re: /document\.write\s*\([^)]*(?:location|search|hash|param|query)/i,
      id: 'sast_document_write_sink',
      title: 'DOM XSS sink: document.write with URL-derived input',
      severity: 'high',
    },
    {
      re: /eval\s*\([^)]*(?:location|document\.|window\.|req\.|params|query|search)/i,
      id: 'sast_eval_user_input',
      title: 'Remote code risk: eval() with user-controlled input',
      severity: 'critical',
    },
    {
      re: /pickle\.loads|unserialize\s*\(|BinaryFormatter|ObjectStateFormatter|TypeNameHandling\s*:\s*['"]?All/i,
      id: 'sast_unsafe_deserialize',
      title: 'Unsafe deserialization API referenced in page scripts',
      severity: 'critical',
    },
    {
      re: /child_process\.exec\s*\(|exec\s*\(\s*[^)]*\+|os\.system\s*\(|shell_exec\s*\(|passthru\s*\(/i,
      id: 'sast_command_exec_sink',
      title: 'Command execution sink pattern in client/server script',
      severity: 'high',
    },
    {
      re: /cursor\.execute\s*\(\s*f["']|\.execute\s*\(\s*["'][^"']*\$\{|query\s*\+\s*|f["']SELECT[^"']*\{/i,
      id: 'sast_sql_concat',
      title: 'SQL built by string concatenation/interpolation in script',
      severity: 'high',
    },
  ];
  for (const rule of sastRules) {
    if (!rule.re.test(haystack)) continue;
    addFinding(findings, seen, {
      id: rule.id,
      category: rule.id === 'sast_sql_concat' ? 'sql_injection' : 'advanced_web_attacks',
      severity: rule.severity,
      confidence: 'heuristic',
      title: rule.title,
      detail: 'Regex SAST on served HTML/inline scripts — verify with code review; may be false positive.',
      remediation: rule.id === 'sast_sql_concat' ? REMEDIATION.sqli_parameterize : REMEDIATION.sast_unsafe_sink,
      source: 'weblab-source-analysis',
    });
    break;
  }

  // 5. Persistent (stored) XSS surface
  if (
    /<form[^>]*(?:comment|feedback|review|message|post|thread)[^>]*>[\s\S]{0,3000}?<textarea/i.test(body) &&
    !csp
  ) {
    addFinding(findings, seen, {
      id: 'persistent_xss_stored_form',
      category: 'advanced_web_attacks',
      severity: 'medium',
      confidence: 'heuristic',
      title: 'User content form (comments/feedback) without CSP on page',
      detail: 'Stored XSS risk if submissions are rendered to other users without encoding.',
      remediation: REMEDIATION.persistent_xss_form,
      source: 'weblab-persistent-xss',
    });
  }
  if (/<(?:div|p|span)[^>]+(?:comment|feedback|review)[^>]*>[\s\S]{0,500}?<script/i.test(body)) {
    addFinding(findings, seen, {
      id: 'persistent_xss_rendered_markup',
      category: 'client_side',
      severity: 'high',
      confidence: 'heuristic',
      title: 'User-generated content area near script tags — review stored XSS',
      remediation: REMEDIATION.persistent_xss_form,
      source: 'weblab-persistent-xss',
    });
  }

  // 6. Session hijacking indicators
  if (/(?:href|src|action)\s*=\s*["'][^"']*(?:\?|&)(?:session|sid|PHPSESSID|jsessionid)=/i.test(body)) {
    addFinding(findings, seen, {
      id: 'session_id_in_url',
      category: 'advanced_web_attacks',
      severity: 'high',
      confidence: 'confirmed',
      title: 'Session identifier appears in URL (session fixation / hijack risk)',
      remediation: REMEDIATION.session_id_url,
      source: 'weblab-session-hijacking',
    });
  }
  if (/session_reference|predictable.*session|md5\s*\(\s*["']session:/i.test(haystack)) {
    addFinding(findings, seen, {
      id: 'session_predictable_scheme',
      category: 'advanced_web_attacks',
      severity: 'high',
      confidence: 'heuristic',
      title: 'Predictable session ID scheme hinted in page/scripts',
      remediation: REMEDIATION.session_predictable,
      source: 'weblab-session-hijacking',
    });
  }

  // 7. .NET deserialization surface
  if (/__VIEWSTATE|__EVENTVALIDATION|ViewStateUserKey|LosFormatter|ObjectStateFormatter/i.test(body)) {
    addFinding(findings, seen, {
      id: 'dotnet_viewstate_surface',
      category: 'advanced_web_attacks',
      severity: 'medium',
      confidence: 'confirmed',
      title: 'ASP.NET ViewState / postback surface detected',
      detail: 'Ensure ViewState is signed/encrypted and unsafe deserialization gadgets are disabled.',
      remediation: REMEDIATION.dotnet_deser,
      source: 'weblab-dotnet-deserialization',
    });
  }
  if (/TypeNameHandling|BinaryFormatter|NetDataContractSerializer|LosFormatter/i.test(haystack)) {
    addFinding(findings, seen, {
      id: 'dotnet_deser_api_hint',
      category: 'advanced_web_attacks',
      severity: 'critical',
      confidence: 'heuristic',
      title: '.NET unsafe deserialization API referenced',
      remediation: REMEDIATION.dotnet_deser,
      source: 'weblab-dotnet-deserialization',
    });
  }

  // 8. RCE / command injection surface
  if (
    /<input[^>]+name\s*=\s*["'](?:cmd|command|ping|host|ip|exec|shell|run)["']/i.test(body) ||
    /(?:ping|traceroute|nslookup|dig)\s*<\/(?:label|span)/i.test(body)
  ) {
    addFinding(findings, seen, {
      id: 'rce_cmdi_input_surface',
      category: 'advanced_web_attacks',
      severity: 'medium',
      confidence: 'heuristic',
      title: 'Command/network diagnostic input surface (RCE risk if passed to shell)',
      remediation: REMEDIATION.rce_cmdi_surface,
      source: 'weblab-command-injection',
    });
  }

  // 9. Blind SQL injection oracle hints
  if (
    /"exists"\s*:\s*(?:true|false)|exists\s*===\s*(?:true|false)|check-user|check_user|user_exists/i.test(
      haystack
    )
  ) {
    addFinding(findings, seen, {
      id: 'blind_sqli_boolean_oracle',
      category: 'sql_injection',
      severity: 'medium',
      confidence: 'heuristic',
      title: 'Boolean user-exists API pattern (blind SQLi oracle risk)',
      detail: 'Endpoints returning only exists:true/false can leak data via boolean or time-based SQLi — not probed here.',
      remediation: REMEDIATION.blind_sqli_oracle,
      source: 'weblab-blind-sqli',
    });
  }

  // 10. Data exfiltration channels
  if (/<(?:input|textarea)[^>]+name\s*=\s*["'](?:webhook|callback|notify_url|oob|exfil|collaborator)/i.test(body)) {
    addFinding(findings, seen, {
      id: 'data_exfil_webhook_field',
      category: 'advanced_web_attacks',
      severity: 'medium',
      confidence: 'heuristic',
      title: 'Outbound webhook/callback URL field — data exfiltration risk if SSRF/OOB',
      remediation: REMEDIATION.data_exfil_webhook,
      source: 'weblab-data-exfiltration',
    });
  }

  // 11. File upload bypass surface
  const fileInputs = body.match(/<input[^>]+type\s*=\s*["']file["'][^>]*>/gi) || [];
  if (fileInputs.length > 0) {
    let weakRestriction = false;
    for (const inp of fileInputs) {
      if (!/accept\s*=/i.test(inp) || /accept\s*=\s*["'][^"']*\*/i.test(inp)) {
        weakRestriction = true;
        break;
      }
    }
    if (weakRestriction) {
      addFinding(findings, seen, {
        id: 'file_upload_weak_accept',
        category: 'advanced_web_attacks',
        severity: 'medium',
        confidence: 'heuristic',
        title: 'File upload without strict accept attribute',
        detail: 'Client-side accept is bypassable — enforce extension/MIME allow-list server-side.',
        remediation: REMEDIATION.file_upload_weak,
        source: 'weblab-file-upload-bypass',
      });
    } else {
      addFinding(findings, seen, {
        id: 'file_upload_surface',
        category: 'advanced_web_attacks',
        severity: 'info',
        confidence: 'confirmed',
        title: 'File upload form present — verify server-side validation',
        remediation: REMEDIATION.file_upload_weak,
        source: 'weblab-file-upload-bypass',
      });
    }
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
  const hasLoginForm =
    /<form[^>]*(?:login|sign[\s-]?in|wp-login|auth)/i.test(body) || passwordInputs.length > 0;
  const isSignupForm = /<form[^>]*(?:register|signup|sign-up|create-account|registration)/i.test(body);
  const isResetPage = /(?:forgot|reset|recover)[\s_-]?(?:password|passwd)/i.test(body);

  if (!isHttps && passwordInputs.length > 0) {
    addFinding(findings, seen, {
      id: 'login_http',
      category: 'password_security',
      severity: 'critical',
      confidence: 'confirmed',
      title: 'Password form served over HTTP (not HTTPS)',
      remediation: REMEDIATION.login_http,
      source: 'passlab-auditor',
    });
  }

  if (hasLoginForm && passwordInputs.length) {
    let missingMin = 0;
    let weakMin = null;
    for (const inp of passwordInputs) {
      const ml = parseMinLengthFromInput(inp);
      if (ml == null) missingMin += 1;
      else if (ml < 8 && (weakMin == null || ml < weakMin)) weakMin = ml;
    }

    if (missingMin > 0 && isSignupForm) {
      addFinding(findings, seen, {
        id: 'password_no_minlength',
        category: 'password_security',
        severity: 'low',
        confidence: 'heuristic',
        title: 'Registration form password field without minlength in HTML',
        detail: 'Server-side rules may still apply — verify password policy on the API.',
        remediation: REMEDIATION.password_minlength,
        source: 'passlab-auditor',
      });
    }

    if (weakMin != null && isSignupForm) {
      addFinding(findings, seen, {
        id: 'password_weak_minlength',
        category: 'password_security',
        severity: weakMin < 6 ? 'medium' : 'low',
        confidence: 'heuristic',
        title: 'Registration allows short passwords in HTML (minlength=' + weakMin + ')',
        detail: 'Passlab auditor recommends minimum 12+ characters for new accounts.',
        remediation: REMEDIATION.password_weak_minlength,
        source: 'passlab-auditor',
      });
    }

    if (isSignupForm && passwordInputs.length === 1) {
      const hasConfirm =
        /<input[^>]+(?:name|id)\s*=\s*["'][^"']*(?:confirm|repeat|verify)[^"']*["'][^>]+type\s*=\s*["']password["']/i.test(body) ||
        /<input[^>]+type\s*=\s*["']password["'][^>]+(?:name|id)\s*=\s*["'][^"']*(?:confirm|repeat|verify)/i.test(body);
      if (!hasConfirm) {
        addFinding(findings, seen, {
          id: 'password_no_confirm',
          category: 'password_security',
          severity: 'low',
          confidence: 'heuristic',
          title: 'Registration form missing confirm-password field',
          detail: 'Users may mistype passwords without a confirmation step.',
          remediation: REMEDIATION.password_no_confirm,
          source: 'passlab-auditor',
        });
      }
    }

    if (isSignupForm && !hasPasswordComplexityHints(body)) {
      addFinding(findings, seen, {
        id: 'password_no_complexity',
        category: 'password_security',
        severity: 'low',
        confidence: 'heuristic',
        title: 'No visible password complexity or strength guidance on registration',
        detail: 'No strength meter, policy text, or pattern attribute detected in HTML.',
        remediation: REMEDIATION.password_no_complexity,
        source: 'passlab-auditor',
      });
    }

    if (isSignupForm) {
      addFinding(findings, seen, {
        id: 'password_breached_advisory',
        category: 'password_security',
        severity: 'info',
        confidence: 'info',
        title: 'Block breached/common passwords on registration (passlab advisory)',
        detail:
          'Ensure server rejects top breached passwords such as: ' +
          COMMON_BREACHED_PASSWORDS.slice(0, 6).join(', ') +
          '. No dictionary attack was run.',
        remediation: REMEDIATION.password_breached_advisory,
        source: 'passlab-dictionary-advisory',
      });
    }

    const loginFormGet =
      /<form[^>]*method\s*=\s*["']get["'][^>]*>[\s\S]*?<input[^>]+type\s*=\s*["']password["']/i.test(body);
    if (loginFormGet) {
      addFinding(findings, seen, {
        id: 'password_login_get',
        category: 'password_security',
        severity: 'critical',
        confidence: 'confirmed',
        title: 'Login form submits password via HTTP GET',
        detail: 'Passwords in query strings appear in logs, history, and Referer headers.',
        remediation: REMEDIATION.password_login_get,
        source: 'passlab-online-auditor',
      });
    }

    if (!hasCaptchaInHtml(body)) {
      addFinding(findings, seen, {
        id: 'password_no_captcha',
        category: 'password_security',
        severity: 'info',
        confidence: 'heuristic',
        title: 'No CAPTCHA/bot challenge visible on login or registration form',
        detail: 'CAPTCHA after failed attempts reduces online password guessing — not tested here.',
        remediation: REMEDIATION.password_no_captcha,
        source: 'passlab-online-auditor',
      });
    }

    if (!hasMfaHintsInHtml(body)) {
      addFinding(findings, seen, {
        id: 'password_no_mfa',
        category: 'password_security',
        severity: 'info',
        confidence: 'heuristic',
        title: 'No MFA / 2FA field detected on authentication page',
        detail: 'TOTP, OTP, or WebAuthn fields not found — MFA may still be enabled post-login.',
        remediation: REMEDIATION.password_no_mfa,
        source: 'passlab-auditor',
      });
    }

    if (detectUserEnumerationHints(body)) {
      addFinding(findings, seen, {
        id: 'password_user_enum',
        category: 'password_security',
        severity: 'medium',
        confidence: 'heuristic',
        title: 'Login page may reveal whether username/email exists',
        detail: 'Specific "user not found" style messages aid credential stuffing and user enumeration.',
        remediation: REMEDIATION.password_user_enum,
        source: 'passlab-online-auditor',
      });
    }

    addFinding(findings, seen, {
      id: 'password_login_surface',
      category: 'password_security',
      severity: 'info',
      confidence: 'confirmed',
      title: 'Login / password form present on scanned page',
      detail: 'Password brute-force, dictionary, and rainbow attacks were NOT run. Ensure rate limiting, lockout, and strong hashing.',
      remediation: REMEDIATION.password_rate_limit,
      source: 'passlab-auditor',
    });
  }

  if (isResetPage) {
    const httpResets = findHttpResetLinks(body);
    if (httpResets.length > 0 || (!isHttps && /type\s*=\s*["']password["']/i.test(body))) {
      addFinding(findings, seen, {
        id: 'password_reset_http',
        category: 'password_security',
        severity: 'high',
        confidence: httpResets.length ? 'confirmed' : 'heuristic',
        title: 'Password reset flow may use insecure HTTP',
        detail:
          httpResets.length > 0
            ? 'HTTP reset links found: ' + httpResets.slice(0, 2).join(', ')
            : 'Reset page served without HTTPS.',
        remediation: REMEDIATION.password_reset_http,
        source: 'passlab-auditor',
      });
    }
  }

  if (/<input[^>]+type\s*=\s*["']password["'][^>]+autocomplete\s*=\s*["']off["']/i.test(body)) {
    addFinding(findings, seen, {
      id: 'autocomplete_password',
      category: 'password_security',
      severity: 'info',
      title: 'Password field with autocomplete disabled (review UX/security policy)',
      source: 'passlab-auditor',
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
      source: 'passlab-auditor',
    });
  }

  if (/type\s*=\s*["']password["'][^>]+value\s*=\s*["'][^"']+["']/i.test(body)) {
    addFinding(findings, seen, {
      id: 'password_prefilled',
      category: 'password_security',
      severity: 'high',
      confidence: 'confirmed',
      title: 'Password field has pre-filled value in HTML',
      detail: 'May expose credentials in source or logs.',
      remediation: 'Never embed password values in HTML.',
      source: 'passlab-auditor',
    });
  }

  for (const hf of analyzeWeakHashInText(body, 'password_security')) {
    addFinding(findings, seen, hf);
  }

  const authSurface = hasLoginForm || isSignupForm || isResetPage || !!wwwAuth;
  for (const rf of analyzeRateLimitHeaders(headers, authSurface)) {
    addFinding(findings, seen, rf);
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
      timeout: probeTimeoutMs(),
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
  if (isServerlessRuntime()) return [];
  const findings = [];
  const seen = new Set();
  const deadline = Date.now() + (isServerlessRuntime() ? 3_000 : 8_000);
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
    if (Date.now() > deadline) break;
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
      timeout: probeTimeoutMs(),
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
  const deadline = Date.now() + (isServerlessRuntime() ? 4_000 : 9_000);
  let base;
  try {
    base = new URL(finalUrl);
  } catch {
    return findings;
  }
  if (isBlockedHost(base.hostname)) return findings;

  const paths = isServerlessRuntime()
    ? SENSITIVE_PATHS.filter((p) => p.severity === 'critical').slice(0, 2)
    : SENSITIVE_PATHS;
  const loginPaths = isServerlessRuntime() ? [] : LOGIN_PATHS;

  for (const item of paths) {
    if (Date.now() > deadline) break;
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
      for (const hf of analyzeWeakHashInText(getRes.body, 'password_security')) {
        addFinding(findings, seen, hf);
      }
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

  for (const item of loginPaths) {
    if (Date.now() > deadline) break;
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
    records.a = await withTimeoutValue(
      dns.resolve4(hostname),
      isServerlessRuntime() ? 1_800 : 2_500,
      []
    );
  } catch {
    records.a = [];
  }
  try {
    records.mx = await withTimeoutValue(
      dns.resolveMx(hostname),
      isServerlessRuntime() ? 1_800 : 2_500,
      []
    );
  } catch {
    try {
      records.mx = await withTimeoutValue(
        dns.resolveMx(apex),
        isServerlessRuntime() ? 1_800 : 2_500,
        []
      );
    } catch {
      records.mx = [];
    }
  }

  let flatTxt = '';
  for (const h of hostsToCheck) {
    try {
      const txt = await withTimeoutValue(
        dns.resolveTxt(h),
        isServerlessRuntime() ? 1_800 : 2_500,
        []
      );
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
  const advancedWebFindings = analyzeAdvancedWebAttacks(html, finalUrl, headers);
  const passwordFindings = analyzePasswordSecurity(html, finalUrl, headers);
  const avEvasionFindings = analyzeAntivirusEvasion(html);
  const totalBudget = attackSurfaceBudgetMs();
  const perProbeBudget = Math.max(1800, Math.floor(totalBudget / 2));
  const sqliProbeFindings = await withTimeoutValue(
    probeSqlInjectionSafe(finalUrl),
    perProbeBudget,
    []
  );
  const pathFindings = await withTimeoutValue(
    probeSensitivePaths(finalUrl),
    perProbeBudget,
    []
  );
  const dnsResult = await withTimeoutValue(
    gatherDnsInfo(hostname),
    Math.max(1800, Math.floor(totalBudget / 3)),
    { findings: [], records: { a: [], mx: [], txt: [] } }
  );

  const findings = headerFindings
    .concat(
      cookieFindings,
      htmlFindings,
      advancedWebFindings,
      passwordFindings,
      avEvasionFindings,
      sqliProbeFindings,
      pathFindings,
      dnsResult.findings
    );
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
      'Genuine checks only: confirmed = verified signal (DNS, file content, DB error, malware pattern). Heuristic = review manually. Includes passlab password auditor + OSWE/WEB-300 passive detection (prototype pollution, SSRF sinks, SAST hints, session hijack, .NET deser, blind SQLi oracle, file upload) — no exploitation, brute-force, or OOB probes. SQL probes are read-only GET tests.',
  };
}

module.exports = {
  buildAttackSurfaceReport,
  CATEGORY_LABELS,
  analyzeSecurityHeaders,
  analyzeHtmlAttacks,
  analyzeAdvancedWebAttacks,
  analyzePasswordSecurity,
  analyzeAntivirusEvasion,
  analyzeWeakHashInText,
  analyzeRateLimitHeaders,
  probeSqlInjectionSafe,
  probeSensitivePaths,
  COMMON_BREACHED_PASSWORDS,
};
