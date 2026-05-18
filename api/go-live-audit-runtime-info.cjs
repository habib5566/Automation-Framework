'use strict';

/**
 * Scanner stack metadata for GET /api/runtime (local server + Vercel).
 * Copied next to api/runtime.js by vercel-prepare.cjs.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

function readRootPackageJson() {
  const p = path.join(__dirname, '..', 'package.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

function stripRange(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.replace(/^[\^~>=<]+\s*/, '');
}

/** npm sets this when the process was started via `npm run …`. */
function npmVersionFromEnv() {
  const ua = String(process.env.npm_config_user_agent || '');
  const m = ua.match(/npm\/([\d.]+)/);
  return m ? m[1] : null;
}

/** @type {{ at: number, value: unknown, ttlMs: number }} */
let _nodeLtsCache = { at: 0, value: undefined, ttlMs: 0 };
const NODE_LTS_CACHE_MS = 6 * 60 * 60 * 1000;
const NODE_LTS_FAIL_CACHE_MS = 120 * 1000;

/**
 * Latest Node.js LTS from nodejs.org (best-effort; null if offline / parse error).
 */
function fetchNodeLatestLts() {
  return new Promise((resolve) => {
    let settled = false;
    function finish(v) {
      if (settled) return;
      settled = true;
      resolve(v);
    }
    const now = Date.now();
    if (_nodeLtsCache.value !== undefined && now - _nodeLtsCache.at < _nodeLtsCache.ttlMs) {
      finish(_nodeLtsCache.value);
      return;
    }
    const req = https.get('https://nodejs.org/dist/index.json', {
      headers: { 'User-Agent': 'Automation-Framework-GoLiveAudit/1.0' },
    });
    req.setTimeout(4500, () => {
      try {
        req.destroy();
      } catch {
        /* ignore */
      }
      _nodeLtsCache = { at: Date.now(), value: null, ttlMs: NODE_LTS_FAIL_CACHE_MS };
      finish(null);
    });
    req.on('error', () => {
      _nodeLtsCache = { at: Date.now(), value: null, ttlMs: NODE_LTS_FAIL_CACHE_MS };
      finish(null);
    });
    req.on('response', (res) => {
      let raw = '';
      res.on('data', (c) => {
        raw += c;
        if (raw.length > 2_000_000) res.destroy();
      });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            _nodeLtsCache = { at: Date.now(), value: null, ttlMs: NODE_LTS_FAIL_CACHE_MS };
            finish(null);
            return;
          }
          const arr = JSON.parse(raw);
          let picked = null;
          if (Array.isArray(arr)) {
            for (const row of arr) {
              if (row && row.lts) {
                picked = { version: String(row.version || ''), codename: String(row.lts) };
                break;
              }
            }
          }
          _nodeLtsCache = { at: Date.now(), value: picked, ttlMs: NODE_LTS_CACHE_MS };
          finish(picked);
        } catch {
          _nodeLtsCache = { at: Date.now(), value: null, ttlMs: NODE_LTS_FAIL_CACHE_MS };
          finish(null);
        }
      });
    });
  });
}

function getRuntimeInfoSync() {
  const pkg = readRootPackageJson();
  const deps = pkg.dependencies || {};
  const dev = pkg.devDependencies || {};
  return {
    scanner: 'go-live-audit',
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    npm: npmVersionFromEnv(),
    enginesNode: pkg.engines && pkg.engines.node ? String(pkg.engines.node) : null,
    packageName: pkg.name || null,
    packageVersion: pkg.version || null,
    playwright: stripRange(dev['@playwright/test']),
    nodemailer: stripRange(deps.nodemailer),
    dotenv: stripRange(dev.dotenv),
  };
}

module.exports = {
  getRuntimeInfoSync,
  fetchNodeLatestLts,
};
