'use strict';

/** Lightweight JSON responses for Vercel routes that must not load scan/chromium core. */
function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(obj));
}

function readBody(req, opts) {
  const maxBytes = (opts && opts.maxBytes) || 500_000;
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > maxBytes) {
        req.destroy();
        reject(new Error('body too large (max ' + Math.round(maxBytes / 1024) + ' KB)'));
      }
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

module.exports = { sendJson, readBody };
