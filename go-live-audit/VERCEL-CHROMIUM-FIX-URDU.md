# Vercel par local jaisa scan — Chromium fix (Urdu)

**Problem:** Local + tunnel = sahi. Vercel bina tunnel = console/browser fail (`libnss3.so`).

**Reason:** Live site abhi **Node 24** + Chromium pack galat detect ho raha tha. Code fix + Vercel settings chahiye.

---

## Tumhari side (5 minute) — zaroori

### 1) Git push + Redeploy

```powershell
cd D:\Automation-Framework
git add .
git commit -m "fix: Vercel Chromium node22 libnss3"
git push
```

Vercel → **Deployments** → latest → **Redeploy** (Production).

### 2) Vercel Dashboard → Environment Variables (Production)

| Name | Value |
|------|--------|
| `AWS_LAMBDA_JS_RUNTIME` | `nodejs22.x` |
| `GO_LIVE_AUDIT_USE_SERVERLESS_CHROMIUM` | `1` |

(Already in `vercel.json` bhi hai — Dashboard mein bhi rakho.)

### 3) Fluid Compute **OFF** (important)

**Settings → Functions → Fluid Compute → Disabled**

ON rehne se Chromium `libnss3` error aata hai (Sparticuz/chromium issue).

### 4) Deployment Protection OFF

Production link public ho.

### 5) Test after redeploy

Incognito:

`https://<project>.vercel.app/api/runtime`

`node` should be **v22.x** (not v24).

Phir scan — result mein:

`scanMeta.consoleCapture` = **`playwright-vercel`** (not `playwright-vercel-failed`).

---

## Page use

- **Scan API base = khali** (tunnel mat lagao link share ke liye)
- Brand + URL → Run quick scan

---

## Agar ab bhi fail

1. Confirm **Redeploy** hua (purana deploy chal raha ho sakta hai)
2. `api/runtime` → `node` version check
3. Last option for 100% local parity: tunnel (sirf tumhare PC par, clients ko mat do)

---

## Honest

- **Bina tunnel link share** = Vercel Chromium theek hona chahiye (steps upar)
- **Tunnel** = tab bhi jab Vercel console bilkul local jaisa na ho
