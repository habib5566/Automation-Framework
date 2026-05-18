/**
 * Payment module — Word narrative + failures + kya karna chahiye.
 * Playwright ke baad chalao; agar JSON na ho to bhi minimal report banata hai.
 */
const fs = require('fs');
const path = require('path');

async function main() {
  const {
    Document,
    Packer,
    Paragraph,
    Table,
    TableRow,
    TableCell,
    TextRun,
    HeadingLevel,
    WidthType,
    BorderStyle,
  } = await import('docx');

  const root = path.join(__dirname, '..');
  const jsonPath = path.join(root, 'reports', 'payment-test-run.json');
  const summaryPath = path.join(root, 'reports', 'summary.json');
  const catalogPath = path.join(root, 'reports', 'payment-test-cases-catalog.csv');
  const out = path.join(root, 'reports', 'Payments-Module-QA-Report.docx');

  const hadJsonFile = fs.existsSync(jsonPath);
  let rows = [];
  if (hadJsonFile) {
    try {
      rows = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } catch {
      rows = [];
    }
  }

  const summary = fs.existsSync(summaryPath) ? JSON.parse(fs.readFileSync(summaryPath, 'utf8')) : {};
  const failed = rows.filter((r) => r.status === 'failed');
  const authRow = rows.find((r) => r.tcId === 'AUTH-001');
  const paymentRows = rows.filter((r) => r.tcId !== 'AUTH-001');
  const skippedPayment = paymentRows.filter((r) => r.status === 'skipped').length;
  const passedPayment = paymentRows.filter((r) => r.status === 'passed').length;
  const setupFailed = authRow && authRow.status === 'failed';
  const setupOk = authRow && authRow.status === 'passed';
  const blockedByAuth = setupFailed || (paymentRows.length > 0 && passedPayment === 0 && skippedPayment > 0);

  const runDate = new Date().toISOString();

  const p = (t) => new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: t })] });
  const h1 = (t) => new Paragraph({ text: t, heading: HeadingLevel.HEADING_1, spacing: { before: 220, after: 100 } });
  const h2 = (t) => new Paragraph({ text: t, heading: HeadingLevel.HEADING_2, spacing: { before: 160, after: 80 } });

  const snapRows = [
    ['Metric', 'Value'],
    ['Run (UTC)', runDate],
    ['Target URL', 'https://designcentura.com/crm-pay/admin/payment'],
    ['Results JSON present?', hadJsonFile ? 'yes (reports/payment-test-run.json)' : 'no — pehle playwright chalao'],
    ['Total rows in export', String(summary.total ?? rows.length)],
    ['Passed (all)', String(summary.passed ?? rows.filter((x) => x.status === 'passed').length)],
    ['Failed (all)', String(summary.failed ?? failed.length)],
    ['Skipped (all)', String(rows.filter((x) => x.status === 'skipped').length)],
    ['AUTH-001 (login setup)', authRow ? authRow.status : 'not in export (run tests)'],
    ['Payment checks passed (approx)', String(passedPayment)],
  ];

  const snap = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1 },
      bottom: { style: BorderStyle.SINGLE, size: 1 },
      left: { style: BorderStyle.SINGLE, size: 1 },
      right: { style: BorderStyle.SINGLE, size: 1 },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1 },
      insideVertical: { style: BorderStyle.SINGLE, size: 1 },
    },
    rows: snapRows.map((cells, idx) =>
      new TableRow({
        children: cells.map(
          (c) =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: c, bold: idx === 0 })] })],
            })
        ),
      })
    ),
  });

  const children = [
    new Paragraph({
      text: 'Design Centura — Payments Module QA Report',
      heading: HeadingLevel.TITLE,
    }),
    new Paragraph({ children: [new TextRun({ text: `Generated ${runDate} (UTC)`, italics: true })] }),
    p(
      'Yeh document automated payment-route testing ka outcome batata hai: kya block hua, kya fail hua, aur agla practical step kya hona chahiye. Playwright HTML report mein har test ke saath full-page screenshot attachments hoti hain (jab tests execute hon).'
    ),

    h1('0. Blocker / setup (sab se pehle yahan dekho)'),
    ...(hadJsonFile
      ? []
      : [
          p(
            'reports/payment-test-run.json abhi maujood nahi — matlab Playwright is folder se abhi sahi se complete run nahi hua ya reporter output likh nahi paya. Command: Payments-Tests folder mein `node scripts/payment-full-pipeline.cjs` (ya pehle `node node_modules/@playwright/test/cli.js test`).'
          ),
        ]),
    ...(setupOk
      ? [p('AUTH-001 login setup: passed — session save ho chuka hai; payment specs run ho sakti thi.')]
      : []),
    ...(setupFailed
      ? [
          p(
            'AUTH-001 login setup: FAILED — iske baghair baqi payment tests mostly "skipped" ya run hi nahi hoti. Kya check karein: (1) .env mein DESIGNCENTURA_EMAIL / DESIGNCENTURA_PASSWORD sahi hon; password mein special characters hon to puri value double-quotes mein. (2) pages/LoginPage.js selectors agar site change ho to update. (3) Trace: test-results folder mein auth.setup trace.zip — `node node_modules/@playwright/test/cli.js show-trace <path>`.'
          ),
          ...(authRow?.error
            ? [h2('AUTH-001 error (trimmed)'), p(String(authRow.error).slice(0, 2000))]
            : []),
        ]
      : []),
    ...(!setupFailed && !setupOk && hadJsonFile && rows.length === 0
      ? [p('JSON file empty — reporter ne koi row likhi nahi; dubara playwright test chalao.')]
      : []),
    ...(!setupFailed && !setupOk && blockedByAuth
      ? [
          p(
            'Lagta hai payment tests skip ho gayi hain — aksar wajah failed/missing auth dependency. Upar AUTH row aur Playwright HTML report dekho.'
          ),
        ]
      : []),

    h1('1. Summary'),
    p(
      failed.length === 0 && setupOk && passedPayment > 0
        ? 'Is run mein recorded failures nahi dikhe; payment checks execute hue. Business-level flows (gateway, refunds) alag se verify karein.'
        : failed.length === 0 && !setupOk && !hadJsonFile
          ? 'Abhi tak koi automated result export nahi mila — Section 0 follow karo.'
          : `${failed.length} test(s) failed (including setup if listed). Neeche Section 3 mein detail + suggested actions.`
    ),
    snap,

    h1('2. Kya test kiya gaya'),
    h2('2.1 Depth (payment URL)'),
    p(
      'Har viewport par: URL, HTTP status, page text density, buttons/links/inputs counts, finance wording, shell/branding, error alerts, reload stability, Tab smoke, main/form presence, table/grid style data layer (PAY-018).'
    ),
    h2('2.2 Cross flows'),
    p('Dashboard ↔ payment, hard reload, host check, repeated loads.'),
    p(
      `Static test-case matrix (planned cases): ${fs.existsSync(catalogPath) ? catalogPath.replace(root + path.sep, '') : 'run pipeline — payment-test-cases-catalog.csv banega'}.`
    ),

    h1('3. Failed items — masla aur kya karna chahiye'),
    ...(failed.length
      ? failed.flatMap((r) => [
          h2(r.tcId),
          p(`Title: ${r.title}`),
          p(`Error / actual: ${(r.error || r.actual || '').slice(0, 2000)}`),
          p(
            r.tcId === 'AUTH-001'
              ? 'Actions: .env credentials; quoted password; LoginPage selectors; trace zip; site captcha/2FA agar ho to automation adjust.'
              : 'Actions: (1) headed run. (2) data/payment-checks.js selectors/thresholds. (3) PAY-018 grid match. (4) agar auth/session: dubara AUTH-001 pass karo.'
          ),
        ])
      : [p('Is export mein koi failed row record nahi hui — ya to sab pass, ya results file empty / purani.')]),

    h1('4. Artefacts (screenshots + CSV)'),
    p(
      'Playwright HTML report: folder reports/html-report — index.html kholen; har test expand karke "screenshot" attachment (full-page) dekhen. Agar tests fail hon tab bhi setup row ki screenshot/trace useful hoti hai.'
    ),
    p(
      'Run results CSV: reports/payment-test-run.csv — columns include Screenshot_Relative_Paths (PNG paths test-results ke under). JSON: reports/payment-test-run.json.'
    ),
    p(
      'Planned catalog CSV: reports/payment-test-cases-catalog.csv — saare PAY-* cases + viewports + cross flows + AUTH row (documentation matrix).'
    ),
    p('Word output: reports/Payments-Module-QA-Report.docx (yeh file).'),
  ];

  const doc = new Document({ sections: [{ properties: {}, children }] });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const buf = await Packer.toBuffer(doc);
  try {
    fs.writeFileSync(out, buf);
    // eslint-disable-next-line no-console
    console.log('Wrote', out);
  } catch (e) {
    if (e && e.code === 'EBUSY') {
      const alt = path.join(path.dirname(out), `Payments-Module-QA-Report-${Date.now()}.docx`);
      fs.writeFileSync(alt, buf);
      // eslint-disable-next-line no-console
      console.log('Wrote', alt, '(original file locked — close Word and re-run)');
    } else throw e;
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
