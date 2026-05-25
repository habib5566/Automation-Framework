'use strict';

/**
 * Must run before first `require('@sparticuz/chromium')` on Vercel / Lambda.
 */
function ensureServerlessChromiumEnv() {
  if (process.env.GO_LIVE_AUDIT_FORCE_LOCAL_PLAYWRIGHT === '1') return;
  const serverless =
    process.env.GO_LIVE_AUDIT_USE_SERVERLESS_CHROMIUM === '1' ||
    process.env.VERCEL === '1' ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.AWS_EXECUTION_ENV ||
    process.env.LAMBDA_TASK_ROOT;
  if (!serverless) return;

  if (!process.env.AWS_LAMBDA_JS_RUNTIME) {
    const major = parseInt(String(process.versions.node || '20').split('.')[0], 10) || 20;
    process.env.AWS_LAMBDA_JS_RUNTIME = major >= 22 ? 'nodejs22.x' : 'nodejs20.x';
  }
  if (!process.env.AWS_REGION) {
    process.env.AWS_REGION = process.env.VERCEL_REGION || 'us-east-1';
  }
}

module.exports = { ensureServerlessChromiumEnv };
