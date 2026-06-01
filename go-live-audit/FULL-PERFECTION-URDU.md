# Full perfection — link share (local jaisa, bina tunnel)

Yeh checklist tumhein **100% link share** ke liye hai: koi tunnel nahi, PC band, client ko **local jaisa** result.

---

## Step 1 — Vercel deploy (code)

```powershell
cd D:\Automation-Framework
git add .
git commit -m "feat: full perfection — blob reports, batch watch, no tunnel"
git push
```

Vercel → **Redeploy** (Production).

| Setting | Value |
|--------|--------|
| Root Directory | **khali** |
| Output Directory | **khali** |
| Build Command | `npm run build` |

Test: `https://<project>.vercel.app/api/ping` → `{"ok":true,...}`

---

## Step 2 — Link public (login band)

**Settings → Deployment Protection → Production → Vercel Authentication → Off**

Sirf **Production URL** bhejo: `https://<project>.vercel.app`

---

## Step 3 — Vercel Blob (brand reports server par)

Bina iske brand page par report **sirf usi browser** mein rehti hai jahan scan hua.

1. Vercel Dashboard → project → **Storage** tab  
2. **Create Database** → **Blob** → Create  
3. Connect to project → **Production** (env auto: `BLOB_READ_WRITE_TOKEN`)  
4. **Redeploy**

Test: scan with Brand name → **All brands** → open brand → poora dashboard (dusre browser / phone par bhi).

---

## Step 4 — Email (Gmail App Password)

**Settings → Environment Variables → Production:**

| Name | Value |
|------|--------|
| `GO_LIVE_AUDIT_SMTP_USER` | tumhara Gmail (sender) |
| `GO_LIVE_AUDIT_SMTP_PASS` | **16-char Google App Password** (normal password NAHI) |
| `GO_LIVE_AUDIT_EMAIL_FROM` | same Gmail |

`vercel.json` mein pehle se: `GO_LIVE_AUDIT_EMAIL_ALWAYS=1`, alert inbox.

**Redeploy** after env change.

Local par bhi: `npm run go-live:email-setup` → restart `npm run go-live:audit`

---

## Step 5 — Page use (tum + client)

- **Scan API base** = **khali** (Vercel par auto clear)  
- **Brand name** + URL → **Run quick scan**  
- **All brands** → card → brand page  
- **Scan this brand again** = scan start (tunnel nahi)

---

## Kya milta hai (local vs link)

| Feature | Local | Link (sab steps ke baad) |
|---------|-------|---------------------------|
| Quick scan | ✅ | ✅ Vercel Chromium |
| Console errors | ✅ Playwright PC | ✅ Vercel + deep HTTP |
| Brand pages | ✅ | ✅ Blob + API |
| Email reports | ✅ .env / form | ✅ Vercel env / form |
| Watch all brands | ✅ fast | ✅ 1-by-1 (tab open) |
| Tunnel | optional | ❌ **not needed** |

---

## Agar kuch kam ho

| Problem | Fix |
|---------|-----|
| Login mangta hai | Deployment Protection Off |
| Scan 404 | Root/Output khali, redeploy |
| Brand page khali | Vercel Blob + redeploy |
| Email fail | App Password in env, redeploy |
| Watch Failed to fetch | Latest code push (batch watch) |

---

## Optional: 100% console = localhost

Sirf agar **har** console line chahiye: tunnel (advanced). **Clients ko link mat do** jab tunnel use karo.

Normal clients → **FULL-PERFECTION steps above** = recommended.
