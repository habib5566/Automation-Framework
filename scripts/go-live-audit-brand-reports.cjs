'use strict';

const fs = require('fs');
const path = require('path');
const { isReadOnlyDatastore } = require('./go-live-audit-brand-watch.cjs');

const DATA_DIR = path.join(__dirname, '..', 'go-live-audit', 'data');
const REPORTS_DIR = path.join(DATA_DIR, 'brand-reports');

function safeReportKey(key) {
  return String(key || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9:_-]/g, '_')
    .slice(0, 120);
}

function brandStorageKey(name, url) {
  const n = String(name || '').trim();
  if (n) return 'name:' + n.toLowerCase().replace(/\s+/g, ' ');
  try {
    return 'host:' + new URL(String(url || '').trim()).hostname.toLowerCase().replace(/^www\./, '');
  } catch (e) {
    return 'url:' + String(url || '').trim().toLowerCase();
  }
}

function blobPathname(key) {
  return 'go-live-audit/brand-reports/' + safeReportKey(key) + '.json';
}

async function saveBrandReportToBlob(key, jsonText) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return { ok: false, reason: 'BLOB_READ_WRITE_TOKEN not set' };
  let put;
  try {
    put = require('@vercel/blob').put;
  } catch (e) {
    return { ok: false, reason: 'Install @vercel/blob (npm install)' };
  }
  await put(blobPathname(key), jsonText, {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return { ok: true, storage: 'vercel-blob' };
}

async function loadBrandReportFromBlob(key) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  let head;
  let get;
  try {
    ({ head, get } = require('@vercel/blob'));
  } catch (e) {
    return null;
  }
  const pathname = blobPathname(key);
  const meta = await head(pathname, { token }).catch(function () {
    return null;
  });
  if (!meta || !meta.url) return null;
  const result = await get(meta.url, { token }).catch(function () {
    return null;
  });
  if (!result) return null;
  const text = await result.text();
  return JSON.parse(text);
}

function saveBrandReportToFile(key, jsonText) {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const file = path.join(REPORTS_DIR, safeReportKey(key) + '.json');
  fs.writeFileSync(file, jsonText, 'utf8');
  return { ok: true, storage: 'file' };
}

function loadBrandReportFromFile(key) {
  const file = path.join(REPORTS_DIR, safeReportKey(key) + '.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8', { maxLength: 8_000_000 }));
  } catch (e) {
    return null;
  }
}

/**
 * @param {{ key?: string, brandName?: string, url?: string, payload?: object, checklistState?: object }} record
 */
async function saveBrandReport(record) {
  const key =
    record.key ||
    brandStorageKey(record.brandName, record.url || (record.payload && record.payload.requestedUrl));
  const doc = {
    key,
    brandName: String(record.brandName || (record.payload && record.payload.brandName) || '').trim(),
    url: String(
      record.url ||
        (record.payload && (record.payload.requestedUrl || record.payload.finalUrl)) ||
        ''
    ).trim(),
    scannedAt: new Date().toISOString(),
    payload: record.payload || null,
    checklistState: record.checklistState || {},
  };
  const jsonText = JSON.stringify(doc);
  if (isReadOnlyDatastore()) {
    return saveBrandReportToBlob(key, jsonText);
  }
  return saveBrandReportToFile(key, jsonText);
}

async function loadBrandReport(keyOrName) {
  const raw = String(keyOrName || '').trim();
  if (!raw) return null;
  let rec = null;
  if (isReadOnlyDatastore()) {
    rec = await loadBrandReportFromBlob(raw);
    if (!rec && !raw.includes(':')) {
      rec = await loadBrandReportFromBlob('name:' + raw.toLowerCase().replace(/\s+/g, ' '));
    }
    return rec;
  }
  rec = loadBrandReportFromFile(raw);
  if (!rec && !raw.includes(':')) {
    rec = loadBrandReportFromFile('name:' + raw.toLowerCase().replace(/\s+/g, ' '));
  }
  return rec;
}

function brandReportsStorageHint() {
  if (!isReadOnlyDatastore()) {
    return { mode: 'file', path: REPORTS_DIR };
  }
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    return { mode: 'vercel-blob', ok: true };
  }
  return {
    mode: 'browser-only',
    ok: false,
    hint:
      'Add Vercel Blob store (Storage → Blob) so shared links get full brand reports without tunnel. See go-live-audit/FULL-PERFECTION-URDU.md',
  };
}

module.exports = {
  saveBrandReport,
  loadBrandReport,
  brandStorageKey,
  safeReportKey,
  brandReportsStorageHint,
};
