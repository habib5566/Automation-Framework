'use strict';

const https = require('https');
const tls = require('tls');

let insecureAgent;
function getInsecureHttpsAgent() {
  if (!insecureAgent) insecureAgent = new https.Agent({ rejectUnauthorized: false });
  return insecureAgent;
}

function isTlsFetchError(err) {
  const codes = [];
  if (err && err.code) codes.push(String(err.code));
  if (err && err.cause && err.cause.code) codes.push(String(err.cause.code));
  const msg = String((err && err.message) || '') + ' ' + String((err && err.cause && err.cause.message) || '');
  return (
    codes.some((code) =>
      ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT'].includes(code)
    ) || /certificate|ssl|tls|unable to verify/i.test(msg)
  );
}

const SSL_THRESHOLDS = { critical: 7, warn: 30, info: 60 };
const DOMAIN_THRESHOLDS = { critical: 14, warn: 30, info: 90 };
const PROBE_TIMEOUT_MS = 12_000;

function parseHostname(url) {
  try {
    return new URL(url).hostname.replace(/\.$/, '');
  } catch {
    return '';
  }
}

function daysUntil(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

function severityForDays(days, thresholds) {
  if (days == null || !Number.isFinite(days)) return null;
  if (days < 0) return 'critical';
  if (days <= thresholds.critical) return 'critical';
  if (days <= thresholds.warn) return 'high';
  if (days <= thresholds.info) return 'medium';
  return 'ok';
}

function expiryHeadline(kind, daysLeft, expired) {
  const label = kind === 'ssl' ? 'SSL certificate' : 'Domain registration';
  if (expired) return label + ' EXPIRED — renew immediately';
  if (daysLeft <= (kind === 'ssl' ? SSL_THRESHOLDS.critical : DOMAIN_THRESHOLDS.critical)) {
    return label + ' expires in ' + daysLeft + ' day(s) — renew urgently';
  }
  if (daysLeft <= (kind === 'ssl' ? SSL_THRESHOLDS.warn : DOMAIN_THRESHOLDS.warn)) {
    return label + ' expires in ' + daysLeft + ' days — plan renewal';
  }
  return label + ' valid (' + daysLeft + ' days remaining)';
}

function probeSslCertificate(hostname, port = 443) {
  return new Promise((resolve) => {
    if (!hostname) {
      return resolve({ ok: false, skipped: true, reason: 'No hostname' });
    }
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(hostname)) {
      return resolve({ ok: false, skipped: true, reason: 'Local host — SSL probe skipped' });
    }

    const socket = tls.connect(
      {
        host: hostname,
        port,
        servername: hostname,
        rejectUnauthorized: false,
        timeout: PROBE_TIMEOUT_MS,
      },
      () => {
        try {
          const cert = socket.getPeerCertificate();
          socket.end();
          if (!cert || !cert.valid_to) {
            return resolve({ ok: false, error: 'No certificate returned' });
          }
          const validTo = new Date(cert.valid_to);
          const validFrom = new Date(cert.valid_from);
          const daysLeft = daysUntil(validTo);
          const expired = daysLeft != null && daysLeft < 0;
          const severity = expired ? 'critical' : severityForDays(daysLeft, SSL_THRESHOLDS) || 'ok';
          const issuer = cert.issuer && (cert.issuer.O || cert.issuer.CN) ? cert.issuer.O || cert.issuer.CN : '—';
          const subject = cert.subject && cert.subject.CN ? cert.subject.CN : hostname;
          resolve({
            ok: true,
            type: 'ssl',
            hostname,
            validFrom: validFrom.toISOString(),
            validTo: validTo.toISOString(),
            daysLeft,
            expired,
            issuer: String(issuer).slice(0, 120),
            subject: String(subject).slice(0, 120),
            severity,
            alert: expired || severity === 'critical' || severity === 'high',
            headline: expiryHeadline('ssl', daysLeft, expired),
          });
        } catch (err) {
          socket.destroy();
          resolve({ ok: false, error: String((err && err.message) || err).slice(0, 160) });
        }
      }
    );

    socket.on('error', (err) => {
      resolve({ ok: false, error: String((err && err.message) || err).slice(0, 160) });
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ ok: false, error: 'SSL probe timed out' });
    });
  });
}

function registrarFromRdap(data) {
  const entities = Array.isArray(data.entities) ? data.entities : [];
  for (const ent of entities) {
    const roles = ent.roles || [];
    if (!roles.includes('registrar')) continue;
    const vcard = ent.vcardArray;
    if (Array.isArray(vcard) && Array.isArray(vcard[1])) {
      for (const row of vcard[1]) {
        if (Array.isArray(row) && row[0] === 'fn' && row[3]) return String(row[3]).slice(0, 120);
      }
    }
    if (ent.handle) return String(ent.handle).slice(0, 120);
  }
  return '—';
}

