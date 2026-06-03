# Email PDF report (Urdu / English)

## Kya hota hai?

Jab scan ya watch **email** bhejta hai, inbox mein:

1. **Chhoti HTML email** — headline + brand name  
2. **PDF attachment** — poora professional report (A4, sections, bullet points)

Sender name: **Go Live Check List** (agar Gmail profile name bhi wahi ho).

## PDF mein kya hai?

- Executive summary (pass / fail counts)  
- Performance score aur grade  
- Vulnerabilities & risks  
- Security monitor  
- Failed checklist items  
- Console / page issues (sample)

File name example: `Go-Live-Report-BrandName-2026-06-02.pdf`

## Watch — ek hi email (sab brands)

**Run watch now (all brands)** ab har brand par alag email nahi bhejta. Sab scan ke baad **ek combined email** aati hai jisme table + har brand ka score/summary hota hai.

## PDF band karna

Vercel → Environment Variables:

`GO_LIVE_AUDIT_EMAIL_PDF` = `0` → sirf text/HTML email, PDF nahi.

## Deploy (zaroori)

1. Code push karein (repo mein `pdfkit` dependency hai).  
2. Vercel par **Redeploy** — server `npm install` se PDF banayega.  
3. Ek scan chalayein, **Send report by email** on, inbox + **attachment** check karein.

## Local PC par npm error?

Agar `npm install` par certificate error aaye, local test ke liye IT/proxy fix karein; **Vercel deploy** par usually PDF theek chalta hai.

## Spam folder

Pehli dafa PDF wali email **Spam** mein ho sakti hai — “Not spam” mark karein.
