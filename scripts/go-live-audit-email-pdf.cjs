'use strict';

/**
 * Professional PDF report for go-live scan emails (pdfkit).
 */
const DEFAULT_TITLE = 'Go Live Check List';

function pdfEnabled() {
  return process.env.GO_LIVE_AUDIT_EMAIL_PDF !== '0';
}

function safeText(s, max) {
  return String(s || '')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max || 500);
}

function severityColor(severity) {
  const s = String(severity || '').toLowerCase();
  if (s === 'critical' || s === 'error' || s === 'fail') return '#b91c1c';
  if (s === 'high' || s === 'warn' || s === 'concern') return '#c2410c';
  if (s === 'pass' || s === 'good' || s === 'ok') return '#15803d';
  return '#475569';
}

function drawSectionTitle(doc, title) {
  doc.moveDown(0.6);
  const y = doc.y;
  doc.fillColor('#1e3a5f').fontSize(13).font('Helvetica-Bold').text(title, 50, y, { width: 495 });
  doc.moveDown(0.15);
  doc.strokeColor('#cbd5e1').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(0.35);
  doc.fillColor('#334155').fontSize(10).font('Helvetica');
}

function drawKeyValue(doc, label, value) {
  doc.font('Helvetica-Bold').fillColor('#64748b').text(label + ': ', { continued: true });
  doc.font('Helvetica').fillColor('#1e293b').text(safeText(value, 400));
}

function domainSslBulletLines(domainSsl) {
  const ds = domainSsl || {};
  const items = Array.isArray(ds.items) ? ds.items : [];
  return items.map((it) => {
    const label = it.type === 'domain' ? 'Domain' : 'SSL';
    const extra =
      it.type === 'ssl' && it.validTo
        ? ' until ' + it.validTo.slice(0, 10) + (it.daysLeft != null ? ' (' + it.daysLeft + ' days left)' : '')
        : it.type === 'domain' && it.expiresAt
          ? ' until ' + it.expiresAt.slice(0, 10) + (it.daysLeft != null ? ' (' + it.daysLeft + ' days left)' : '')
          : it.error
            ? ' — ' + it.error
            : '';
    return (
      '[' +
      String(it.severity || (it.ok === false ? 'info' : 'ok')).toUpperCase() +
      '] ' +
      label +
      ' — ' +
      (it.headline || '—') +
      extra
    );
  });
}

function drawDomainSslSection(doc, domainSsl) {
  if (!domainSsl) return;
  drawSectionTitle(doc, 'SSL & domain expiry');
  doc.fillColor(severityColor(domainSsl.shouldAlert ? 'warn' : 'ok'))
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(safeText(domainSsl.headline || 'Expiry check', 220), { width: 495 });
  doc.fillColor('#334155').font('Helvetica').fontSize(10);
  if (domainSsl.hostname) {
    doc.moveDown(0.15);
    drawKeyValue(doc, 'Host', domainSsl.hostname);
  }
  const bullets = domainSslBulletLines(domainSsl);
  if (bullets.length) {
    doc.moveDown(0.15);
    drawBulletList(doc, bullets, 6);
  } else {
    doc.moveDown(0.15);
    doc.text('No expiry data returned for this host.', { width: 495 });
  }
  if (domainSsl.ssl && domainSsl.ssl.ok && domainSsl.ssl.issuer) {
    doc.moveDown(0.1);
    drawKeyValue(doc, 'SSL issuer', domainSsl.ssl.issuer);
  }
  if (domainSsl.domain && domainSsl.domain.ok && domainSsl.domain.registrar) {
    drawKeyValue(doc, 'Domain registrar', domainSsl.domain.registrar);
  }
}

function drawBulletList(doc, items, max) {
  const list = (items || []).slice(0, max || 25);
  for (const it of list) {
    if (doc.y > 720) {
      doc.addPage();
      doc.fillColor('#334155').fontSize(10).font('Helvetica');
    }
    const line = typeof it === 'string' ? it : it.text || '';
    doc.fillColor('#334155').font('Helvetica').text('• ' + safeText(line, 420), { width: 495, lineGap: 2 });
    doc.moveDown(0.15);
  }
}

