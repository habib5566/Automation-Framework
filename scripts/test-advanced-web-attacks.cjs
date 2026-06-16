'use strict';

const { analyzeAdvancedWebAttacks, buildAttackSurfaceReport } = require('./go-live-audit-attack-surface.cjs');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function ids(findings) {
  return (findings || []).map((f) => f.id);
}

function main() {
  const protoHtml = `
    <script>
      function mergeProfile(data) { return lodash.merge({}, data); }
      fetch('/api/profile/merge', { method: 'POST', body: JSON.stringify({ __proto__: { isAdmin: true } }) });
    </script>
  `;
  const proto = analyzeAdvancedWebAttacks(protoHtml, 'https://example.com', {});
  assert(ids(proto).includes('pp_proto_key_hint'), 'prototype pollution hint');
  console.log('OK   prototype-pollution');

  const ssrfHtml = '<form><input name="url" type="text"><input name="proxy" type="text"></form>';
  const ssrf = analyzeAdvancedWebAttacks(ssrfHtml, 'https://example.com', {});
  assert(ids(ssrf).includes('ssrf_url_input_field'), 'ssrf url field');
  console.log('OK   advanced-ssrf-sink');

  const sastHtml = '<script>document.getElementById("x").innerHTML = location.hash;</script>';
  const sast = analyzeAdvancedWebAttacks(sastHtml, 'https://example.com', {});
  assert(ids(sast).includes('sast_dom_innerhtml_sink'), 'sast dom sink');
  console.log('OK   source-analysis-sast');

  const storedHtml =
    '<form action="/feedback"><textarea name="comment"></textarea></form><div class="comments"></div>';
  const stored = analyzeAdvancedWebAttacks(storedHtml, 'https://example.com', {});
  assert(ids(stored).includes('persistent_xss_stored_form'), 'persistent xss form');
  console.log('OK   persistent-xss');

  const sessionHtml = '<a href="/admin?session=abc123">Admin</a>';
  const session = analyzeAdvancedWebAttacks(sessionHtml, 'https://example.com', {});
  assert(ids(session).includes('session_id_in_url'), 'session in url');
  console.log('OK   session-hijacking');

  const dotnetHtml = '<input type="hidden" name="__VIEWSTATE" value="abc" />';
  const dotnet = analyzeAdvancedWebAttacks(dotnetHtml, 'https://example.com', {});
  assert(ids(dotnet).includes('dotnet_viewstate_surface'), 'viewstate');
  console.log('OK   dotnet-deserialization');

  const rceHtml = '<form><input name="ping" placeholder="host to ping"></form>';
  const rce = analyzeAdvancedWebAttacks(rceHtml, 'https://example.com', {});
  assert(ids(rce).includes('rce_cmdi_input_surface'), 'rce surface');
  console.log('OK   rce-cmdi-surface');

  const blindHtml = '<script>fetch("/api/check-user?username=x").then(r=>r.json()).then(d=>d.exists);</script>';
  const blind = analyzeAdvancedWebAttacks(blindHtml, 'https://example.com', {});
  assert(ids(blind).includes('blind_sqli_boolean_oracle'), 'blind sqli oracle');
  console.log('OK   blind-sqli-oracle');

  const uploadHtml = '<form><input type="file" name="doc"></form>';
  const upload = analyzeAdvancedWebAttacks(uploadHtml, 'https://example.com', {});
  assert(ids(upload).includes('file_upload_weak_accept'), 'file upload weak');
  console.log('OK   file-upload-bypass');

  const webhookHtml = '<input name="webhook" type="url" />';
  const webhook = analyzeAdvancedWebAttacks(webhookHtml, 'https://example.com', {});
  assert(ids(webhook).includes('data_exfil_webhook_field'), 'data exfil webhook');
  console.log('OK   data-exfiltration');

  return buildAttackSurfaceReport({
    finalUrl: 'https://example.com',
    headers: {},
    html: '<html><body><p>clean</p></body></html>',
  }).then((report) => {
    const adv = (report.findings || []).filter((f) => f.category === 'advanced_web_attacks');
    const bad = adv.filter((f) => f.severity === 'critical' && f.confidence === 'confirmed');
    assert(bad.length === 0, 'clean page should not have confirmed critical advanced findings');
    console.log('OK   clean-page-no-false-advanced-critical');
    console.log('\nAll advanced web attack tests passed.');
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
