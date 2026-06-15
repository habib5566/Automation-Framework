'use strict';

/**
 * Sanity check: attack-surface findings on known-good sites should not report
 * critical/high SQLi, AV evasion, or fake .env exposure.
 */
const { buildAttackSurfaceReport } = require('./go-live-audit-attack-surface.cjs');

async function runCase(name, opts) {
  const report = await buildAttackSurfaceReport(opts);
  const bad = (report.findings || []).filter(
    (f) =>
      (f.severity === 'critical' || f.severity === 'high') &&
      f.confidence === 'confirmed' &&
      !/missing|HSTS|CSP|X-Frame|nosniff|SPF|Referrer|Permissions/i.test(f.title || '')
  );
  return { name, ok: bad.length === 0, bad, total: report.findings.length, headline: report.headline };
}

async function main() {
  const cases = [
    await runCase('minimal-html', {
      finalUrl: 'https://example.com',
      headers: { server: 'nginx' },
      html: '<!DOCTYPE html><html><head><title>Test</title></head><body><p>Hello</p></body></html>',
    }),
    await runCase('normal-login-form', {
      finalUrl: 'https://example.com',
      headers: {},
      html:
        '<html><body><form method="post" action="/login"><input type="hidden" name="_token" value="x"><input type="password" name="p"></form></body></html>',
    }),
    await runCase('english-select-text', {
      finalUrl: 'https://example.com',
      headers: {},
      html: '<p>Please SELECT your option FROM the menu below</p>',
    }),
  ];

  let failed = 0;
  for (const c of cases) {
    if (c.ok) {
      console.log('OK  ', c.name, '— findings:', c.total);
    } else {
      failed += 1;
      console.log('FAIL', c.name, '— false critical/high:', c.bad.map((b) => b.title).join('; '));
    }
  }

  const malicious = await buildAttackSurfaceReport({
    finalUrl: 'https://example.com',
    headers: {},
    html: '<script>eval(atob("YWxlcnQoMSk="))</script>',
  });
  const avFound = (malicious.findings || []).some((f) => f.category === 'antivirus_evasion');
  if (avFound) console.log('OK   malicious-sample — AV evasion detected');
  else {
    failed += 1;
    console.log('FAIL malicious-sample — expected AV evasion detection');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
