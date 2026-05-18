# 🚀 cPanel Par Upload Karne Ka Guide - Fluxx Ventures

## Step 1: Files Download Karo
Sab files "New folder" se zip kar lo:
```
├── index.html
├── about.html
├── contact.html
├── portfolio.html
├── .htaccess ✅ (NEW - iska zaroor include karo)
├── config.php ✅ (NEW - optional but helpful)
├── css/
├── js/
├── vendor/
├── ajax/
├── img/
├── php/
└── video/
```

---

## Step 2: cPanel Mein Upload Karo

### **Aapka cPanel Link**: 
`https://yourdomain.com:2083` (ya jo link diya gaya)

### **Login Karo:**
1. Username aur Password daalo
2. **File Manager** kholo

### **Folder Structure:**

```
public_html/
├── index.html
├── .htaccess
├── config.php
├── css/ 
├── js/
├── vendor/
├── img/
└── ... (baaki sab)
```

---

## Step 3: File Permissions Set Karo

1. **File Manager mein:**
   - Right-click → Change Permissions
   
2. **Set permissions:**
   ```
   Folders: 755
   Files: 644
   ```

3. **.htaccess file permissions:**
   ```
   644
   ```

---

## Step 4: Verify Checklist

✅ **Folder names lowercase hain?**
```
❌ /CSS/, /JS/, /IMG/, /VENDOR/
✅ /css/, /js/, /img/, /vendor/
```

✅ **index.html public_html root mein hai?**

✅ **.htaccess upload hua?**

✅ **Internet se access kar sakte ho?**
```
yourdomain.com (ye kaam karna chahiye)
```

---

## Step 5: Test Karo

1. Browser mein kholo: `https://yourdomain.com`
2. Console mein errors dekho (F12)
3. Agar errors hain:
   - File paths check karo
   - Permissions verify karo
   - cPanel logs dekho

---

## Common Issues & Fixes

### ❌ Error: "Unexpected token '<'"
**Fix:** .htaccess properly upload hua ensure karo

### ❌ CSS/JS load nahi ho rahe
**Fix:** File paths relative hain ensure karo:
```
✅ href="css/theme.css"
❌ href="/home/username/public_html/css/theme.css"
```

### ❌ 404 Not Found
**Fix:** File spelling exactly match karo (case-sensitive!)

### ❌ 500 Internal Server Error
**Fix:** 
- error_log dekho (File Manager → error_log.txt)
- config.php permissions check karo
- PHP version compatible hain ensure karo

---

## Live Domain Settings

**Update these files agir live domain use kar raho:**

### In `index.html` (footer section):
```html
<!-- Update GA ID -->
<script async src="https://www.googletagmanager.com/gtag/js?id=YOUR_GA_ID"></script>
```

### In contact forms (agar ho):
```php
// Update email address
$to = "your-email@yourdomain.com";
```

---

## Upload Script (Optional - Agar bulk upload karna ho)

```bash
# Terminal/SSH se (agar available hai)
cd /path/to/files
tar -czf fluxx-ventures.tar.gz *
# FTP ke through upload kar diyo
```

---

## After Upload - Next Steps

1. **DNS Settings Verify Karo**
   - cPanel → Zone Editor
   - A record point kar raha domain ke server par?

2. **SSL Certificate Setup Karo** (Free)
   - cPanel → AutoSSL
   - Activate karo

3. **Email Setup** (Optional)
   - cPanel → Email Accounts
   - Create karo (info@yourdomain.com)

---

## Contact/Support

Agar problem ho:
1. cPanel error_log dekho
2. Browser console errors note karo
3. Screenshot share karo
4. Hosting provider se contact karo (agar server issue ho)

---

**Files ready hain upload karne ke liye! 🚀**
