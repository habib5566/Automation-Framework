# Email on Vercel (scan → habib.developer8899@gmail.com)

After every scan, the app tries to email a **full report**. **Danger** scans (security critical, site down, many errors) also trigger email even if you forget the checkbox.

## One-time setup (5 minutes)

### 1) Google App Password

1. Gmail account that will **send** mail (your work Gmail).
2. [Google App passwords](https://myaccount.google.com/apppasswords) → create for **Mail** → copy **16 characters** (no spaces).

### 2) Local `.env` (optional, for localhost)

```bash
npm run go-live:email-setup
```

Follow prompts — writes `.env` and prints the same vars for Vercel.

### 3) Vercel Environment Variables

**Project → Settings → Environment Variables → Production:**

| Name | Value |
|------|--------|
| `GO_LIVE_AUDIT_SMTP_USER` | Your Gmail (e.g. `you@gmail.com`) |
| `GO_LIVE_AUDIT_SMTP_PASS` | 16-char App Password |
| `GO_LIVE_AUDIT_EMAIL_FROM` | Same Gmail as `SMTP_USER` |
| `GO_LIVE_AUDIT_ALERT_EMAIL` | `habib.developer8899@gmail.com` |

Already in `vercel.json` (no need to add):

- `GO_LIVE_AUDIT_EMAIL_ALWAYS=1` — email after **every** scan
- `GO_LIVE_AUDIT_SMTP_PRESET=gmail`
- `GO_LIVE_AUDIT_ALLOW_UI_SMTP=1` — or paste App Password in the UI form

**Redeploy** after saving variables.

### 4) Test

1. Open Vercel URL → **Email scan summary** checked (default).
2. Run quick scan on any site.
3. Green banner: **Email — scan summary sent**.
4. Check **habib.developer8899@gmail.com** inbox + spam.

## Without Vercel env (quick test)

Paste **Gmail App Password** in the form on the scan page (saved in **this browser only**). Scan again.

## Auto danger alerts

Email is sent automatically when:

- Security monitor says **alert** / **critical**
- Site **unreachable** or scan failed
- **Critical** vulnerabilities or multiple **high**
- **4+** console/page errors
- Overall summary **bad**

Disable only with `GO_LIVE_AUDIT_ALERT_ON_THREAT=0` on the server.
