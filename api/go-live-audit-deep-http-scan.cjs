'use strict';

/**
 * Extra scan depth without a browser (Vercel fallback when Chromium cannot launch).
 */

function enrichInteractiveFromHtml(html, signals) {
  const body = String(html || '');
  const s = signals || {};
  let routeCount = 0;
  const routeRe = /"(?:href|as|pathname)"\s*:\s*"(\/(?!\/)[^"\\]{1,180})"/gi;
  while (routeRe.exec(body)) routeCount++;
  const buttonInHtml = (body.match(/<button\b/gi) || []).length;
  const anchors = (body.match(/<a\s[^>]*href\s*=/gi) || []).length;
  const nextData = /__NEXT_DATA__|__next_f\.|self\.__next_f/i.test(body);
  const approx = Math.max(
    s.interactiveApprox || 0,
    buttonInHtml + anchors,
    routeCount > 0 ? Math.min(routeCount, 120) : 0,
    s.internalLinkCount || 0
  );
  s.interactiveApprox = approx;
  if (nextData && !s.ssrHints) s.ssrHints = true;
  return s;
}

async function fetchSitemapSampleUrls(finalUrl, fetchUrl, max) {
  const out = [];
  const seen = new Set();
  try {
    const origin = new URL(finalUrl).origin;
    seen.add(finalUrl.split('#')[0]);
    const smUrl = origin + '/sitemap.xml';
    const bundle = await fetchUrl(smUrl, 2, { timeoutMs: 8000 });
    if (bundle.statusCode < 200 || bundle.statusCode >= 400) return out;
    const text = String(bundle.body || '');
    const locRe = /<loc>\s*([^<]+)\s*<\/loc>/gi;
    let m;
    while ((m = locRe.exec(text)) !== null && out.length < max) {
      const loc = m[1].trim();
      try {
        const u = new URL(loc);
        if (u.origin !== origin) continue;
        const key = u.href.split('#')[0];
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(key);
      } catch {
        /* skip */
      }
    }
  } catch {
    /* noop */
  }
  return out;
}

/**
 * @param {string} finalUrl
 * @param {string} mainBody
 * @param {(url: string, maxRedirects?: number, opts?: object) => Promise<object>} fetchUrl
 * @param {object} opts
 */
async function fetchDeepFollowUpSamples(finalUrl, mainBody, fetchUrl, opts) {
  const maxPages = opts.maxPages != null ? opts.maxPages : 2;
  const maxTotalMs = opts.maxTotalMs != null ? opts.maxTotalMs : 16_000;
  const perPageTimeoutMs = opts.perPageTimeoutMs != null ? opts.perPageTimeoutMs : 7_000;
  const deadline = Date.now() + maxTotalMs;
  const { collectSameOriginPageUrls, fetchFollowUpSameOriginSamples } = opts.helpers;
  const samples = [];

  if (collectSameOriginPageUrls && fetchFollowUpSameOriginSamples) {
    const fu = await fetchFollowUpSameOriginSamples(finalUrl, mainBody, {
      maxPages,
      maxTotalMs: Math.floor(maxTotalMs * 0.6),
      perPageTimeoutMs,
    });
    samples.push(...(fu.samples || []));
  }

  if (samples.length < maxPages && Date.now() < deadline) {
    const fromSitemap = await fetchSitemapSampleUrls(finalUrl, fetchUrl, maxPages + 2);
    for (const href of fromSitemap) {
      if (samples.length >= maxPages || Date.now() > deadline) break;
      if (samples.some((s) => s.finalUrl === href)) continue;
      try {
        const b = await fetchUrl(href, 3, { timeoutMs: perPageTimeoutMs });
        if (b.statusCode >= 200 && b.statusCode < 400 && b.body) {
          const ct = String(b.contentType || '');
          if (/html|text\/plain/i.test(ct) || /<html[\s>]/i.test(String(b.body).slice(0, 2500))) {
            samples.push({ body: b.body, finalUrl: b.finalUrl, contentType: ct });
          }
        }
      } catch {
        /* skip */
      }
    }
  }

  return samples.slice(0, maxPages);
}

async function issuesFromScriptSrcProbe(html, finalUrl, fetchUrl) {
  const issues = [];
  const body = String(html || '');
  const srcRe = /\bsrc\s*=\s*["']([^"']+)["']/gi;
  const urls = [];
  let m;
  while ((m = srcRe.exec(body)) !== null && urls.length < 12) {
    try {
      const u = new URL(m[1], finalUrl).href;
      if (!/\.(js|mjs)(\?|#|$)/i.test(u) && !/\/_next\/static\//i.test(u)) continue;
      if (!urls.includes(u)) urls.push(u);
    } catch {
      /* skip */
    }
  }

  const checks = await Promise.all(
    urls.slice(0, 8).map(async (scriptUrl) => {
      try {
        const b = await fetchUrl(scriptUrl, 2, { timeoutMs: 5000 });
        return { scriptUrl, status: b.statusCode };
      } catch (e) {
        return { scriptUrl, status: 0, err: String(e.message || e) };
      }
    })
  );

  for (const c of checks) {
    if (c.status >= 400) {
      issues.push({
        kind: 'console',
        severity: 'error',
        message: `Script returned HTTP ${c.status}: ${c.scriptUrl.slice(0, 120)}`,
      });
    } else if (c.status === 0) {
      issues.push({
        kind: 'console',
        severity: 'warn',
        message: `Script fetch failed: ${c.scriptUrl.slice(0, 100)}`,
      });
    }
  }

  return issues;
}

module.exports = {
  enrichInteractiveFromHtml,
  fetchDeepFollowUpSamples,
  issuesFromScriptSrcProbe,
  fetchSitemapSampleUrls,
};
