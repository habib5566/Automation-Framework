# Automatic brand security watch

Monitors all brands in `go-live-audit/data/brands-watch.json` like a lightweight SOC alert:

- **Malware / miners** (crypto scripts, obfuscated JS)
- **Web shells** (PHP shell signatures)
- **Defacement** (“hacked by”, etc.)
- **Leaked secrets** (.env in HTML)
- **Site down** (HTTP / DNS)
- **Page change** vs last **clean** scan (possible hack or deploy)

Alerts go to **habib.developer8899@gmail.com** when threats are detected (if Gmail App Password is configured).

## Setup

1. `npm run go-live:email-setup` — Gmail App Password in `.env`
2. `npm run go-live:audit` — open UI, add brands (checkbox **Save brand for automatic security watch**)
3. Or edit `go-live-audit/data/brands-watch.json`

## Run automation

```bash
# Scan all brands once
npm run go-live:watch

# Every 30 minutes (change with GO_LIVE_WATCH_INTERVAL_MIN=15)
npm run go-live:watch:daemon
```

Or in the UI: **Run watch now (all brands)**.

## Windows Task Scheduler

Create a task that runs every 15 minutes:

`node D:\Automation-Framework\scripts\go-live-audit-watch-runner.cjs`

Working directory: `D:\Automation-Framework`

## Notes

- Not a replacement for full antivirus/WAF — best-effort HTTP/HTML checks.
- First **clean** scan saves a baseline; later changes trigger warnings.
- Local server required for watch file + SMTP (use Render/Railway with env vars for 24/7).
