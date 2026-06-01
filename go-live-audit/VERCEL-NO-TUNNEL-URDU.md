# Bina tunnel — sirf link share karo (Urdu)

**Problem:** Tum sochte ho har scan ke liye PC par `npm run go-live:audit:tunnel` chalana zaroori hai.

**Asal baat:** Agar poora project **Vercel** par deploy hai (`api/scan.js` + `npm run build`), to **link wale logon ko tunnel ki zaroorat nahi** — na tumhein link bhejte waqt, na unhein open karte waqt.

---

## Tum kya karo (ek dafa)

### 1) Vercel deploy sahi ho

| Setting | Value |
|--------|--------|
| Root Directory | **khali** |
| Output Directory | **khali** |
| Build Command | `npm run build` |

Git push → Vercel **Redeploy**.

### 2) Link public ho (login na ho)

**Settings → Deployment Protection → Production → Vercel Authentication → Off**

### 3) Sirf Production URL bhejo

`https://<project>.vercel.app`  
(Preview URL mat bhejo — wahan login lag sakta hai)

### 4) Page par Scan API base **khali** rakho

- Field ab **collapsed** hai: *“Scan API base (tunnel — only if…)”*
- **Khali chhoro** — scan Vercel par chalega
- Purana ngrok URL agar save tha, page ab Vercel par use **auto clear** karti hai

---

## Jo link tum bhejoge — wo kya karega

1. Link khole (bina tumhare PC ke)
2. Site URL + Brand name daale
3. **Run quick scan**
4. Ho gaya — **tunnel band**, PC off, sab theek

---

## Tunnel kab chahiye?

Sirf jab **tum khud** chahte ho ke Vercel ki UI se scan **bilkul 100% waisa** ho jaise `localhost:3940` (har console line, har detail).

| Setup | PC / tunnel | Link share |
|--------|-------------|------------|
| **Vercel + Scan API base khali** | ❌ Nahi | ✅ Best |
| Vercel + tunnel paste | ✅ Hamesha on | ❌ Link wale ke liye mat karo |
| `npm run go-live:audit` localhost | Sirf tumhara PC | Sirf tumhare network |

---

## Email (bina tunnel)

Vercel par email ke liye **Environment Variables** (App Password):

- `GO_LIVE_AUDIT_SMTP_USER`
- `GO_LIVE_AUDIT_SMTP_PASS`
- `GO_LIVE_AUDIT_EMAIL_FROM`

Details: `VERCEL-EMAIL-SETUP.md` → **Redeploy**.

---

## Test

Incognito:

1. `https://<project>.vercel.app/api/ping` → `{"ok":true,...}`
2. Same site par scan chalao — **Scan API base khali**

Dono OK = tunnel ki zaroorat nahi.
