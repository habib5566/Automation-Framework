'use strict';

const { detectLaravelVersion, laravelVersionAlert } = require('./go-live-audit-site-stack.cjs');

function normalizeVersion(raw) {
  const v = String(raw || '').replace(/^v/i, '').trim();
  if (!/^\d+\.\d+(\.\d+)?$/.test(v)) return null;
  const major = parseInt(v.split('.')[0], 10);
  if (major < 4 || major > 99) return null;
  return v;
}

/** Parse laravel/framework version from composer.lock / installed.json text. */
function parseLaravelVersionFromComposerText(text) {
  const s = String(text || '');
  const patterns = [
    /"name"\s*:\s*"laravel\/framework"[\s\S]{0,400}?"version"\s*:\s*"v?([\d.]+)"/i,
    /"laravel\/framework"\s*:\s*\{[\s\S]{0,400}?"version"\s*:\s*"v?([\d.]+)"/i,
    /laravel\/framework["\s:]+v?([\d]+\.[\d]+\.[\d]+)/i,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m && m[1]) {
      const n = normalizeVersion(m[1]);
      if (n) return n;
    }
  }
  return null;
}

/**
 * Try same-origin composer.lock (some misconfigured servers expose it).
 * @param {string} finalUrl
 * @param {(url: string, maxRedirects?: number, opts?: object) => Promise<object>} fetchUrl
 */
async function probeLaravelVersionFromSite(finalUrl, fetchUrl) {
  let origin;
  try {
    origin = new URL(finalUrl).origin;
  } catch {
    return null;
  }

  const paths = ['/composer.lock', '/vendor/composer/installed.json'];
  for (const p of paths) {
    try {
      const bundle = await fetchUrl(origin + p, 2, { timeoutMs: 6000 });
      const sc = Number(bundle.statusCode) || 0;
      if (sc < 200 || sc >= 400) continue;
      const body = String(bundle.body || '');
      if (body.length < 50 || body.length > 2_500_000) continue;
      const ver = parseLaravelVersionFromComposerText(body);
      if (ver) return { version: ver, source: p.replace(/^\//, '') };
    } catch {
      /* next path */
    }
  }
  return null;
}

/**
 * Fill Laravel version on siteStack when missing (HTML + optional composer probe).
 */
async function enrichSiteStackVersions(siteStack, html, finalUrl, fetchUrl) {
  if (!siteStack || !Array.isArray(siteStack.items)) return siteStack;

  const items = siteStack.items;
  const idx = items.findIndex((i) => i && i.id === 'laravel');
  if (idx < 0) return siteStack;

  let version = items[idx].version || detectLaravelVersion(html);
  let source = version ? 'html' : '';

  if (!version && fetchUrl && finalUrl) {
    const probed = await probeLaravelVersionFromSite(finalUrl, fetchUrl);
    if (probed) {
      version = probed.version;
      source = probed.source;
    }
  }

  if (version) {
    const lv = laravelVersionAlert(version);
    items[idx] = {
      ...items[idx],
      version,
      alert: lv.alert,
      detail: lv.detail,
      source: (items[idx].source || 'detect') + (source ? '+' + source : '+version'),
    };
    if (siteStack.subline && !siteStack.subline.includes(version)) {
      siteStack.subline = siteStack.subline.replace(/\bLaravel\b(?!\s+\d)/, 'Laravel ' + version);
    }
  }

  return siteStack;
}

module.exports = {
  parseLaravelVersionFromComposerText,
  probeLaravelVersionFromSite,
  enrichSiteStackVersions,
};
