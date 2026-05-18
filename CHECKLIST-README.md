# Website Go-Live Checklist Automation System

This system automatically checks your website against a comprehensive go-live checklist to ensure quality and readiness for production deployment.

## Features

### Automated Checks
- ✅ **Content Quality**: Detects dummy content, placeholders, and lorem ipsum
- ✅ **Form Validation**: Tests form functionality and client-side validations
- ✅ **Link Integrity**: Verifies all internal and external links work correctly
- ✅ **Image Optimization**: Checks for broken images and proper loading
- ✅ **SEO Basics**: Validates meta titles, descriptions, and favicons
- ✅ **Contact Consistency**: Ensures consistent email/phone numbers across the site
- ✅ **Mobile Responsiveness**: Basic responsive design testing
- ✅ **Security**: SSL/HTTPS verification
- ✅ **Performance**: Basic page load speed checks
- ✅ **Accessibility**: Tel: links for phone numbers

### Manual Checks Required
- Visual alignment and spacing consistency
- Content quality and accuracy review
- Legal pages (Privacy Policy, Terms, etc.)
- Zendesk chat integration testing
- Security measures verification
- Server-side rendering (SSR) implementation
- Cross-browser testing (Chrome, Safari, Edge, Firefox)
- Analytics and tracking code verification
- Third-party integrations (CRM, webhooks, email automation)

## Usage

### Prerequisites
- Node.js >= 18
- Playwright installed (`npm install`)

### Running the Checklist

#### Option 1: Using npm script
```bash
npm run checklist https://your-website.com
```

#### Option 2: Direct execution
```bash
node run-checklist.js https://your-website.com
```

#### Option 3: For local development
```bash
# Start your local server first
npm run demo:server

# Then run checklist on localhost
npm run checklist http://localhost:3000
```

## Output

The system generates:
1. **Console Output**: Real-time progress and summary
2. **JSON Report**: Detailed results saved to `reports/checklist-report-[timestamp].json`

### Sample Output
```
🌐 Starting Website Go-Live Checklist for: https://example.com
============================================================
🔍 Running static content checks...
✅ Static checks completed
🚀 Running dynamic functional tests...
✅ Dynamic checks completed

📊 SUMMARY:
Total Checks: 15
✅ Passed: 12
❌ Failed: 2
⚠️  Warnings: 1
📝 Manual Checks Required: 9

🔧 RECOMMENDATIONS:
- Remove all dummy content and placeholder text
- Add tel: links for all phone numbers

📄 Full report: reports/checklist-report-2024-01-15T10-30-00-000Z.json
```

## Report Structure

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "url": "https://example.com",
  "staticChecks": {
    "dummyContent": { "status": "PASS", "details": "No dummy content found" },
    "metaTags": {
      "title": { "status": "PASS", "value": "Example Website" },
      "description": { "status": "PASS", "value": "Example description" },
      "favicon": { "status": "PASS", "value": "/favicon.ico" }
    },
    "contactConsistency": { /* ... */ },
    "telLinks": { /* ... */ },
    "images": { /* ... */ },
    "noIndex": { /* ... */ }
  },
  "dynamicChecks": {
    "Forms are functional and have validations": { "status": "PASS", "duration": 1500 },
    "All links work correctly": { "status": "FAIL", "duration": 2500 },
    // ...
  },
  "summary": {
    "totalChecks": 15,
    "passed": 12,
    "failed": 2,
    "warnings": 1,
    "manualRequired": 9,
    "manualItems": [/* list of manual checks */]
  },
  "recommendations": [
    "Remove all dummy content and placeholder text",
    "Add tel: links for all phone numbers"
  ]
}
```

## Customization

### Adding New Checks

#### Static Checks (in `checklist-checker.js`)
```javascript
checkYourCustomRule() {
    // Your logic here
    const result = /* check logic */;
    this.results.yourCustomRule = {
        status: result ? 'PASS' : 'FAIL',
        details: 'Description of the check'
    };
}
```

#### Dynamic Checks (in `tests/checklist.spec.js`)
```javascript
test('Your custom check', async ({ page }) => {
    // Your Playwright test logic
    await expect(something).toBeVisible();
});
```

### Configuration
- Set `CHECKLIST_URL` environment variable to override the URL
- Modify timeouts and thresholds in the code as needed
- Add custom placeholder patterns in `checklist-checker.js`

## Integration

### CI/CD Pipeline
Add to your deployment pipeline:

```yaml
# GitHub Actions example
- name: Run Go-Live Checklist
  run: npm run checklist ${{ secrets.PROD_URL }}
```

### Pre-deployment Hook
```bash
#!/bin/bash
# pre-deploy.sh
npm run checklist $DEPLOY_URL
if [ $? -ne 0 ]; then
    echo "Checklist failed - blocking deployment"
    exit 1
fi
```

## Troubleshooting

### Common Issues

1. **SSL Certificate Errors**
   - For self-signed certificates, the system may report HTTPS failures
   - Consider adding certificate validation options

2. **Dynamic Content**
   - SPAs with client-side routing may need additional wait times
   - Add `await page.waitForLoadState('networkidle');` for dynamic content

3. **Rate Limiting**
   - Some checks make multiple requests - add delays if needed
   - `await page.waitForTimeout(1000);` between requests

4. **Cross-Origin Issues**
   - External links may fail CORS checks
   - Consider using a headless browser service for full testing

### Debug Mode
Run with debug flags:
```bash
npx playwright test tests/checklist.spec.js --debug
```

## Contributing

1. Add new checklist items to the automation
2. Update documentation
3. Test on various website types
4. Submit pull request

## License

This project is part of the Automation Framework and follows the same licensing terms.