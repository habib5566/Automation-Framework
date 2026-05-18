'use strict';

/**
 * Detect the **scanned website's** technology stack from HTTP headers + HTML (best-effort).
 * Not the audit tool's own Node/npm stack.
 */

function headersToLower(headers) {
  const o = {};
  for (const [k, v] of Object.entries(headers || {})) {
    o[String(k).toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
  }
  return o;
}

function parseSemverish(raw) {
  const m = String(raw || '').match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return { major: +m[1], minor: +(m[2] || 0), patch: +(m[3] || 0), raw: m[0] };
}

function cmpSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function metaGenerator(body) {
  const m =
    body.match(/<meta[^>]+name\s*=\s*["']generator["'][^>]+content\s*=\s*["']([^"']+)["']/i) ||
    body.match(/<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]+name\s*=\s*["']generator["']/i);
  return m ? m[1].trim() : '';
}

function cookieHeaderHas(hLow, name) {
  const c = String(hLow.cookie || hLow['set-cookie'] || '');
  return new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=', 'i').test(c);
}

/**
 * @param {Record<string, string>} headers
 * @param {string} body
 * @param {string} finalUrl
 */
function detectSiteStack(headers, body, finalUrl) {
  const h = headersToLower(headers);
  const html = String(body || '');
  const lower = html.toLowerCase();
  const gen = metaGenerator(html);

  /** @type {Map<string, { id: string, label: string, version: string|null, category: string, confidence: string, source: string, alert: string, detail: string }>} */
  const byId = new Map();

  function add(item) {
    if (!item || !item.id) return;
    const prev = byId.get(item.id);
    const rank = { high: 3, medium: 2, low: 1 };
    if (!prev || (rank[item.confidence] || 0) >= (rank[prev.confidence] || 0)) {
      byId.set(item.id, item);
    }
  }

  // —— PHP ——
  const xPowered = String(h['x-powered-by'] || '');
  const phpM = xPowered.match(/PHP\/([\d.]+)/i) || lower.match(/php\/([\d.]+)/i);
  if (phpM) {
    const v = parseSemverish(phpM[1]);
    let alert = 'good';
    let detail = 'X-Powered-By header';
    if (v && cmpSemver(v, parseSemverish('8.2')) < 0) {
      alert = cmpSemver(v, parseSemverish('8.1')) < 0 ? 'bad' : 'warn';
      detail = 'PHP version may be below current supported releases — plan an upgrade.';
    }
    add({
      id: 'php',
      label: 'PHP',
      version: phpM[1],
      category: 'runtime',
      confidence: 'high',
      source: 'header',
      alert,
      detail,
    });
  }

  // —— Web server ——
  const srv = String(h.server || '');
  if (srv) {
    const nginx = srv.match(/nginx\/([\d.]+)/i);
    const apache = srv.match(/Apache\/([\d.]+)/i);
    const iis = /Microsoft-IIS\/([\d.]+)/i.exec(srv);
    if (nginx) {
      add({
        id: 'nginx',
        label: 'nginx',
        version: nginx[1],
        category: 'hosting',
        confidence: 'high',
        source: 'header',
        alert: 'info',
        detail: 'Server header',
      });
    } else if (apache) {
      add({
        id: 'apache',
        label: 'Apache',
        version: apache[1],
        category: 'hosting',
        confidence: 'high',
        source: 'header',
        alert: 'info',
        detail: 'Server header',
      });
    } else if (iis) {
      add({
        id: 'iis',
        label: 'Microsoft IIS',
        version: iis[1],
        category: 'hosting',
        confidence: 'high',
        source: 'header',
        alert: 'info',
        detail: 'Server header',
      });
    } else if (/cloudflare/i.test(srv)) {
      add({
        id: 'cloudflare',
        label: 'Cloudflare',
        version: null,
        category: 'hosting',
        confidence: 'medium',
        source: 'header',
        alert: 'info',
        detail: 'Server header mentions Cloudflare',
      });
    }
  }
  if (h['cf-ray']) {
    add({
      id: 'cloudflare',
      label: 'Cloudflare',
      version: null,
      category: 'hosting',
      confidence: 'high',
      source: 'header',
      alert: 'info',
      detail: 'CF-Ray header',
    });
  }
  if (h['x-vercel-id'] || h['x-vercel-cache']) {
    add({
      id: 'vercel',
      label: 'Vercel',
      version: null,
      category: 'hosting',
      confidence: 'high',
      source: 'header',
      alert: 'info',
      detail: 'Vercel edge headers',
    });
  }

  // —— ASP.NET ——
  if (h['x-aspnet-version']) {
    add({
      id: 'aspnet',
      label: 'ASP.NET',
      version: h['x-aspnet-version'],
      category: 'runtime',
      confidence: 'high',
      source: 'header',
      alert: 'info',
      detail: 'X-AspNet-Version',
    });
  }
  if (h['x-aspnetmvc-version']) {
    add({
      id: 'aspnetmvc',
      label: 'ASP.NET MVC',
      version: h['x-aspnetmvc-version'],
      category: 'framework',
      confidence: 'high',
      source: 'header',
      alert: 'info',
      detail: 'X-AspNetMvc-Version',
    });
  }

  // —— Node / Express ——
  if (/express/i.test(xPowered)) {
    add({
      id: 'express',
      label: 'Express (Node)',
      version: null,
      category: 'framework',
      confidence: 'medium',
      source: 'header',
      alert: 'info',
      detail: 'X-Powered-By: Express',
    });
  }
  if (cookieHeaderHas(h, 'connect.sid')) {
    add({
      id: 'express',
      label: 'Express / Node session',
      version: null,
      category: 'framework',
      confidence: 'medium',
      source: 'cookie',
      alert: 'info',
      detail: 'connect.sid cookie pattern',
    });
  }

  // —— Laravel ——
  if (cookieHeaderHas(h, 'laravel_session') || cookieHeaderHas(h, 'XSRF-TOKEN')) {
    add({
      id: 'laravel',
      label: 'Laravel',
      version: null,
      category: 'framework',
      confidence: 'high',
      source: 'cookie',
      alert: 'good',
      detail: 'Laravel session / CSRF cookies detected',
    });
  }
  if (/livewire/i.test(html) || /\/vendor\/livewire/i.test(lower)) {
    add({
      id: 'laravel',
      label: 'Laravel',
      version: null,
      category: 'framework',
      confidence: 'high',
      source: 'html',
      alert: 'good',
      detail: 'Livewire assets in HTML',
    });
  }
  if (/@vite|vite\.config|build\/assets\/.*\.js/i.test(html) && /csrf-token|laravel/i.test(lower)) {
    add({
      id: 'laravel',
      label: 'Laravel',
      version: null,
      category: 'framework',
      confidence: 'medium',
      source: 'html',
      alert: 'info',
      detail: 'Vite + Laravel-style CSRF hints',
    });
  }

  // —— WordPress ——
  const wpGen = gen.match(/WordPress\s*([\d.]+)?/i);
  if (wpGen || /\/wp-content\//i.test(html) || /\/wp-includes\//i.test(html) || /wp-json/i.test(lower)) {
    const ver = wpGen && wpGen[1] ? wpGen[1] : null;
    let alert = 'good';
    let detail = wpGen ? 'meta generator' : 'wp-content / wp-includes paths';
    if (ver) {
      const v = parseSemverish(ver);
      if (v && cmpSemver(v, parseSemverish('6.4')) < 0) {
        alert = cmpSemver(v, parseSemverish('6.0')) < 0 ? 'bad' : 'warn';
        detail = 'WordPress core looks behind current — check updates and security patches.';
      }
    }
    add({
      id: 'wordpress',
      label: 'WordPress',
      version: ver,
      category: 'cms',
      confidence: wpGen ? 'high' : 'medium',
      source: wpGen ? 'meta' : 'html',
      alert,
      detail,
    });
  }

  // —— Drupal ——
  if (/Drupal/i.test(gen) || h['x-drupal-cache'] || h['x-drupal-dynamic-cache'] || /Drupal\.settings/i.test(html)) {
    const drupalVer = (gen.match(/Drupal\s*([\d.]+)/i) || [])[1] || null;
    add({
      id: 'drupal',
      label: 'Drupal',
      version: drupalVer,
      category: 'cms',
      confidence: drupalVer ? 'high' : 'medium',
      source: gen ? 'meta' : 'header',
      alert: 'info',
      detail: 'Drupal CMS signals',
    });
  }

  // —— Joomla ——
  if (/Joomla!/i.test(gen) || /\/media\/system\/js\/core\.js/i.test(html)) {
    const jv = (gen.match(/Joomla!\s*([\d.]+)/i) || [])[1] || null;
    add({
      id: 'joomla',
      label: 'Joomla',
      version: jv,
      category: 'cms',
      confidence: jv ? 'high' : 'medium',
      source: 'meta',
      alert: 'info',
      detail: 'Joomla CMS signals',
    });
  }

  // —— Shopify ——
  if (/cdn\.shopify\.com/i.test(html) || /Shopify\.theme/i.test(html) || h['x-shopify-stage']) {
    add({
      id: 'shopify',
      label: 'Shopify',
      version: null,
      category: 'cms',
      confidence: 'high',
      source: 'html',
      alert: 'info',
      detail: 'Shopify storefront assets',
    });
  }

  // —— Magento ——
  if (/Magento/i.test(gen) || /mage\/cookies/i.test(lower) || /\/static\/version/i.test(html)) {
    const mv = (gen.match(/Magento\s*([\d.]+)?/i) || [])[1] || null;
    add({
      id: 'magento',
      label: 'Magento',
      version: mv,
      category: 'cms',
      confidence: 'medium',
      source: gen ? 'meta' : 'html',
      alert: 'info',
      detail: 'Magento e-commerce signals',
    });
  }

  // —— Next.js ——
  if (/__NEXT_DATA__/i.test(html) || h['x-nextjs-cache'] || h['x-nextjs-page'] || /\/_next\/static\//i.test(html)) {
    add({
      id: 'nextjs',
      label: 'Next.js',
      version: null,
      category: 'framework',
      confidence: 'high',
      source: /__NEXT_DATA__/i.test(html) ? 'html' : 'header',
      alert: 'good',
      detail: 'Next.js SSR/SSG markers',
    });
  }

  // —— Nuxt ——
  if (/__NUXT__/i.test(html) || /\/_nuxt\//i.test(html)) {
    add({
      id: 'nuxt',
      label: 'Nuxt',
      version: null,
      category: 'framework',
      confidence: 'high',
      source: 'html',
      alert: 'good',
      detail: 'Nuxt.js markers',
    });
  }

  // —— React (generic) ——
  if (
    !byId.has('nextjs') &&
    (/react-dom|data-reactroot|__REACT_DEVTOOLS|react\.production\.min\.js/i.test(html) ||
      /id="__next"/i.test(html))
  ) {
    add({
      id: 'react',
      label: 'React',
      version: null,
      category: 'frontend',
      confidence: 'medium',
      source: 'html',
      alert: 'info',
      detail: 'React runtime or bundle hints in HTML',
    });
  }

  // —— Vue ——
  if (/__vue__|data-v-[a-f0-9]{8}|vue\.runtime|vue\.global/i.test(html)) {
    add({
      id: 'vue',
      label: 'Vue.js',
      version: null,
      category: 'frontend',
      confidence: 'medium',
      source: 'html',
      alert: 'info',
      detail: 'Vue.js markers in HTML',
    });
  }

  // —— Angular ——
  const ngM = html.match(/ng-version\s*=\s*["']([^"']+)["']/i);
  if (ngM || /angular\.min\.js|@angular\//i.test(html)) {
    const ver = ngM ? ngM[1] : null;
    let alert = 'info';
    if (ver) {
      const v = parseSemverish(ver);
      if (v && cmpSemver(v, parseSemverish('17')) < 0) {
        alert = cmpSemver(v, parseSemverish('15')) < 0 ? 'warn' : 'info';
      } else {
        alert = 'good';
      }
    }
    add({
      id: 'angular',
      label: 'Angular',
      version: ver,
      category: 'frontend',
      confidence: ngM ? 'high' : 'medium',
      source: 'html',
      alert,
      detail: ngM ? 'ng-version attribute' : 'Angular script paths',
    });
  }

  // —— Django ——
  if (/csrfmiddlewaretoken/i.test(html) || /django/i.test(gen)) {
    add({
      id: 'django',
      label: 'Django',
      version: null,
      category: 'framework',
      confidence: /csrfmiddlewaretoken/i.test(html) ? 'medium' : 'low',
      source: 'html',
      alert: 'info',
      detail: 'Django form / generator hints',
    });
  }

  // —— Ruby on Rails ——
  if (/csrf-token.*authenticity|data-turbolinks|data-turbo/i.test(html) || /Ruby on Rails/i.test(gen)) {
    add({
      id: 'rails',
      label: 'Ruby on Rails',
      version: null,
      category: 'framework',
      confidence: 'medium',
      source: 'html',
      alert: 'info',
      detail: 'Rails CSRF / Turbo markers',
    });
  }

  // —— Gatsby / Astro ——
  if (/gatsby/i.test(gen) || /gatsby-browser|gatsby-ssr/i.test(lower)) {
    add({
      id: 'gatsby',
      label: 'Gatsby',
      version: null,
      category: 'framework',
      confidence: 'medium',
      source: 'html',
      alert: 'info',
      detail: 'Gatsby static site markers',
    });
  }
  if (/astro/i.test(gen) || /\/_astro\//i.test(html)) {
    add({
      id: 'astro',
      label: 'Astro',
      version: null,
      category: 'framework',
      confidence: 'medium',
      source: 'html',
      alert: 'info',
      detail: 'Astro build output paths',
    });
  }

  // —— jQuery (library version alert) ——
  const jqM = html.match(/jquery[.-]?([\d.]+)?(?:\.min)?\.js/i) || html.match(/jquery\/([\d.]+)\//i);
  if (jqM) {
    const ver = jqM[1] || null;
    let alert = 'info';
    if (ver) {
      const v = parseSemverish(ver);
      if (v && cmpSemver(v, parseSemverish('3.0')) < 0) alert = 'warn';
      if (v && cmpSemver(v, parseSemverish('1.12')) < 0) alert = 'bad';
    }
    add({
      id: 'jquery',
      label: 'jQuery',
      version: ver,
      category: 'frontend',
      confidence: ver ? 'medium' : 'low',
      source: 'html',
      alert,
      detail: ver ? 'Script URL version segment' : 'jQuery script reference',
    });
  }

  // —— Bootstrap ——
  const bsM = html.match(/bootstrap[.@/v-]*([\d.]+)/i);
  if (bsM && bsM[1]) {
    add({
      id: 'bootstrap',
      label: 'Bootstrap',
      version: bsM[1],
      category: 'frontend',
      confidence: 'low',
      source: 'html',
      alert: 'info',
      detail: 'Bootstrap asset path hint',
    });
  }

  const items = [...byId.values()].sort((a, b) => {
    const catOrder = { framework: 0, cms: 1, runtime: 2, frontend: 3, hosting: 4 };
    return (catOrder[a.category] ?? 9) - (catOrder[b.category] ?? 9);
  });

  const alerts = [];
  for (const it of items) {
    if (it.alert === 'warn' || it.alert === 'bad') {
      alerts.push({
        level: it.alert,
        message: it.version
          ? `${it.label} ${it.version} — ${it.detail}`
          : `${it.label} — ${it.detail}`,
      });
    }
  }

  let headline = 'No clear framework detected';
  let subline =
    'Run a scan on a live HTML page. We read headers (Server, X-Powered-By) and HTML (meta generator, cookies, asset paths).';
  let panelTone = 'neutral';

  if (items.length > 0) {
    const primary = items.find((i) => i.category === 'framework' || i.category === 'cms') || items[0];
    const names = items.slice(0, 4).map((i) => (i.version ? `${i.label} ${i.version}` : i.label));
    headline = 'Detected site stack';
    subline = names.join(' · ') + (items.length > 4 ? ` · +${items.length - 4} more` : '');
    if (alerts.some((a) => a.level === 'bad')) panelTone = 'bad';
    else if (alerts.some((a) => a.level === 'warn')) panelTone = 'warn';
    else panelTone = 'good';
  }

  let host = '';
  try {
    host = new URL(finalUrl || '').hostname;
  } catch {
    host = '';
  }

  return {
    host,
    headline,
    subline,
    panelTone,
    items,
    alerts,
    scannedAt: new Date().toISOString(),
  };
}

module.exports = { detectSiteStack };
