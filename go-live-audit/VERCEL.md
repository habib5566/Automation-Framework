# Deploy Go-Live Audit on Vercel

This repo serves the checklist UI from `public/` (copied at build time from `go-live-audit/public`) and runs **`POST /api/scan`** as a serverless function (`api/scan.js`).

## Fix “Error: 404” on Run quick scan

Almost always **Vercel project settings**, not the code:

| Setting | Correct value |
|--------|----------------|
| **Root Directory** | **Empty** (repo root). Not `go-live-audit`, not `go-live-audit/public`, not `public`. |
| **Output Directory** | **Empty**. If you set `public`, Vercel often deploys **static-only** and **`/api/*` returns 404**. |
| **Framework Preset** | **Other** (or “Other” with no framework auto-detect overriding output). |
| **Build Command** | `npm run build` |

After fixing, **Redeploy**. Quick test in the browser: open **`/api/ping`** — you should see JSON `{"ok":true,...}`. If `/api/ping` is also 404, the Functions layer is still not deployed (check Root / Output again). Optional: **`GET /api/runtime`** returns the scanner’s Node/npm, `package.json` version, pinned Playwright/nodemailer/dotenv versions, and the **current Node.js LTS** line from nodejs.org (for comparison with `process.version`).

Build copies scan logic into **`api/_scan-core.js`** (generated, gitignored) so the serverless bundle includes all Node code.

## Fix “Failed to fetch git submodules” / build fails at `npm install`

If the build log shows **Failed to fetch one or more git submodules**, the repo had broken submodule links (`go-live-audit` / `Auto-frame` without `.gitmodules`). Fix (once) in the project folder:

```bash
# Remove nested .git folders (if present)
rm -rf go-live-audit/.git go-live-audit/live-checklist/.git Auto-frame/.git
git rm --cached -f Auto-frame go-live-audit
git add go-live-audit/ vercel.json .gitignore .vercelignore
git commit -m "fix: track go-live-audit as normal files for Vercel deploy"
git push
```

After push, **Redeploy** on Vercel.

## Steps

1. Push this repo to GitHub (or use Vercel CLI with this folder).
2. In [Vercel](https://vercel.com) → **Add New Project** → import the repo.
3. Use defaults: **Build Command** `npm run build`, **Output** is automatic (static `public/` + `api/`).
4. Deploy. Your live URL will look like `https://<project>.vercel.app`.

## Deployment Protection (login before site opens)

Agar link dene par **Vercel login / permission** aata hai, yeh code bug nahi — **Deployment Protection** ON hai.

### Fix — kisi ko bhi bina login (recommended)

1. [vercel.com/dashboard](https://vercel.com/dashboard) → apna project (e.g. `automation-checklists`)
2. **Settings** → **Deployment Protection**
3. **Production** section:
   - **Vercel Authentication** → **Off** (ya protection **None**)
4. **Preview** section (agar preview link share karte ho):
   - **Vercel Authentication** → **Off**, **ya**
   - **Standard Protection** rakho lekin logon ko sirf **Production URL** do (neeche)
5. **Save** — koi redeploy zaroori nahi, settings turant lagti hain

### Kaunsi link share karo

| Link type | Login? |
|-----------|--------|
| **Production** — `https://<project>.vercel.app` (Deployments → Production → Visit) | Hobby par aksar **public** |
| Preview — `…-git-….vercel.app` | Aksar **login** mangta hai |

**Seedhi baat:** Clients ko **Production** URL copy karo, preview URL nahi.

### Team default (optional)

**Team Settings** → **Deployment Protection** → default **None** for new projects — taake naye projects par dubara protection na lage.

### Agar protection band nahi kar sakte (Pro / policy)

- **Shareable Links** (Deployment Protection → generate link) — ek public link jisme login skip ho  
- Docs: [Deployment Protection](https://vercel.com/docs/deployment-protection)

Without public access, **`POST /api/scan` is also blocked** — scan fail ho sakta hai even if UI loads after you log in.

## Console errors on live (Vercel)

Live uses **@sparticuz/chromium** + **puppeteer-core** (not your PC’s `ms-playwright`). `vercel.json` sets:

- `GO_LIVE_AUDIT_USE_SERVERLESS_CHROMIUM=1`
- `AWS_LAMBDA_JS_RUNTIME=nodejs22.x` (fixes `libnss3.so` on Vercel Fluid Compute)
- `includeFiles` for `node_modules/@sparticuz/chromium/**` on `api/scan.js`

If Chromium still fails, the scan adds **deep HTTP console** (script hints, `.mp4` probes, `applyLogo`-style errors) so console/performance are closer to local.

**Scan API base** (tunnel): Vercel **proxies** `POST /api/scan` to your tunnel URL — paste `https://….ngrok-free.app`, run `npm run go-live:audit:tunnel` on your PC.

After deploy, `scanMeta.consoleCapture` should be **`playwright-vercel`** when logs exist, not `playwright-vercel-failed`.

**Local PC:** do not put `VERCEL=1` in `.env` unless you intend serverless mode locally. Use `npm run go-live:audit` without that, or set `GO_LIVE_AUDIT_FORCE_LOCAL_PLAYWRIGHT=1`.

**Local shows “site down” but Vercel shows “up”?** Your PC may block HTTPS (corporate antivirus: `UNABLE_TO_VERIFY_LEAF_SIGNATURE`). The scanner auto-retries once with relaxed TLS on localhost so results match Vercel. Permanent local fix: `npm run go-live:audit:insecure-tls` (trusted network only).

## Email after scan (required for inbox delivery)

See **`VERCEL-EMAIL-SETUP.md`** — add `GO_LIVE_AUDIT_SMTP_USER` + `GO_LIVE_AUDIT_SMTP_PASS` (Google App Password) in Vercel, then **Redeploy**.  
`GO_LIVE_AUDIT_EMAIL_ALWAYS=1` is already in `vercel.json` → reports go to **habib.developer8899@gmail.com**.

## Other environment variables (optional)

| Variable | When |
|----------|------|
| `GO_LIVE_AUDIT_TLS_INSECURE=1` | Only if outbound scans hit TLS verify errors you accept (MITM risk on untrusted networks). |

## After deploy

Open your Vercel URL, enter a **public** `https://…` site, and run **Run quick scan**.  
Same-origin `fetch('/api/scan')` works on Vercel.

## Static UI only + tunnel backend

If you deployed **only** the HTML (no `api/scan` on Vercel), run on your PC:

`npm run go-live:audit:tunnel`

Then in the checklist page set **Scan API base** to the tunnel `https://…` URL. Details: **TUNNEL.md**.

## Note

We cannot create the link for you — it is tied to **your** Vercel account and project name. After the first successful deploy, copy the **Production** URL from the Vercel dashboard.
