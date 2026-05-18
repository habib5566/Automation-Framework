# Pre-Upload Checklist for cPanel 📋

## Critical Files
- [ ] index.html
- [ ] about.html
- [ ] contact.html
- [ ] portfolio.html
- [ ] .htaccess (IMPORTANT!)
- [ ] config.php

## Folders
- [ ] /css/ (with all CSS files)
- [ ] /js/ (with all JS files)
- [ ] /vendor/ (with all libraries)
- [ ] /img/ (with all images)
- [ ] /ajax/ (with AJAX files)
- [ ] /php/ (with PHP files)
- [ ] /video/ (with video files)

## Before Upload
- [ ] All files downloaded/zipped
- [ ] No spaces in folder names
- [ ] All folder names LOWERCASE
- [ ] No special characters in filenames
- [ ] .htaccess file included

## After Upload to cPanel

### Step 1: Permissions
```
public_html/
├── All HTML files: 644 ✓
├── All CSS files: 644 ✓
├── All JS files: 644 ✓
├── .htaccess: 644 ✓
└── Folders: 755 ✓
```

### Step 2: Verify File Structure
```
✓ public_html/index.html exists
✓ public_html/css/theme.css exists
✓ public_html/js/theme.js exists
✓ public_html/vendor/jquery/jquery.min.js exists
✓ public_html/img/ folder exists with images
✓ public_html/.htaccess exists
```

### Step 3: Test URL
- [ ] https://yourdomain.com loads
- [ ] No 404 errors
- [ ] Images load correctly
- [ ] Styles applied
- [ ] JavaScript functions work

### Step 4: Browser Console Check (F12)
- [ ] No "Unexpected token '<'" errors
- [ ] No 404 errors for resources
- [ ] No mixed content warnings (http/https)

### Step 5: Functionality Test
- [ ] Navigation links work
- [ ] Portfolio filtering works
- [ ] Contact form loads (if applicable)
- [ ] Responsive design works on mobile

## If Errors Occur

| Error | Check |
|-------|-------|
| Unexpected token '<' | .htaccess file, file paths |
| 404 Not Found | Filename case, folder spelling |
| Images not loading | /img/ folder permissions, path case |
| CSS/JS not loading | .htaccess, MIME types, permissions |
| 500 Error | config.php, PHP version, permissions |

## Important Reminders

⚠️ **Case Sensitive!**
```
❌ /CSS/theme.css  → Won't work
✅ /css/theme.css  → Works
```

⚠️ **File Paths**
```
❌ href="/home/user/public_html/css/theme.css"
✅ href="css/theme.css" or href="/css/theme.css"
```

⚠️ **.htaccess Rules**
```
- Remove .html extension from URLs
- Set proper MIME types
- Enable caching
- Redirect rules
```

---

## Final Verification

After everything is uploaded:

```
✓ Domain opens without errors
✓ All pages accessible
✓ All styles loaded
✓ All scripts working
✓ Images displaying
✓ No console errors
✓ Mobile responsive
✓ Forms functional (if any)
```

You're good to go! 🎉
