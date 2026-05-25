# Live URL (perfect UI + scan — same origin)

**Free + local jaisa scan?** → **Option A (Vercel + tunnel)** — `VERCEL-FREE-URDU.md`.  
Vercel **khali** Scan API base = light scan only (no real browser).

---

## Option A — Vercel free + tunnel (recommended, $0)

1. Deploy checklist on **Vercel** (free) — `VERCEL.md`
2. PC par: `npm run go-live:audit:tunnel` → copy `https://…` URL
3. Vercel page → **Scan API base** paste → scan

Detail: **VERCEL-FREE-URDU.md** | **TUNNEL.md**

---

## Option B — Vercel only (light scan — console often empty/wrong)

1. GitHub par **poora** `Automation-Framework` repo push karo (sirf `index.html` folder mat — chahiye `api/scan.js`, `vercel.json`, `package.json`).
2. [vercel.com/new](https://vercel.com/new) → repo import → **Deploy** (build: `npm run build`).
3. Jo **`https://<project>.vercel.app`** mile — wohi **final link**. Page par **Scan API base khali** chhodo.

Ziyada detail: **VERCEL.md**.

---

## Option C — Render (24/7, PC off — may ask card for Free tier)

**RENDER-LIVE-URDU.md** — choose **Free** instance, not paid Starter.

---

## Option D — Sirf laptop (no public link)

```bash
npm run go-live:audit
```

Browser: **http://localhost:3940**

---

## Galati jo aksar hoti hai

- Vercel par **sirf frontend** files daali → scan fail / “could not finish” → **poora repo** deploy karo **ya** tunnel + **Scan API base** (**TUNNEL.md**).

---

**Seedhi baat:** “Live link” = **Vercel** ya **Render** deploy ke baad jo URL dashboard dikhata hai — woh copy karo; main us URL ko generate nahi kar sakta bina tumhare account ke.
