# Vercel par live — step by step (Urdu + English)

## Pehle samjho: Vercel par kya chalega?

| Feature | Vercel par? | Note |
|---------|-------------|------|
| Checklist UI + **Run quick scan** | ✅ | `POST /api/scan` |
| Security monitor (malware, hack, leak) | ✅ | HTML scan |
| **Vulnerabilities & risks** panel | ✅ | Scan JSON se |
| Site stack (Laravel, PHP, WP…) | ✅ | |
| Brand performance matrix | ✅ | |
| **Email** report | ✅ | Vercel **Environment Variables** + Gmail App Password |
| HTML hints (page errors) | ✅ | |
| **Real browser console errors** (Playwright) | ❌ | Serverless par Chromium nahi — **localhost** ya **Render** use karo |
| **Save brand watch** + **Run watch now** | ❌ | Sirf full server (`npm run go-live:audit` / **Render**) |
| **Watch har 30 min** (daemon) | ❌ | Always-on server chahiye |

**100% features chahiye?** → **Render** (`render.yaml`) ya PC par `npm run go-live:audit` + optional tunnel.  
**Public link + zyada tar scans?** → **Vercel** (neeche steps).

---

## Step 1 — GitHub par poora repo push

Sirf `index.html` folder **nahi** — poora `Automation-Framework` repo:

- `package.json`, `vercel.json`, `api/scan.js`
- `scripts/`, `go-live-audit/`
- `npm run build` chal sake

---

## Step 2 — Vercel project settings (404 se bachne ke liye)

[vercel.com/new](https://vercel.com/new) → repo import.

| Setting | Value |
|---------|--------|
| **Root Directory** | *(khali — repo root)* |
| **Output Directory** | *(khali — mat set `public` only)* |
| **Framework** | **Other** |
| **Build Command** | `npm run build` |
| **Install Command** | `npm install` |

**Deploy** → URL milegi: `https://<project-name>.vercel.app`

Test: browser mein kholo  
`https://<project>.vercel.app/api/ping`  
→ JSON `{"ok":true,...}` aana chahiye.

---

## Step 3 — Deployment Protection band / public

**Settings** → **Deployment Protection**  
Preview/Production par agar login forced hai to **`/api/scan` bhi block** ho jata hai.

- Production domain **public** rakho, **ya**
- Protection bypass for automation (Vercel docs)

---

## Step 4 — Environment variables (email ke liye zaroori)

**Settings** → **Environment Variables** → **Production** (aur Preview agar chaho):

| Name | Value |
|------|--------|
| `GO_LIVE_AUDIT_ALERT_EMAIL` | `habib.developer8899@gmail.com` |
| `GO_LIVE_AUDIT_SMTP_USER` | `habib.developer8899@gmail.com` |
| `GO_LIVE_AUDIT_SMTP_PASS` | Google **App Password** (16 chars, no `@`) |
| `GO_LIVE_AUDIT_EMAIL_FROM` | `habib.developer8899@gmail.com` |
| `GO_LIVE_AUDIT_SMTP_PRESET` | `gmail` |

Optional:

| Name | When |
|------|------|
| `GO_LIVE_AUDIT_TLS_INSECURE=1` | SMTP TLS error on scan/email |
| `GO_LIVE_AUDIT_ALLOW_UI_SMTP=1` | Already in `vercel.json` — form se App Password bhej sakte ho |

**Redeploy** after saving env vars.

---

## Step 5 — Live site par checklist use

1. Kholo: `https://<project>.vercel.app`
2. **Scan API base** → **khali** rakho (same-origin `/api/scan`)
3. Site URL: public `https://…`
4. **Email scan summary** ✓
5. **Run quick scan**

Panels: Vulnerabilities, Security, Console (HTML-only on Vercel), Stack, Matrix.

Email: banner / `emailReport` — `sent` ya error; inbox **+ spam**.

---

## Step 6 — Console errors + brand watch (Vercel ke bahar)

### A) Console (Playwright)

PC par:

```bash
cd D:\Automation-Framework
npx playwright install chromium
npm run go-live:audit
```

`http://localhost:3940` → full console capture.

### B) Brand watch + “Run watch now”

**Render** (free):

1. [dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint** → repo
2. `render.yaml` apply → URL milegi `https://go-live-audit-….onrender.com`
3. Wahan bhi email env vars same daalo

**Ya** Vercel UI + tunnel:

```bash
npm run go-live:audit:tunnel
```

Vercel page par **Scan API base** = tunnel `https://….ngrok-free.app` (real URL, `xxxx` placeholder nahi).

---

## Step 7 — Har deploy ke baad

```bash
git push
```

Vercel auto-redeploy. Agar code change ho to `npm run build` locally test:

```bash
npm run build
```

---

## Quick checklist (deploy verify)

- [ ] `/api/ping` → JSON ok  
- [ ] Scan API base **empty** on Vercel URL  
- [ ] Quick scan → vulnerabilities panel updates  
- [ ] Gmail env vars set → email `sent`  
- [ ] Console full capture → localhost **or** Render, not Vercel alone  
- [ ] Watch all brands → Render **or** local server  

---

Ziyada: **VERCEL.md**, **LIVE.md**, **KAISE-USE-KAREIN.md**