function expirationFromRdap(data) {
  const events = Array.isArray(data.events) ? data.events : [];
  for (const ev of events) {
    const action = String(ev.eventAction || '').toLowerCase();
    if (action === 'expiration' || action === 'registrar expiration' || action === 'registrar expiration date') {
      if (ev.eventDate) return new Date(ev.eventDate);
    }
  }
  return null;
}

function fetchRdapJsonHttps(url, insecure) {
  return new Promise((resolve) => {
    const req = https.get(
      url,
      {
        headers: { Accept: 'application/rdap+json, application/json' },
        timeout: PROBE_TIMEOUT_MS,
        agent: insecure ? getInsecureHttpsAgent() : undefined,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) return resolve(null);
          try {
            resolve(JSON.parse(raw));
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function fetchRdapJson(url) {
  const useInsecure = process.env.GO_LIVE_AUDIT_TLS_INSECURE === '1';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/rdap+json, application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    if (useInsecure || isTlsFetchError(err)) {
      return fetchRdapJsonHttps(url, true);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function probeDomainExpiry(hostname) {
  const host = String(hostname || '')
    .replace(/^www\./i, '')
    .trim();
  if (!host) return { ok: false, error: 'No hostname' };
  if (/^(localhost|127\.0\.0\.1)$/i.test(host)) {
    return { ok: false, skipped: true, reason: 'Local host — domain lookup skipped' };
  }

  const tld = host.includes('.') ? host.split('.').pop().toLowerCase() : '';
  const candidates = [
    tld === 'com' ? 'https://rdap.verisign.com/com/v1/domain/' + encodeURIComponent(host) : null,
    tld === 'net' ? 'https://rdap.verisign.com/net/v1/domain/' + encodeURIComponent(host) : null,
    'https://rdap.org/domain/' + encodeURIComponent(host),
  ].filter(Boolean);

  for (const url of candidates) {
    const data = await fetchRdapJson(url);
    if (!data) continue;
    const expiresAt = expirationFromRdap(data);
    if (!expiresAt || Number.isNaN(expiresAt.getTime())) continue;

    const daysLeft = daysUntil(expiresAt);
    const expired = daysLeft != null && daysLeft < 0;
    const severity = expired ? 'critical' : severityForDays(daysLeft, DOMAIN_THRESHOLDS) || 'ok';
    return {
      ok: true,
      type: 'domain',
      hostname: host,
      expiresAt: expiresAt.toISOString(),
      daysLeft,
      expired,
      registrar: registrarFromRdap(data),
      severity,
      alert: expired || severity === 'critical' || severity === 'high',
      headline: expiryHeadline('domain', daysLeft, expired),
    };
  }

  return { ok: false, error: 'Domain expiry lookup unavailable (RDAP)' };
}

async function buildDomainSslReport(url) {
  const hostname = parseHostname(url);
  if (!hostname) {
    return {
      ok: false,
      hostname: '',
      items: [],
      alerts: [],
      alertCount: 0,
      headline: 'No hostname to check',
      panelTone: 'neutral',
      shouldAlert: false,
    };
  }

  const [ssl, domain] = await Promise.all([probeSslCertificate(hostname), probeDomainExpiry(hostname)]);

  const items = [];
  if (ssl.ok) items.push(ssl);
  else if (!ssl.skipped) {
    items.push({
      type: 'ssl',
      ok: false,
      severity: 'medium',
      alert: false,
      headline: 'SSL check failed: ' + (ssl.error || 'unknown error'),
      error: ssl.error || 'unknown error',
    });
  }

  if (domain.ok) items.push(domain);
  else if (!domain.skipped) {
    items.push({
      type: 'domain',
      ok: false,
      severity: 'low',
      alert: false,
      headline: domain.error || 'Domain expiry unknown',
      error: domain.error || 'lookup failed',
    });
  }

  const alerts = items.filter((i) => i.alert);
  const critical = items.some((i) => i.severity === 'critical');
  const warn = items.some((i) => i.severity === 'high');
  const notice = items.some((i) => i.severity === 'medium');

  let headline = 'SSL certificate and domain registration look healthy';
  if (critical) headline = 'URGENT: SSL or domain expiry issue detected';
  else if (warn) headline = 'SSL or domain renewal attention needed';
  else if (notice) headline = 'SSL or domain expiry within early-warning window';
  else if (!ssl.ok && !ssl.skipped) headline = 'Could not verify SSL certificate';

  return {
    ok: true,
    hostname,
    ssl,
    domain,
    items,
    alerts,
    alertCount: alerts.length,
    headline,
    panelTone: critical ? 'bad' : warn ? 'warn' : items.length ? 'good' : 'neutral',
    shouldAlert: critical || warn,
    scannedAt: new Date().toISOString(),
  };
}

module.exports = {
  buildDomainSslReport,
  probeSslCertificate,
  probeDomainExpiry,
};
