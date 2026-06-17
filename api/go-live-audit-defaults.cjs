'use strict';

/** All scan alerts / reports go here unless overridden in .env (comma-separated for multiple) */
const DEFAULT_ALERT_EMAIL = 'munem.developer@gmail.com, habib.developer8899@gmail.com';

function getAlertEmail() {
  const v = String(process.env.GO_LIVE_AUDIT_ALERT_EMAIL || process.env.GO_LIVE_AUDIT_EMAIL_TO || '').trim();
  return v || DEFAULT_ALERT_EMAIL;
}

module.exports = { DEFAULT_ALERT_EMAIL, getAlertEmail };
