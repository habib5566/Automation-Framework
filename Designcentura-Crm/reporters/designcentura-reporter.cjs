const fs = require('fs');
const path = require('path');

/** @typedef {{ tcId: string, title: string, expected: string, status: string, durationMs: number, error: string }} Row */

class DesigncenturaReporter {
  constructor() {
    /** @type {Row[]} */
    this.rows = [];
    this.started = Date.now();
  }

  onTestEnd(test, result) {
    if (test.title.includes('authenticate and save session')) return;

    const expectedAnn = test.annotations.find((a) => a.type === 'expected');
    const expected = expectedAnn?.description || '';

    const tcMatch = test.title.match(/^(TC-ADM-\d+|STRESS-\d+|UNIT-UI-\d+)/);
    const tcId = tcMatch ? tcMatch[1] : test.title.slice(0, 40);

    let actual = '';
    if (result.status === 'passed') {
      actual = 'Observed: assertions passed; URL/body/status checks succeeded.';
    } else if (result.status === 'skipped') {
      actual = 'Skipped.';
    } else {
      actual = result.error?.message || result.error?.stack || String(result.errors?.[0] || 'Failed');
    }

    this.rows.push({
      tcId,
      title: test.title,
      expected,
      status: result.status,
      durationMs: result.duration,
      error: result.error?.message || '',
      actual,
    });
  }

  onEnd() {
    const outDir = path.join(__dirname, '..', 'reports');
    fs.mkdirSync(outDir, { recursive: true });
    const csvPath = path.join(outDir, 'designcentura-test-run.csv');

    const header =
      'TC_ID,Test_Title,Expected_Result,Actual_Result,Status,Duration_Ms,Error_Summary\n';
    const lines = this.rows.map((r) => {
      const esc = (s) =>
        `"${String(s).replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
      return [
        esc(r.tcId),
        esc(r.title),
        esc(r.expected),
        esc(r.actual),
        esc(r.status),
        r.durationMs,
        esc(r.error),
      ].join(',');
    });

    fs.writeFileSync(csvPath, header + lines.join('\n'), 'utf8');
    fs.writeFileSync(
      path.join(outDir, 'designcentura-test-run.json'),
      JSON.stringify(this.rows, null, 2),
      'utf8'
    );

    const summary = {
      generatedAt: new Date().toISOString(),
      total: this.rows.length,
      passed: this.rows.filter((r) => r.status === 'passed').length,
      failed: this.rows.filter((r) => r.status === 'failed').length,
      skipped: this.rows.filter((r) => r.status === 'skipped').length,
      durationMsApprox: Date.now() - this.started,
    };
    fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  }
}

module.exports = DesigncenturaReporter;
