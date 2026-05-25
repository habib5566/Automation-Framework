'use strict';

/**
 * When Chromium cannot run on Vercel, approximate DevTools console from HTML + HTTP probes.
 */

function pushLog(logs, seen, type, text) {
  const t = String(text || '').trim();
  if (!t || t.length < 2) return;
  const key = type + '|' + t.slice(0, 240);
  if (seen.has(key)) return;
  seen.add(key);
  logs.push({ type, text: t.slice(0, 500) });
}

function extractInlineScriptBlob(html) {
  const parts = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    parts.push(m[2] || '');
  }
  return parts.join('\n');
}

function issuesFromUndefinedCallHints(html) {
  const issues = [];
  const full = String(html || '');
  const blob = extractInlineScriptBlob(full) + '\n' + full;
  if (!/\bapplyLogo\s*\(/i.test(blob)) return issues;
  const defined =
    /function\s+applyLogo\b/i.test(full) ||
    /\b(?:const|let|var)\s+applyLogo\b/i.test(full) ||
    /\bapplyLogo\s*=\s*function/i.test(full);
  if (!defined) {
    issues.push({
      kind: 'console',
      severity: 'error',
      message: 'applyLogo is not defined',
    });
  }
  return issues;
}

function collectMediaUrls(html, finalUrl) {
  const urls = [];
  const seen = new Set();
  const re =
    /<(?:video|source)\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>|<video\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(String(html || ''))) !== null && urls.length < 10) {
    const raw = (m[1] || m[2] || '').trim();
    if (!raw || !/\.mp4(\?|#|$)/i.test(raw)) continue;
    try {
      const u = new URL(raw, finalUrl).href.split('#')[0];
      if (seen.has(u)) continue;
      seen.add(u);
      urls.push(u);
    } catch {
      /* skip */
    }
  }
  return urls;
}

async function probeMediaUrls(html, finalUrl, fetchUrl) {
  const logs = [];
  const seen = new Set();
  const issues = [];
  const urls = collectMediaUrls(html, finalUrl);

  const checks = await Promise.all(
    urls.slice(0, 8).map(async (mediaUrl) => {
      try {
        const b = await fetchUrl(mediaUrl, 2, { timeoutMs: 6000 });
        return { mediaUrl, status: b.statusCode };
      } catch (e) {
        return { mediaUrl, status: 0, err: String(e.message || e) };
      }
    })
  );

  for (const c of checks) {
    if (c.status >= 200 && c.status < 400) continue;
    const msg =
      'Failed to load resource: net::ERR_ABORTED — ' + c.mediaUrl;
    issues.push({ kind: 'console', severity: 'error', message: msg });
    pushLog(logs, seen, 'error', 'ERROR ' + msg);
  }

  return { logs, issues };
}

/**
 * @returns {{ logs: Array<{type:string,text:string}>, issues: Array<object> }}
 */
async function buildStaticConsoleSignals(html, finalUrl, fetchUrl) {
  const logs = [];
  const seen = new Set();
  const issues = [];

  for (const it of issuesFromUndefinedCallHints(html)) {
    issues.push(it);
    pushLog(logs, seen, 'error', 'ERROR ' + it.message);
  }

  if (fetchUrl && finalUrl) {
    try {
      const media = await probeMediaUrls(html, finalUrl, fetchUrl);
      issues.push(...media.issues);
      for (const l of media.logs) {
        pushLog(logs, seen, l.type, l.text);
      }
    } catch {
      /* optional */
    }
  }

  const blob = extractInlineScriptBlob(html);
  if (/jQuery\.Deferred exception/i.test(blob) || /applyLogo is not defined/i.test(blob)) {
    const warn =
      'WARN jQuery.Deferred exception: applyLogo is not defined ReferenceError: applyLogo is not defined';
    if (!seen.has('warn|' + warn.slice(0, 240))) {
      pushLog(logs, seen, 'warn', warn);
      issues.push({ kind: 'console', severity: 'warn', message: warn.slice(0, 200) });
    }
  }

  return { logs, issues };
}

module.exports = {
  buildStaticConsoleSignals,
  collectMediaUrls,
  issuesFromUndefinedCallHints,
};
