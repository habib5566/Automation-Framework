# Email report 100% — step by step (Urdu)

Reports **habib.developer8899@gmail.com** par jati hain.

---

## Pehle scan error fix (1 minute)

Live page par:

1. **Scan API base** → **khali** (delete all)
2. Button: **Clear tunnel — use Vercel scan only**
3. Page **refresh**

Agar phir bhi red error: Vercel deploy check — `https://YOUR-APP.vercel.app/api/ping` browser me kholo → `{"ok":true}` aana chahiye.

---

## Email — Option A (recommended, ek bar)

### Step 1 — Google App Password
1. Gmail jis se **bhejna** hai us account me login
2. **2-Step Verification** ON karo
3. Open: https://myaccount.google.com/apppasswords
4. App: **Mail** → Generate → **16 character** copy (spaces hata do)

### Step 2 — Vercel variables
Vercel → Project → **Settings** → **Environment Variables** → **Production**:

| Name | Value |
|------|--------|
| `GO_LIVE_AUDIT_SMTP_USER` | `you@gmail.com` |
| `GO_LIVE_AUDIT_SMTP_PASS` | 16-char App Password |
| `GO_LIVE_AUDIT_EMAIL_FROM` | same `you@gmail.com` |

Save → **Deployments** → latest → **Redeploy**

### Step 3 — Test
1. Live site kholo
2. **Run quick scan** (koi URL)
3. Green: **Email — scan summary sent**
4. Inbox + **Spam** check karo

---

## Email — Option B (bina Vercel env)

Live page par:

1. **Sender Gmail** = jis account ka App Password hai
2. **Gmail App Password** = 16 chars
3. **Run watch now** ya **Run quick scan**

---

## Galat cheezein (mat karo)

- Normal Gmail password SMTP me — **fail**
- Purana ngrok URL Scan API base me — **Network Authentication Required**
- Redeploy ke bina env change — **email skip**

---

## Success check

Watch summary me: **Email sent: 16** (ya jitne brands) — **Skipped: 0**
