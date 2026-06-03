# Scan results zyada sahi (genuine) — kya fix hua

## Problem
Sab brands **down** ya **bahut low score** dikhte thay jab sites browser mein theek chal rahi thin.

## Asal wajah (technical)
1. **Bot User-Agent** — kuch sites Vercel se block karti hain → timeout / fail → “down”.
2. **SPA / React** — HTML mein kam buttons → purana rule **U01 = Fail** → score gir jata tha.
3. **Console noise** — Google Analytics, ads, favicon errors → “site down” jaisa security alert.
4. **404 galat tarah** — server up hai lekin path galat → pehle “critical down” treat hota tha.
5. **Score** — saari console errors + checklist fails mil kar **0–30%** dikhte thay.

## Performance % / Site score (latest)

**Site score** ab sirf **detected** cheezen se banta hai:
- HTTP 200 + site up → usually **85–95%**
- Sirf **critical** security + **material** console/HTTP errors score kam karte hain
- Manual checklist rows (**pending**) score **nahi** girate
- **Checklist pass %** alag line hai — poora form, site score nahi

## Ab kya better hai
- Vercel par **browser jaisa User-Agent** + **zyada timeout** (28s).
- **U01** ab Fail nahi — “JS site, browser mein check karein” (pending).
- **404 / 403** = URL issue, **site down nahi**.
- Security **site_down** sirf **5xx / unreachable**.
- Performance score **site health** par zyada depend (checklist noise kam).
- Console: tracking / favicon / ad-block **ignore**.

## Aap kya karein
1. **Push + Vercel Redeploy** (latest code).
2. Ek brand **dobara scan** — dekhein **Availability: Site is up** aur HTTP **200**.
3. Agar phir bhi fail: **sahi homepage URL** (trailing slash, `www` vs non-www).
4. **Local full scan** (optional): tunnel + `npm run go-live:audit` — Playwright console zyada accurate.

## Note
Yeh tool **shallow HTTP + optional browser** scan hai — Lighthouse ya manual QA ki jagah nahi. Live site up hai lekin score kam ho sakta hai agar checklist rows (meta, alt text, headers) fail hon — woh **real improvement areas** hain, “down” nahi.
