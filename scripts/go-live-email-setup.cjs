'use strict';
/**
 * One-time Gmail SMTP setup — writes <repo>/.env (or updates Gmail lines).
 * Usage:
 *   npm run go-live:email-setup
 *   npm run go-live:email-setup -- you@gmail.com your-app-password
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');

function ask(rl, q) {
  return new Promise((resolve) => rl.question(q, resolve));
}

function upsertEnvLines(existing, pairs) {
  const lines = existing ? existing.replace(/\r\n/g, '\n').split('\n') : [];
  const keys = new Set(pairs.map(([k]) => k));
  const out = [];
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && keys.has(m[1])) continue;
    out.push(line);
  }
  if (out.length && out[out.length - 1] !== '') out.push('');
  out.push('# Go-Live Audit — Gmail report (added by npm run go-live:email-setup)');
  for (const [k, v] of pairs) {
    out.push(k + '=' + v);
  }
  return out.join('\n') + '\n';
}

async function main() {
  const argv = process.argv.slice(2).filter((a) => a !== '--');
  let gmail = argv[0] ? String(argv[0]).trim() : '';
  let appPass = argv[1] ? String(argv[1]).trim().replace(/\s+/g, '') : '';

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (!gmail) {
      gmail = (await ask(rl, 'Your Gmail address (e.g. you@gmail.com): ')).trim();
    }
    if (!gmail.includes('@')) {
      console.error('Invalid email.');
      process.exit(1);
    }
    if (!appPass) {
      console.log('');
      console.log('Google App Password: https://myaccount.google.com/apppasswords');
      console.log('(Need 2-Step Verification ON. Create App password for "Mail".)');
      appPass = (await ask(rl, 'Paste 16-character App Password: ')).trim().replace(/\s+/g, '');
    }
    if (appPass.length < 8) {
      console.error('App Password too short.');
      process.exit(1);
    }
    if (appPass.includes('@') || appPass.length < 16) {
      console.error('');
      console.error('That looks like your normal Gmail password, not a Google App Password.');
      console.error('App Passwords are 16 letters/numbers only (no @). Create one at:');
      console.error('  https://myaccount.google.com/apppasswords');
      console.error('(2-Step Verification must be ON.)');
      process.exit(1);
    }

    const alertInbox = 'habib.developer8899@gmail.com';
    const pairs = [
      ['GO_LIVE_AUDIT_ALERT_EMAIL', alertInbox],
      ['GO_LIVE_AUDIT_SMTP_USER', gmail],
      ['GO_LIVE_AUDIT_SMTP_PASS', appPass],
      ['GO_LIVE_AUDIT_EMAIL_FROM', gmail],
      ['GO_LIVE_AUDIT_SMTP_PRESET', 'gmail'],
    ];

    let base = '';
    if (fs.existsSync(envPath)) {
      base = fs.readFileSync(envPath, 'utf8');
    } else if (fs.existsSync(examplePath)) {
      base = fs.readFileSync(examplePath, 'utf8');
      console.log('Created .env from .env.example + Gmail lines.');
    } else {
      console.log('Creating new .env with Gmail lines.');
    }

    fs.writeFileSync(envPath, upsertEnvLines(base, pairs), 'utf8');
    console.log('');
    console.log('Saved:', envPath);
    console.log('Next: stop the audit server (Ctrl+C), then run: npm run go-live:audit');
    console.log('Scan reports will be sent to:', alertInbox);
    console.log('SMTP sends as:', gmail, '(must match Google App Password account)');
  } finally {
    rl.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