function buildPdfFilename(scanResponse) {
  const brand = safeText(scanResponse && scanResponse.brandName, 40)
    .replace(/[^\w\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const d = new Date().toISOString().slice(0, 10);
  return (brand ? 'Go-Live-Report-' + brand + '-' : 'Go-Live-Report-') + d + '.pdf';
}

/**
 * @returns {Promise<{ buffer: Buffer, filename: string } | null>}
 */
async function buildScanReportPdf(scanResponse) {
  if (!pdfEnabled()) return null;
  let PDFDocument;
  try {
    PDFDocument = require('pdfkit');
  } catch {
    return null;
  }

  const o = scanResponse || {};
  const title = String(process.env.GO_LIVE_AUDIT_EMAIL_FROM_NAME || '').trim() || DEFAULT_TITLE;

  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('error', () => resolve(null));
    doc.on('end', () => {
      resolve({
        buffer: Buffer.concat(chunks),
        filename: buildPdfFilename(o),
      });
    });

    try {
      doc.rect(0, 0, 595, 72).fill('#1e3a5f');
      doc.fillColor('#ffffff').fontSize(20).font('Helvetica-Bold').text(title, 50, 28, { width: 495 });
      doc.fontSize(11).font('Helvetica').text('Website go-live audit report', 50, 52);
      doc.fillColor('#334155');
      doc.y = 88;

      drawKeyValue(doc, 'Generated (UTC)', new Date().toISOString());
      if (o.brandName) drawKeyValue(doc, 'Brand', o.brandName);
      drawKeyValue(doc, 'Requested URL', o.requestedUrl || '—');
      if (o.finalUrl) drawKeyValue(doc, 'Final URL', o.finalUrl);
      if (o.statusCode != null) drawKeyValue(doc, 'HTTP status', String(o.statusCode));

      if (o.overallSummary) {
        drawSectionTitle(doc, 'Executive summary');
        const s = o.overallSummary;
        doc.fillColor(severityColor(s.level))
          .font('Helvetica-Bold')
          .fontSize(11)
          .text(safeText(s.headline, 200));
        doc.fillColor('#334155').font('Helvetica').fontSize(10);
        if (s.subline) doc.text(safeText(s.subline, 500), { width: 495 });
        if (s.counts) {
          doc.moveDown(0.2);
          doc.text(
            'Checklist — Pass: ' +
              (s.counts.pass || 0) +
              ' · Fail: ' +
              (s.counts.fail || 0) +
              ' · Manual review: ' +
              (s.counts.pending || 0),
            { width: 495 }
          );
        }
      }

      if (o.brandMatrix) {
        drawSectionTitle(doc, 'Performance overview');
        const m = o.brandMatrix;
        drawKeyValue(doc, 'Overall score', m.performancePercent + '% (Grade ' + (m.performanceGrade || '—') + ')');
        drawKeyValue(doc, 'Site health', (m.siteHealthPercent != null ? m.siteHealthPercent : '—') + '%');
        if (m.passRatePercent != null) drawKeyValue(doc, 'Checklist pass rate', m.passRatePercent + '%');
      }

      drawDomainSslSection(doc, o.domainSsl);

      if (o.vulnerabilities && Array.isArray(o.vulnerabilities.items) && o.vulnerabilities.items.length) {
        drawSectionTitle(doc, 'Vulnerabilities and risks');
        const v = o.vulnerabilities;
        if (v.headline) doc.text(safeText(v.headline, 300), { width: 495 });
        if (v.summary) {
          doc.text(
            'Critical: ' +
              (v.summary.critical || 0) +
              ' · High: ' +
              (v.summary.high || 0) +
              ' · Medium: ' +
              (v.summary.medium || 0),
            { width: 495 }
          );
        }
        drawBulletList(
          doc,
          v.items.map(
            (it) =>
              '[' +
              String(it.severity || '?').toUpperCase() +
              '] ' +
              (it.title || '') +
              (it.detail ? ' — ' + it.detail : '')
          ),
          30
        );
      }

      if (o.security && (o.security.threats || []).length) {
        drawSectionTitle(doc, 'Security monitor');
        drawKeyValue(doc, 'Status', (o.security.headline || o.security.alertLevel || 'ok').toString());
        drawBulletList(
          doc,
          (o.security.threats || []).map((t) => '[' + (t.severity || '?') + '] ' + (t.message || '')),
          20
        );
      }

      if (Array.isArray(o.autoChecks) && o.autoChecks.length) {
        drawSectionTitle(doc, 'Go-live checklist (automated rows)');
        const fails = o.autoChecks.filter((ac) => ac && ac.status === 'fail');
        const passes = o.autoChecks.filter((ac) => ac && ac.status === 'pass');
        doc.text('Passed: ' + passes.length + ' · Failed: ' + fails.length, { width: 495 });
        doc.moveDown(0.2);
        if (fails.length) {
          doc.font('Helvetica-Bold').text('Items requiring attention:', { width: 495 });
          drawBulletList(
            doc,
            fails.map((ac) => ac.id + ' — ' + safeText(ac.note, 180)),
            15
          );
        }
      }

      if (o.consoleIssues && o.consoleIssues.items && o.consoleIssues.items.length) {
        drawSectionTitle(doc, 'Console and page issues (sample)');
        drawBulletList(
          doc,
          o.consoleIssues.items.slice(0, 15).map((it) => '[' + (it.severity || '') + '] ' + (it.message || '')),
          15
        );
      }

      doc.moveDown(1);
      doc.fontSize(8).fillColor('#94a3b8').text(
        'Confidential — automated output from Go Live Check List. Use alongside manual QA for design, accessibility, content, and stakeholder sign-off before production release.',
        50,
        doc.y,
        { width: 495, align: 'left' }
      );

      doc.end();
    } catch {
      resolve(null);
    }
  });
}

