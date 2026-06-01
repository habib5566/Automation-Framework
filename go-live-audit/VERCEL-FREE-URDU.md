# Vercel free — link share (bina tunnel)

**Pehle yeh padho:** `VERCEL-NO-TUNNEL-URDU.md` — **link dene ke liye tunnel zaroori nahi.**

**Default (link share):** Vercel par **Scan API base khali** → scan `https://<project>.vercel.app/api/scan` par chalta hai. PC band, tunnel band.

---

## Optional: bilkul local jaisa console (tunnel)

Sirf jab tumhein **100% same** result chahiye jaise `localhost:3940`. Is case mein link **clients ko mat do** jab tak tunnel on ho.

## 3 steps (tunnel — optional, advanced)

### 1) PC par tunnel chalao

PowerShell, repo root:

```powershell
cd D:\Automation-Framework
npm run go-live:audit:tunnel
```

**Bina ngrok account** (localtunnel):

```powershell
$env:GO_LIVE_AUDIT_TUNNEL='localtunnel'
npm run go-live:audit:tunnel
```

Terminal mein **`https://....`** URL aayega — copy karo.  
**Yeh window band mat karo** jab tak scan khatam na ho.

### 2) Vercel page kholo

Example: `https://automation-checklists.vercel.app`

### 3) Scan API base + scan

- **Scan API base** = sirf tunnel URL (e.g. `https://xyz.ngrok-free.app`) — **slash end par nahi**
- **Site URL** = `https://www.designcentura.com/`
- **Run quick scan**

Result: **6 console errors**, `local-playwright`, performance % — **jaise localhost:3940**.

`Scan API base` browser mein **save** rehta hai (localStorage) — agli dafa sirf tunnel dubara chalao, purana URL tab tak kaam kare jab tunnel same ho.

---

## Kab kya use karo

| Setup | Cost | Console / performance |
|--------|------|------------------------|
| **Vercel + tunnel (yeh)** | Free | ✅ Same as local |
| Vercel, Scan API base **khali** | Free | ❌ Browser nahi — kam detail |
| Render | Free plan* / card verify | ✅ 24/7 server (PC off) |

\* Render par service banate waqt **Instance type = Free** choose karo — monthly paid plan mat lo.

---

## Email (Vercel par)

Tunnel scan par email **PC ke SMTP/env** se bhej sakta hai agar local `npm run go-live:email-setup` ho — ya scan form mein Gmail App Password.

Vercel env vars sirf tab chahiye jab **Scan API base khali** ho aur scan Vercel serverless par ho.

---

## Agar tunnel error de

- `npm run go-live:audit` pehle test: `http://localhost:3940`
- Office TLS: `npm run go-live:audit:insecure-tls` phir tunnel
- Ziyada: `TUNNEL.md`
