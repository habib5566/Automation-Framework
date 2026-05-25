# Live par scan bilkul local jaisa (Render) — optional

**Payment / card nahi dena?** → **VERCEL-FREE-URDU.md** (Vercel UI + `npm run go-live:audit:tunnel` on your PC) — **100% free**.

**Render** tab jab chahiye jab PC **band** ho aur phir bhi 24/7 full scan chahiye. Sign-up par kabhi **card verify** ($1 refund) mang sakta hai — service banate waqt **Instance type = Free** select karo (Starter $7 **nahi**).

**Vercel khali Scan API base** par real browser (Playwright) **nahi** chal sakta.  
**Solution (paid nahi):** tunnel. **Solution (24/7):** Render Free instance.

---

## Steps (5 minute)

1. Code GitHub par push karo (poora `Automation-Framework` repo).
2. [dashboard.render.com](https://dashboard.render.com) → sign up (GitHub).
3. **New +** → **Blueprint** → apna repo select.
4. `render.yaml` dikhe → **Apply**.
5. Deploy **Live** hone tak wait (5–10 min, pehli dafa Playwright download).
6. URL copy karo: `https://go-live-audit-xxxx.onrender.com`
7. Browser mein kholo — **Scan API base khali** rakho.
8. Site scan karo — console + performance **local jaisa** hona chahiye (`local-playwright` / `playwright`).

---

## Email (optional)

Render → Service → **Environment**:

| Key | Value |
|-----|--------|
| `GO_LIVE_AUDIT_SMTP_PRESET` | `gmail` |
| `GO_LIVE_AUDIT_SMTP_USER` | tumhara Gmail |
| `GO_LIVE_AUDIT_SMTP_PASS` | 16-char App Password |
| `GO_LIVE_AUDIT_ALERT_EMAIL` | `habib.developer8899@gmail.com` |

Save → **Manual Deploy**.

---

## Vercel vs Render

| | Vercel | Render (yeh use karo) |
|---|--------|------------------------|
| Console (applyLogo, videos) | ❌ Browser fail | ✅ Real Playwright |
| Performance % | Approximate | ✅ Same formula + real console |
| Deep detail | HTTP only | ✅ Full scan |

Vercel sirf checklist UI ke liye theek hai; **deep scan ke liye Render link use karo.**

---

## Agar PC on ho (temporary)

Vercel UI + local scan:

```bash
npm run go-live:audit:tunnel
```

Tunnel URL → Vercel page → **Scan API base** paste.
