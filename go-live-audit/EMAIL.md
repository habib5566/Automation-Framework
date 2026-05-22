# Scan summary email (optional)

When the UI ticks **Email scan summary** and sends **`"sendEmail": true`**, the server emails a **full report** to the **To:** address below. By default that is **`reportEmail`** from the request (the **Report email** field — use the same Gmail address you want to receive the report), unless the deployer blocks UI recipients (see below).

1. **`reportEmail`** from the request body (the **Report email** field) — when the server allows it (see below), **or**
2. **`GO_LIVE_AUDIT_EMAIL_TO`** from the environment — fixed inbox if no UI address is used or UI sending is disabled.

For automation without the UI checkbox, **`GO_LIVE_AUDIT_EMAIL_ALWAYS=1`** still applies; recipient rules are the same.

## Who receives the mail? (`reportEmail` vs env)

| Situation | Recipient |
|-----------|-----------|
| **Report email** filled (valid format) | That address (default behaviour). |
| `GO_LIVE_AUDIT_EMAIL_TO` set, **Report email** empty or invalid | Server default inbox. |
| Public API where you must block arbitrary **To** | Set **`GO_LIVE_AUDIT_DISALLOW_UI_RECIPIENT=1`** — then only **`GO_LIVE_AUDIT_EMAIL_TO`** is used (no sending to whatever the user types). |

Optional: **`GO_LIVE_AUDIT_NOTIFY_TOKEN`** so only clients that know the secret can trigger email.

Nothing is sent without **SMTP** (`GO_LIVE_AUDIT_SMTP_HOST`, etc.) and a resolved **To** address per the table above.

**Gmail inbox:** If **Report email** ends with **`@gmail.com`** / **`@googlemail.com`**, the server **refuses** Mailpit-only SMTP so you are not fooled into thinking mail reached Gmail. Configure **`GO_LIVE_AUDIT_SMTP_USER`**, **`GO_LIVE_AUDIT_SMTP_PASS`** (App Password), **`GO_LIVE_AUDIT_EMAIL_FROM`** in `.env` (host is inferred). For Mailpit-only local tests with a Gmail-shaped address, set **`GO_LIVE_AUDIT_ALLOW_MAILPIT_FOR_GMAIL=1`**.

## Auto checklist hints (B01 / L01)

- **B01 (cross-browser):** If the server’s **current working directory** has a `playwright.config.{ts,js,mjs,cjs}` with **two or more Playwright `projects`** (or two different engine names like chromium + firefox), the scan sets **Pass** with an `[auto]` note — it means **browser automation is configured in that repo**, not that the URL you scanned was exercised in every browser. Otherwise it stays **Manual review** until you confirm.
- **L01 (layout / spacing):** **Pass** when the scanned HTML has a **viewport** meta tag **and** a **main** landmark (`<main>` or `role="main"`) **and** a **`<header>` or `<nav>`**. That only checks basic structure; alignment/spacing across the whole site still needs visual QA. If any piece is missing, it stays **Manual review**.

**Local shortcut:** if you run `npm run go-live:audit` on your PC and **`GO_LIVE_AUDIT_SMTP_HOST` is not set**, the server **defaults to `127.0.0.1:1025`** (Mailpit). In another terminal run **`npm run go-live:mailpit`**, then scan + email should work. Set **`GO_LIVE_AUDIT_NO_DEFAULT_SMTP=1`** to disable that default.

## Local testing (Mailpit — recommended)

