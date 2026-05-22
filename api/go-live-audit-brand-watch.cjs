'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'go-live-audit', 'data');
const BRANDS_FILE = path.join(DATA_DIR, 'brands-watch.json');

/** Vercel/Lambda: filesystem is read-only — never write under /var/task. */
function isReadOnlyDatastore() {
  return !!(
    process.env.VERCEL === '1' ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.GO_LIVE_AUDIT_READ_ONLY_DATA === '1'
  );
}

function ensureDataDir() {
  if (isReadOnlyDatastore()) return;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function defaultBrandsDoc() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    brands: [],
  };
}

function loadBrandsWatch() {
  if (!fs.existsSync(BRANDS_FILE)) {
    if (isReadOnlyDatastore()) return defaultBrandsDoc();
    ensureDataDir();
    const doc = defaultBrandsDoc();
    fs.writeFileSync(BRANDS_FILE, JSON.stringify(doc, null, 2), 'utf8');
    return doc;
  }
  try {
    const doc = JSON.parse(fs.readFileSync(BRANDS_FILE, 'utf8'));
    if (!doc.brands) doc.brands = [];
    return doc;
  } catch {
    return defaultBrandsDoc();
  }
}

function saveBrandsWatch(doc) {
  doc.updatedAt = new Date().toISOString();
  if (isReadOnlyDatastore()) return doc;
  ensureDataDir();
  fs.writeFileSync(BRANDS_FILE, JSON.stringify(doc, null, 2), 'utf8');
  return doc;
}

function findBrand(doc, nameOrUrl) {
  const key = String(nameOrUrl || '').trim().toLowerCase();
  return (doc.brands || []).find(
    (b) =>
      String(b.name || '').trim().toLowerCase() === key ||
      String(b.url || '').trim().toLowerCase() === key
  );
}

function upsertBrand(entry) {
  if (isReadOnlyDatastore()) {
    const err = new Error(
      'Brand list cannot be saved on Vercel (read-only disk). Run npm run go-live:audit locally or deploy on Render.'
    );
    err.code = 'READ_ONLY_DEPLOY';
    throw err;
  }
  const doc = loadBrandsWatch();
  const name = String(entry.name || '').trim();
  const url = String(entry.url || '').trim();
  if (!name || !url) throw new Error('Brand needs name and url');
  let b = findBrand(doc, name);
  if (!b) {
    b = { name, url, enabled: true, addedAt: new Date().toISOString() };
    doc.brands.push(b);
  } else {
    b.name = name;
    b.url = url;
    if (entry.enabled != null) b.enabled = !!entry.enabled;
  }
  saveBrandsWatch(doc);
  return b;
}

/**
 * After scan: update baseline if clean; return watch metadata.
 */
function recordScanForBrand(brandName, scanPayload) {
  const doc = loadBrandsWatch();
  const name = String(brandName || scanPayload.brandName || '').trim();
  const url = String(scanPayload.requestedUrl || scanPayload.finalUrl || '').trim();
  let brand = name ? findBrand(doc, name) : null;
  if (!brand && url) brand = findBrand(doc, url);
  if (!brand && name) {
    brand = { name, url, enabled: true, addedAt: new Date().toISOString() };
    doc.brands.push(brand);
  }

  const security = scanPayload.security || {};
  const fp = security.fingerprint;
  const baseline = brand && brand.baselineFingerprint ? brand.baselineFingerprint : null;

  const result = {
    brandName: name || (brand && brand.name) || null,
    monitored: !!(brand && brand.enabled !== false),
    baselineUsed: baseline,
    newThreats: security.threats || [],
    alertLevel: security.alertLevel || 'ok',
  };

  if (brand && fp) {
    brand.lastScanAt = new Date().toISOString();
    brand.lastAlertLevel = security.alertLevel || 'ok';
    brand.lastUrl = scanPayload.finalUrl || url;
    if (security.alertLevel === 'ok' && (security.criticalCount || 0) === 0) {
      brand.baselineFingerprint = fp;
      brand.baselineAt = brand.lastScanAt;
    }
    if (security.shouldAlert) {
      brand.lastAlertAt = brand.lastScanAt;
      if (!Array.isArray(brand.alertHistory)) brand.alertHistory = [];
      brand.alertHistory.unshift({
        at: brand.lastScanAt,
        level: security.alertLevel,
        critical: security.criticalCount || 0,
        warns: security.warnCount || 0,
      });
      brand.alertHistory = brand.alertHistory.slice(0, 20);
    }
    saveBrandsWatch(doc);
  }

  return result;
}

function listEnabledBrands() {
  return (loadBrandsWatch().brands || []).filter((b) => b.enabled !== false && b.url);
}

module.exports = {
  BRANDS_FILE,
  isReadOnlyDatastore,
  loadBrandsWatch,
  saveBrandsWatch,
  upsertBrand,
  findBrand,
  recordScanForBrand,
  listEnabledBrands,
};
