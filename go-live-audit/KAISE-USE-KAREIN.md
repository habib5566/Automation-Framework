# Go-Live Audit — email + vulnerabilities (Urdu / English)

## 1) Email inbox par report (zaroori)

Reports **sirf** is address par jati hain: **habib.developer8899@gmail.com**

### Step A — Google App Password

1. https://myaccount.google.com/security → **2-Step Verification** ON  
2. https://myaccount.google.com/apppasswords → naya password (Mail)  
3. **16 characters** copy karo (spaces hata do) — yeh **normal Gmail password nahi**

### Step B — project mein save

```bash
cd D:\Automation-Framework
npm run go-live:email-setup
```

- Gmail: `habib.developer8899@gmail.com`  
- Paste: 16-char App Password  

### Step C — server restart

```bash
npm run go-live:audit
```

Browser: http://localhost:3940  

- **Email scan summary** ✓  
- **Gmail App Password** field mein bhi wahi 16-char paste (optional backup)  
- **Run quick scan** ya **Run watch now**  

Success: popup / banner mein `Email sent … to habib.developer8899@gmail.com`  
Phir **Inbox + Spam** check karo.

---

## 2) Vulnerabilities / security risks nikalwana

Har scan ke baad UI mein yeh panels bharte hain:

| Panel | Kya milta hai |
|--------|----------------|
| **Vulnerabilities & risks** | Sab findings ek list (critical → low) |
| **Security monitor** | Malware, hack, leaked `.env`, defacement |
| **Site technology stack** | Laravel / PHP / WordPress version + EOL warnings |
| **Website console errors** | Har scan par **automatic** — Playwright real browser se `console.error` / warnings |
| **Vulnerabilities & risks** | Console + security + outdated stack — ek list |
| **Brand performance matrix** | % score + grade |

Email report mein bhi **VULNERABILITIES & RISKS** section hota hai (jab email send ho).

### Brands automatic monitor

1. URL + brand name  
2. ✓ **Save brand for automatic security watch**  
3. `npm run go-live:watch` — ek dafa sab brands  
4. `npm run go-live:watch:daemon` — har 30 min (optional)

---

## 3) Kya yeh full pentest nahi hai

- HTTP/HTML based checks (fast)  
- OWASP ZAP / Burp jaisa deep CVE scan **nahi**  
- Production sites often **hide** Laravel/PHP version — tab “version hidden” dikhega  

Serious audit ke liye alag professional scanner bhi chalao.

---

## 4) Agar email phir fail ho

- `.env` mein `@` wala password = galat → `npm run go-live:email-setup` dubara  
- Server **restart** zaroori after `.env` change  
- Scan API base **khali** rakho jab `localhost:3940` use karo  