1. Start Mailpit — from the repo root, in a **second** terminal:

   **`npm run go-live:mailpit:install`** once (downloads Mailpit into `tools/mailpit/` — no Docker), then **`npm run go-live:mailpit`** each time you need the catcher. If GitHub download fails with **certificate / TLS** errors, use **`npm run go-live:mailpit:install:insecure`** once instead (office SSL inspection only).

   If you use Docker instead: **`npm run go-live:mailpit:docker`** (same ports). Or install [Mailpit](https://github.com/axllent/mailpit) yourself and listen on **1025** (SMTP) and **8025** (web UI).

2. `.env` is loaded from, in order (later files override earlier keys): **`<repo>/.env`**, **`go-live-audit/.env`**, then **current working directory** `.env`. The `go-live:audit` npm script also **starts the server with `cwd` = package root**, so a root `.env` is always found even if your terminal was `cd`’d elsewhere.

3. In the repo root (or `go-live-audit/`), `.env` when you run `npm run go-live:audit`:

   ```env
   GO_LIVE_AUDIT_EMAIL_FROM=audit@localhost
   GO_LIVE_AUDIT_SMTP_HOST=127.0.0.1
   GO_LIVE_AUDIT_SMTP_PORT=1025
   GO_LIVE_AUDIT_SMTP_SECURE=0
   ```

   You do **not** need `GO_LIVE_AUDIT_EMAIL_TO` if you type your address in **Report email** (localhost SMTP enables UI recipient automatically).

4. `npm run go-live:audit` → `http://localhost:3940` → Site URL → **Report email** → tick **Email scan summary** → **Run quick scan**.

5. Open **http://localhost:8025** (Mailpit) and open the message — plain + HTML body with full details.

### One terminal (Docker)

From the repo root:

`npm run go-live:audit:with-mailpit`

Starts Mailpit (vendored / PATH / Docker), waits for port **1025**, then the audit UI. Stop with **Ctrl+C** (Mailpit stops too). If Mailpit never appears, run **`npm run go-live:mailpit:install`** first (Windows/macOS/Linux, no Docker).

### No Docker? (`docker` not recognized)

**`npm run go-live:mailpit`** uses, in order: **`tools/mailpit/mailpit(.exe)`** (after install), **Mailpit on your PATH**, then **Docker** if available.

1. **One-time (no Docker):** from the repo root run **`npm run go-live:mailpit:install`** — downloads Mailpit into `tools/mailpit/` (ignored by git). If TLS/certificate errors appear, run **`npm run go-live:mailpit:install:insecure`** once. Then **`npm run go-live:mailpit`** in a **second** terminal.

2. **Docker:** **`npm run go-live:mailpit`** still uses Docker if no local binary exists — or explicitly **`npm run go-live:mailpit:docker`**.

3. **Mailpit manually** — from [Mailpit releases](https://github.com/axllent/mailpit/releases) download the build for your OS, put `mailpit` / `mailpit.exe` on your PATH **or** set **`GO_LIVE_MAILPIT_BIN`** to the full path to the executable.

4. **Docker Desktop for Windows** — [install](https://docs.docker.com/desktop/install/windows-install/), restart, open Docker Desktop, confirm `docker --version` in a new terminal.

5. **Skip Mailpit** — configure real SMTP in `.env` (see **Real inbox (Gmail / Outlook)** below). Then you only need `npm run go-live:audit`; no local mail catcher.

### Mailpit not running?

If SMTP is the default **127.0.0.1:1025** and sending fails (e.g. `ECONNREFUSED`), the server still writes **`/last-scan-email-report.txt`** under `go-live-audit/public/` and the UI shows a **Download** link. Disable that behaviour with **`GO_LIVE_AUDIT_NO_EMAIL_FILE_FALLBACK=1`**.

## Real inbox (Gmail / Outlook)

Mailpit only **catches** mail on your machine — it does **not** deliver to Gmail or any real mailbox.

To email the scan summary to a real address:

1. In Google Account → Security → **2-Step Verification** → **App passwords**, create an app password for “Mail”.
2. In the repo root **`.env`** (same folder where you run `npm run go-live:audit`):

   ```env
   GO_LIVE_AUDIT_SMTP_PRESET=gmail
   GO_LIVE_AUDIT_SMTP_USER=you@gmail.com
   GO_LIVE_AUDIT_SMTP_PASS=xxxx xxxx xxxx xxxx
   GO_LIVE_AUDIT_EMAIL_FROM=you@gmail.com
   ```

   `GO_LIVE_AUDIT_SMTP_PRESET=gmail` sets host `smtp.gmail.com`, port **587**, `SECURE=0`. You can set **`GO_LIVE_AUDIT_SMTP_HOST`** yourself instead and omit the preset.

3. **Restart** the audit server after changing `.env`.
4. In the UI, fill **Report email** with the inbox you want and tick **Email scan summary**.

**Outlook / Microsoft 365:** use `GO_LIVE_AUDIT_SMTP_PRESET=outlook` (uses `smtp.office365.com:587`) plus your work account and password or app policy your org allows. If SMTP is blocked, use Mailpit locally or an allowed relay.

## Security (public or tunnel URL)

- **`GO_LIVE_AUDIT_DISALLOW_UI_RECIPIENT=1`** on public scan endpoints if you do not want arbitrary recipient addresses (then only **`GO_LIVE_AUDIT_EMAIL_TO`**).
- **`GO_LIVE_AUDIT_NOTIFY_TOKEN`** + UI **Notify token** so random clients cannot trigger mail.

## Skip one-off from the client

`"skipEmail": true` in the JSON body suppresses email for that request.

## Vercel / serverless

Configure SMTP. If users type their own **Report email**, no extra flag is needed unless you set **`GO_LIVE_AUDIT_DISALLOW_UI_RECIPIENT=1`**. The handler **awaits** SMTP when `sendEmail` is true.

## Env reference

| Variable | Meaning |
|----------|---------|
| `GO_LIVE_AUDIT_EMAIL_TO` | Fallback recipient if **Report email** is empty or invalid |
| `GO_LIVE_AUDIT_DISALLOW_UI_RECIPIENT` | `1` = never send to **reportEmail** from the body; only **`GO_LIVE_AUDIT_EMAIL_TO`** |
| `GO_LIVE_AUDIT_EMAIL_ALWAYS` | `1` = email without UI `sendEmail` (automation) |
| `GO_LIVE_AUDIT_EMAIL_FROM` | From address |
| `GO_LIVE_AUDIT_SMTP_PRESET` | `gmail` or `outlook` — sets default host/port when **`GO_LIVE_AUDIT_SMTP_HOST`** is unset; you still need **`GO_LIVE_AUDIT_SMTP_USER`** / **`GO_LIVE_AUDIT_SMTP_PASS`** |
| `GO_LIVE_AUDIT_SMTP_HOST` / `PORT` / `SECURE` / `USER` / `PASS` | SMTP |
| `GO_LIVE_AUDIT_SMTP_TLS_REJECT_UNAUTHORIZED` | `0` dev only |
| `GO_LIVE_AUDIT_NOTIFY_TOKEN` | If set, body must include matching `notifyToken` |
| `GO_LIVE_AUDIT_NO_EMAIL_FILE_FALLBACK` | `1` = do not write `last-scan-email-report.txt` when SMTP send fails |

Dependency: **`nodemailer`**.

## If `npm install` fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`

Your network is intercepting HTTPS (corporate proxy / SSL inspection). Fix the trust store (install your org’s root CA into Windows), or try once with Node using the system CA store, for example in PowerShell:

`$env:NODE_OPTIONS='--use-system-ca'; npm install`

Only use weaker TLS workarounds if your security policy allows it.
