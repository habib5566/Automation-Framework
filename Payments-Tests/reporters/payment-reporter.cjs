const fs = require('fs');
const path = require('path');

class PaymentReporter {
  constructor() {
    this.rows = [];
    this.started = Date.now();
  }

  onTestEnd(test, result) {
    const isAuthSetup = test.title.includes('authenticate and save session');
    const expectedAnn = (test.annotations || []).find((a) => a.type === 'expected');
    const expected =
      expectedAnn?.description ||
      (isAuthSetup ? 'Admin login succeeds; URL leaves /login; session saved to playwright/.auth/admin.json.' : '');

    let tcId;
    let title = test.title;
    if (isAuthSetup) {
      tcId = 'AUTH-001';
      title = 'AUTH-001: authenticate and save session (login → storageState)';
    } else {
      const m = test.title.match(/^(PAY-\d{3}|PAY-X-\d{2})/);
      tcId = m ? m[1] : test.title.slice(0, 48);
    }

    let actual = '';
    if (result.status === 'passed') {
      actual = 'Assertions passed for this payment check.';
    } else if (result.status === 'skipped') {
      actual = 'Skipped.';
    } else {
      actual = result.error?.message || result.error?.stack || 'Failed';
    }

    const rootDir = path.join(__dirname, '..');
    const screenshotPaths = (result.attachments || [])
      .filter((a) => a.contentType === 'image/png' && a.path)
      .map((a) => path.relative(rootDir, a.path).replace(/\\/g, '/'))
      .join('; ');

    this.rows.push({
      tcId,
      title,
      expected,
      status: result.status,
      durationMs: result.duration,
      error: result.error?.message || '',
      actual,
      screenshotPaths,
    });
  }

  onEnd() {
    const outDir = path.join(__dirname, '..', 'reports');
    fs.mkdirSync(outDir, { recursive: true });
    const csvPath = path.join(outDir, 'payment-test-run.csv');
    const header =
      'TC_ID,Test_Title,Expected_Result,Actual_Result,Status,Duration_Ms,Error_Summary,Screenshot_Relative_Paths\n';
    const esc = (s) => `"${String(s).replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
    const lines = this.rows.map((r) =>
      [
        esc(r.tcId),
        esc(r.title),
        esc(r.expected),
        esc(r.actual),
        esc(r.status),
        r.durationMs,
        esc(r.error),
        esc(r.screenshotPaths || ''),
      ].join(',')
    );
    fs.writeFileSync(csvPath, header + lines.join('\n'), 'utf8');
    fs.writeFileSync(path.join(outDir, 'payment-test-run.json'), JSON.stringify(this.rows, null, 2), 'utf8');
    fs.writeFileSync(
      path.join(outDir, 'summary.json'),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          total: this.rows.length,
          passed: this.rows.filter((r) => r.status === 'passed').length,
          failed: this.rows.filter((r) => r.status === 'failed').length,
          skipped: this.rows.filter((r) => r.status === 'skipped').length,
          durationMsApprox: Date.now() - this.started,
        },
        null,
        2
      ),
      'utf8'
    );
  }
}

module.exports = PaymentReporter;