/**
 * Combined PDF for multi-brand watch digest email.
 * @param {Array<Record<string, unknown>>} entries
 */
async function buildWatchDigestPdf(entries) {
  if (!pdfEnabled()) return null;
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  if (!list.length) return null;
  let PDFDocument;
  try {
    PDFDocument = require('pdfkit');
  } catch {
    return null;
  }
  const title = String(process.env.GO_LIVE_AUDIT_EMAIL_FROM_NAME || '').trim() || DEFAULT_TITLE;

  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('error', () => resolve(null));
    doc.on('end', () => {
      resolve({
        buffer: Buffer.concat(chunks),
        filename: 'Go-Live-Watch-All-Brands-' + new Date().toISOString().slice(0, 10) + '.pdf',
      });
    });

    try {
      doc.rect(0, 0, 595, 72).fill('#1e3a5f');
      doc.fillColor('#ffffff').fontSize(20).font('Helvetica-Bold').text(title, 50, 28, { width: 495 });
      doc.fontSize(11).font('Helvetica').text('All brands — watch report', 50, 52);
      doc.fillColor('#334155');
      doc.y = 88;
      drawKeyValue(doc, 'Generated (UTC)', new Date().toISOString());
      drawKeyValue(doc, 'Brands in report', String(list.length));
      doc.moveDown(0.5);

      drawSectionTitle(doc, 'Summary table');
      const colBrand = 50;
      const colScore = 200;
      const colHttp = 260;
      const colSum = 320;
      doc.fontSize(9).font('Helvetica-Bold');
      doc.text('Brand', colBrand, doc.y, { continued: true, width: 140 });
      doc.text('Score', colScore, doc.y, { continued: true, width: 55 });
      doc.text('HTTP', colHttp, doc.y, { continued: true, width: 55 });
      doc.text('Summary', colSum, doc.y, { width: 220 });
      doc.moveDown(0.35);
      doc.font('Helvetica').fontSize(8);

      for (const e of list) {
        if (doc.y > 700) {
          doc.addPage();
          doc.fontSize(8).font('Helvetica');
        }
        const y0 = doc.y;
        const scoreTxt =
          e.performancePercent != null ? e.performancePercent + '% ' + (e.performanceGrade || '') : '—';
        doc.text(safeText(e.brandName, 60), colBrand, y0, { width: 145 });
        doc.text(scoreTxt, colScore, y0, { width: 55 });
        doc.text(e.statusCode != null ? String(e.statusCode) : '—', colHttp, y0, { width: 50 });
        doc.text(safeText(e.overallHeadline, 100), colSum, y0, { width: 220 });
        doc.moveDown(0.55);
      }

      drawSectionTitle(doc, 'Per-brand detail');
      for (const e of list) {
        if (doc.y > 680) {
          doc.addPage();
          doc.fillColor('#334155').fontSize(10).font('Helvetica');
        }
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#1e3a5f').text(safeText(e.brandName, 80));
        doc.font('Helvetica').fontSize(9).fillColor('#334155');
        drawKeyValue(doc, 'URL', e.url);
        if (e.performancePercent != null) {
          drawKeyValue(doc, 'Site score', e.performancePercent + '% (grade ' + (e.performanceGrade || '—') + ')');
        }
        drawKeyValue(doc, 'HTTP', e.statusCode != null ? String(e.statusCode) : '—');
        drawKeyValue(doc, 'Availability', e.availabilityHeadline || '—');
        drawKeyValue(doc, 'Overall', e.overallHeadline || '—');
        drawKeyValue(
          doc,
          'Checklist',
          'Pass ' + (e.pass || 0) + ' · Fail ' + (e.fail || 0) + ' · Manual ' + (e.pending || 0)
        );
        if (e.securityHeadline) drawKeyValue(doc, 'Security', e.securityHeadline);
        if (e.domainSslHeadline) drawKeyValue(doc, 'SSL & domain', e.domainSslHeadline);
        if (e.domainSslAlert) {
          doc.font('Helvetica-Bold').fillColor('#b91c1c').text('SSL or domain renewal alert — review urgently', {
            width: 495,
          });
          doc.fillColor('#334155').font('Helvetica');
        }
        doc.moveDown(0.4);
      }

      doc.moveDown(0.5);
      doc.fontSize(8).fillColor('#94a3b8').text(
        'Combined watch report — scores reflect checklist pass/fail, manual-review rows, and detected issues per site.',
        50,
        doc.y,
        { width: 495 }
      );
      doc.end();
    } catch {
      resolve(null);
    }
  });
}

module.exports = { buildScanReportPdf, buildWatchDigestPdf, buildPdfFilename, pdfEnabled };
