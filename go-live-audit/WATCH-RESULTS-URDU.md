# Watch all brands — result kahan dikhega? (Urdu)

## Problem
- Local par scan sahi, Vercel par `playwright-vercel-failed` → result local jaisa nahi
- **Run watch now** ke baad pata nahi chalta kya hua — email bhi nahi

## Ab UI par kya dikhega
Watch khatam hone ke baad **Automatic watch** ke neeche **green/grey panel**:
- Kitne brands scan hue
- Har brand: OK / Email sent ya Skipped / Console status / Pass-Fail
- Email nahi gayi to **sari wajah** likhi hogi

Page refresh ke baad bhi **last watch summary** dikhe sakti hai.

## Email kyun nahi aati
Screenshot: **Email skipped** — Gmail **App Password** (16 char) chahiye, normal password nahi.

**Vercel par (ek bar):**
1. Is page par **Sender Gmail** + **App Password** paste karo, phir Watch dubara
2. YA Vercel → Environment Variables → `GO_LIVE_AUDIT_SMTP_USER`, `GO_LIVE_AUDIT_SMTP_PASS`, `GO_LIVE_AUDIT_EMAIL_FROM` → **Redeploy**

## Live result local jaisa kyun nahi
`playwright-vercel-failed` = server par Chromium abhi fail. Fix:
- `git push` + Redeploy
- Fluid Compute **OFF**
- `AWS_LAMBDA_JS_RUNTIME=nodejs22.x`

Detail: `VERCEL-CHROMIUM-FIX-URDU.md`

## Watch par tab band mat karo (Vercel)
14 brands = 14 steps (1 brand per request). Tab open rakho jab tak button wapas **Run watch now** na ho jaye.
