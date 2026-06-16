'use strict';

/**
 * Passlab-inspired password auditor checks (passive only — no brute-force).
 */
const {
  analyzePasswordSecurity,
  analyzeWeakHashInText,
  buildAttackSurfaceReport,
} = require('./go-live-audit-attack-surface.cjs');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function ids(findings) {
  return (findings || []).map((f) => f.id);
}

function runHtmlCase(name, html, opts) {
  const finalUrl = (opts && opts.finalUrl) || 'https://example.com';
  const headers = (opts && opts.headers) || {};
  const findings = analyzePasswordSecurity(html, finalUrl, headers);
  return { name, findings, ids: ids(findings) };
}

async function main() {
  let failed = 0;

  const signupWeak = runHtmlCase('signup-weak-minlength', `
    <form class="register" method="post" action="/signup">
      <input type="email" name="email">
      <input type="password" name="password" minlength="4">
    </form>
  `);
  assert(signupWeak.ids.includes('password_weak_minlength'), 'expected password_weak_minlength');
  assert(signupWeak.ids.includes('password_breached_advisory'), 'expected breached advisory');
  console.log('OK   signup-weak-minlength');

  const signupNoConfirm = runHtmlCase('signup-no-confirm', `
    <form id="create-account" method="post">
      <input type="password" name="password" minlength="12">
    </form>
  `);
  assert(signupNoConfirm.ids.includes('password_no_confirm'), 'expected password_no_confirm');
  console.log('OK   signup-no-confirm');

  const loginGet = runHtmlCase('login-get-method', `
    <form method="get" action="/login">
      <input type="text" name="user">
      <input type="password" name="pass">
    </form>
  `);
  assert(loginGet.ids.includes('password_login_get'), 'expected password_login_get');
  console.log('OK   login-get-method');

  const userEnum = runHtmlCase('user-enumeration-hint', `
    <form method="post" action="/login">
      <p class="error">Username not found</p>
      <input type="password" name="p">
    </form>
  `);
  assert(userEnum.ids.includes('password_user_enum'), 'expected password_user_enum');
  console.log('OK   user-enumeration-hint');

  const genericErr = runHtmlCase('generic-login-error', `
    <form method="post" action="/login">
      <p>Invalid username or password</p>
      <input type="password" name="p">
    </form>
  `);
  assert(!genericErr.ids.includes('password_user_enum'), 'generic error should not flag enum');
  console.log('OK   generic-login-error');

  const captchaOk = runHtmlCase('login-with-captcha', `
    <form method="post" action="/login">
      <div class="g-recaptcha" data-sitekey="x"></div>
      <input type="password" name="p">
    </form>
  `);
  assert(!captchaOk.ids.includes('password_no_captcha'), 'captcha present — no captcha finding');
  console.log('OK   login-with-captcha');

  const mfaOk = runHtmlCase('login-with-mfa', `
    <form method="post" action="/login">
      <input type="password" name="p">
      <input type="text" name="totp" placeholder="Authenticator code">
    </form>
  `);
  assert(!mfaOk.ids.includes('password_no_mfa'), 'MFA field present');
  console.log('OK   login-with-mfa');

  const rateLimit = runHtmlCase('rate-limit-headers', `
    <form method="post" action="/login"><input type="password" name="p"></form>
  `, { headers: { 'X-RateLimit-Limit': '10' } });
  assert(!rateLimit.ids.includes('password_no_rate_limit_headers'), 'rate limit header present');
  console.log('OK   rate-limit-headers');

  const hashWeak = analyzeWeakHashInText('HASH_DRIVER=md5\nDB_PASSWORD=secret');
  assert(hashWeak.some((f) => f.id === 'hash_weak_env_config'), 'weak hash in env text');
  console.log('OK   hash-weak-env');

  const hashBcrypt = analyzeWeakHashInText('PASSWORD_HASH=$2y$10$abcdefghijklmnopqrstuv');
  assert(hashBcrypt.length === 0, 'bcrypt should not flag');
  console.log('OK   hash-bcrypt-safe');

  const resetHttp = runHtmlCase('reset-http-link', `
    <div class="forgot-password">
      <a href="http://example.com/reset?token=1">Reset password</a>
    </div>
  `);
  assert(resetHttp.ids.includes('password_reset_http'), 'expected password_reset_http');
  console.log('OK   reset-http-link');

  const minimal = await buildAttackSurfaceReport({
    finalUrl: 'https://example.com',
    headers: { server: 'nginx' },
    html: '<html><body><p>Hello</p></body></html>',
  });
  const badMinimal = (minimal.findings || []).filter(
    (f) =>
      f.category === 'password_security' &&
      (f.severity === 'critical' || f.severity === 'high') &&
      f.confidence === 'confirmed'
  );
  if (badMinimal.length) {
    failed += 1;
    console.log('FAIL minimal-html password false positives:', badMinimal.map((f) => f.title).join('; '));
  } else {
    console.log('OK   minimal-html no false password critical/high');
  }

  if (failed > 0) process.exit(1);
  console.log('\nAll passlab password auditor tests passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
