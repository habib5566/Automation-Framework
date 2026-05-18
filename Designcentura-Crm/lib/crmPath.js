/**
 * Pure helpers used by automation / unit tests (no Playwright).
 */

function assertHttpOk(status) {
  return typeof status === 'number' && status >= 200 && status < 400;
}

/**
 * Normalised slug for a route path under /crm-pay/admin/
 * @param {string} path e.g. /crm-pay/admin/dashboard
 */
function routeKey(path) {
  const p = (path || '').replace(/\/+$/, '');
  const m = p.match(/\/crm-pay\/admin\/(.+)$/);
  if (!m) return 'root';
  return m[1].replace(/\//g, '-') || 'dashboard';
}

module.exports = { assertHttpOk, routeKey };
