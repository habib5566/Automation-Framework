'use strict';

/**
 * Must run BEFORE first `require('@sparticuz/chromium')` on Vercel / Lambda.
 * Also applied at module load — setting env in code after import is too late.
 */
function applyServerlessChromiumEnv() {
  if (process.env.GO_LIVE_AUDIT_FORCE_LOCAL_PLAYWRIGHT === '1') return;
  const serverless =
    process.env.GO_LIVE_AUDIT_USE_SERVERLESS_CHROMIUM === '1' ||
    process.env.VERCEL === '1' ||
    process.env.VERCEL_ENV ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.AWS_EXECUTION_ENV ||
    process.env.LAMBDA_TASK_ROOT;
  if (!serverless) return;

  if (!process.env.AWS_LAMBDA_JS_RUNTIME) {
    process.env.AWS_LAMBDA_JS_RUNTIME = 'nodejs22.x';
  }
  if (!process.env.AWS_REGION) {
    process.env.AWS_REGION = process.env.VERCEL_REGION || 'us-east-1';
  }
  if (process.env.VERCEL === '1' && process.env.GO_LIVE_AUDIT_USE_SERVERLESS_CHROMIUM !== '0') {
    process.env.GO_LIVE_AUDIT_USE_SERVERLESS_CHROMIUM = '1';
  }
}

applyServerlessChromiumEnv();

function ensureServerlessChromiumEnv() {
  applyServerlessChromiumEnv();
}

module.exports = { ensureServerlessChromiumEnv, applyServerlessChromiumEnv };
