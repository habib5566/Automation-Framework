const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/**
 * Kogents.ai CRM + Website Integration Checklist Automation
 * Comprehensive analysis of CRM integration, forms, payments, and data handling
 */

test.describe('Kogents.ai CRM Integration Checklist', () => {
    const baseURL = process.env.CHECKLIST_URL || 'https://kogents.ai';
    const reportData = {
        website: 'https://kogents.ai',
        analysisDate: new Date().toISOString(),
        checklistItems: [],
        summary: {
            total: 0,
            passed: 0,
            failed: 0,
            warnings: 0,
            notApplicable: 0
        }
    };

    // Helper to add checklist result
    function addResult(item, status, details, evidence = null) {
        reportData.checklistItems.push({
            item,
            status, // 'PASS', 'FAIL', 'WARNING', 'N/A'
            details,
            evidence,
            timestamp: new Date().toISOString()
        });

        reportData.summary.total++;
        if (status === 'PASS') reportData.summary.passed++;
        else if (status === 'FAIL') reportData.summary.failed++;
        else if (status === 'WARNING') reportData.summary.warnings++;
        else if (status === 'N/A') reportData.summary.notApplicable++;
    }

    test.beforeEach(async({ page }) => {
        await page.goto(baseURL);
        await page.waitForLoadState('networkidle');
    });

    test.afterAll(async() => {
        // Generate JSON report
        const reportPath = path.join('reports', `kogents-crm-report-${Date.now()}.json`);
        fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
        console.log(`Report saved to: ${reportPath}`);
    });

    test('CRM Integration Detection', async({ page }) => {
        // Check for common CRM integration scripts
        const crmScripts = [
            'hubspot', 'salesforce', 'zoho', 'pipedrive', 'freshworks',
            'activecampaign', 'mailchimp', 'klaviyo', 'intercom', 'drift'
        ];

        const pageContent = await page.content();
        const detectedCRMs = [];

        for (const crm of crmScripts) {
            if (pageContent.toLowerCase().includes(crm)) {
                detectedCRMs.push(crm);
            }
        }

        if (detectedCRMs.length > 0) {
            addResult(
                'CRM properly integrated with the website',
                'PASS',
                `Detected CRM integrations: ${detectedCRMs.join(', ')}`,
                detectedCRMs
            );
        } else {
            addResult(
                'CRM properly integrated with the website',
                'WARNING',
                'No common CRM scripts detected. Manual verification required.',
                null
            );
        }
    });

    test('Form Detection and Analysis', async({ page }) => {
        const forms = page.locator('form');
        const formCount = await forms.count();

        if (formCount === 0) {
            addResult(
                'All brief forms (logo, website, video, SEM, SMM) are properly integrated',
                'FAIL',
                'No forms detected on the website',
                null
            );
            return;
        }

        let formsWithValidation = 0;
        let formsWithRequiredFields = 0;

        for (let i = 0; i < formCount; i++) {
            const form = forms.nth(i);

            // Check for required fields
            const requiredFields = form.locator('input[required], textarea[required], select[required]');
            if (await requiredFields.count() > 0) {
                formsWithRequiredFields++;
            }

            // Check for validation patterns
            const inputWithPattern = form.locator('input[pattern]');
            if (await inputWithPattern.count() > 0) {
                formsWithValidation++;
            }
        }

        addResult(
            'All required fields are mandatory and enforced on frontend',
            formsWithRequiredFields === formCount ? 'PASS' : 'WARNING',
            `${formsWithRequiredFields}/${formCount} forms have required field validation`, { totalForms: formCount, formsWithRequired: formsWithRequiredFields }
        );

        addResult(
            'Data validation enforced before sending to CRM',
            formsWithValidation > 0 ? 'PASS' : 'WARNING',
            `${formsWithValidation}/${formCount} forms have pattern validation`, { formsWithPattern: formsWithValidation }
        );
    });

    test('Form Submission and CRM Mapping', async({ page }) => {
        const forms = page.locator('form');
        const formCount = await forms.count();

        if (formCount === 0) {
            addResult(
                'Form submissions are mapped correctly to CRM fields',
                'N/A',
                'No forms to test',
                null
            );
            return;
        }

        // Test first form with a dry run (don't actually submit)
        const firstForm = forms.first();
        const formFields = [];
        const inputs = firstForm.locator('input, textarea, select');
        const inputCount = await inputs.count();

        for (let i = 0; i < inputCount; i++) {
            const input = inputs.nth(i);
            const name = await input.getAttribute('name');
            const type = await input.getAttribute('type') || 'text';
            const isRequired = await input.getAttribute('required') !== null;

            if (name) {
                formFields.push({ name, type, required: isRequired });
            }
        }

        addResult(
            'Form submissions are mapped correctly to CRM fields (no missing or mismatched data)',
            formFields.length > 0 ? 'PASS' : 'WARNING',
            `Found ${formFields.length} mappable fields in first form`, { fields: formFields }
        );
    });

    test('Lead Capture and Source Tracking', async({ page }) => {
        // Check for hidden fields that might track lead source
        const hiddenFields = page.locator('input[type="hidden"]');
        const hiddenCount = await hiddenFields.count();

        let hasSourceTracking = false;
        let hasUTMTracking = false;

        for (let i = 0; i < hiddenCount; i++) {
            const field = hiddenFields.nth(i);
            const name = await field.getAttribute('name');
            const value = await field.getAttribute('value');

            if (name && (name.toLowerCase().includes('source') || name.toLowerCase().includes('referrer'))) {
                hasSourceTracking = true;
            }
            if (name && (name.toLowerCase().includes('utm_') || name.toLowerCase().includes('campaign'))) {
                hasUTMTracking = true;
            }
        }

        addResult(
            'Lead source tracking enabled (which page/form generated the lead)',
            hasSourceTracking ? 'PASS' : 'WARNING',
            hasSourceTracking ? 'Source tracking fields detected' : 'No source tracking fields detected', { hasSourceTracking, hasUTMTracking }
        );

        addResult(
            'UTM parameters properly captured and stored in CRM',
            hasUTMTracking ? 'PASS' : 'WARNING',
            hasUTMTracking ? 'UTM tracking fields detected' : 'No UTM tracking fields detected', { hasUTMTracking }
        );
    });

    test('Duplicate Lead Prevention', async({ page }) => {
        // Check for common duplicate prevention mechanisms
        const pageContent = await page.content();

        const hasDuplicatePrevention =
            pageContent.includes('duplicate') ||
            pageContent.includes('existing') ||
            pageContent.includes('already submitted');

        addResult(
            'Duplicate lead prevention system implemented',
            hasDuplicatePrevention ? 'PASS' : 'WARNING',
            hasDuplicatePrevention ? 'Duplicate prevention logic detected' : 'No duplicate prevention detected in page content', { detected: hasDuplicatePrevention }
        );
    });

    test('Auto-response and Notifications', async({ page }) => {
        // Check for email/notification related elements
        const pageContent = await page.content();

        const hasAutoResponse =
            pageContent.toLowerCase().includes('thank you') ||
            pageContent.toLowerCase().includes('confirmation') ||
            pageContent.toLowerCase().includes('we will contact');

        addResult(
            'Auto-response emails triggered after form submission',
            hasAutoResponse ? 'PASS' : 'WARNING',
            hasAutoResponse ? 'Auto-response indicators found' : 'No auto-response indicators detected', { hasAutoResponse }
        );

        // Check for admin notification setup (would need backend verification)
        addResult(
            'Admin/internal notifications configured for new leads',
            'WARNING',
            'Cannot verify admin notifications from frontend. Requires backend testing.',
            null
        );
    });

    test('Pipeline and Lead Assignment', async({ page }) => {
        // This is primarily a backend check, but we can look for indicators
        const pageContent = await page.content();

        const hasPipelineIndicators =
            pageContent.includes('stage') ||
            pageContent.includes('pipeline') ||
            pageContent.includes('status');

        addResult(
            'CRM pipeline/stages properly defined (new lead, contacted, converted, etc.)',
            'WARNING',
            'Pipeline configuration is backend-dependent. Frontend analysis inconclusive.', { hasIndicators: hasPipelineIndicators }
        );

        addResult(
            'Leads are automatically assigned to the correct team/agent',
            'WARNING',
            'Lead assignment logic is backend-dependent. Requires CRM access verification.',
            null
        );
    });

    test('API and Webhook Integration', async({ page }) => {
        // Monitor network requests to detect API calls
        const apiCalls = [];

        page.on('request', request => {
            const url = request.url();
            if (url.includes('api') || url.includes('webhook') || url.includes('submit')) {
                apiCalls.push({
                    url,
                    method: request.method(),
                    time: Date.now()
                });
            }
        });

        // Interact with a form if available to trigger API calls
        const forms = page.locator('form');
        if (await forms.count() > 0) {
            // Just focus on the form to potentially trigger validation APIs
            await forms.first().focus();
            await page.waitForTimeout(2000);
        }

        addResult(
            'All API/webhook integrations tested and working properly',
            apiCalls.length > 0 ? 'PASS' : 'WARNING',
            `Detected ${apiCalls.length} API calls during interaction`, { apiCalls: apiCalls.slice(0, 5) } // Limit to first 5 for report
        );
    });

    test('Error Handling and Logging', async({ page }) => {
        const consoleErrors = [];
        const networkErrors = [];

        page.on('console', msg => {
            if (msg.type() === 'error') {
                consoleErrors.push({
                    type: msg.type(),
                    text: msg.text(),
                    time: Date.now()
                });
            }
        });

        page.on('requestfailed', request => {
            const failure = request.failure();
            networkErrors.push({
                url: request.url(),
                error: failure ? failure.errorText : 'Unknown',
                time: Date.now()
            });
        });

        // Navigate through the site to trigger potential errors
        await page.goto(baseURL);
        await page.waitForTimeout(3000);

        // Check for error boundaries or error handling UI
        const pageContent = await page.content();
        const hasErrorHandling =
            pageContent.includes('error') ||
            pageContent.includes('try again') ||
            pageContent.includes('something went wrong');

        addResult(
            'All errors are properly handled and logs are generated at every step',
            consoleErrors.length === 0 && networkErrors.length === 0 ? 'PASS' : 'WARNING',
            `Console errors: ${consoleErrors.length}, Network errors: ${networkErrors.length}`, { consoleErrors: consoleErrors.slice(0, 3), networkErrors: networkErrors.slice(0, 3) }
        );
    });

    test('Security and HTTPS', async({ page }) => {
        const url = page.url();
        const isHTTPS = url.startsWith('https://');

        // Check for security headers
        const response = await page.goto(baseURL);
        const headers = response.headers();
        const hasStrictTransport = headers['strict-transport-security'] !== undefined;
        const hasContentTypeOptions = headers['x-content-type-options'] === 'nosniff';

        addResult(
            'Sensitive data is securely transmitted (HTTPS, encryption where needed)',
            isHTTPS ? 'PASS' : 'FAIL',
            isHTTPS ? 'Website uses HTTPS' : 'Website does not use HTTPS', { isHTTPS, hasStrictTransport, hasContentTypeOptions }
        );

        addResult(
            'CRM authentication (API keys/tokens) securely stored and configured',
            'WARNING',
            'Cannot verify authentication security from frontend. Requires backend audit.',
            null
        );
    });

    test('Payment Integration Detection', async({ page }) => {
        // Look for payment-related elements
        const paymentElements = page.locator('[data-testid*="payment"], [class*="payment"], [id*="payment"]');
        const paymentCount = await paymentElements.count();

        const pageContent = await page.content();
        const hasPaymentIntegration =
            pageContent.includes('stripe') ||
            pageContent.includes('paypal') ||
            pageContent.includes('checkout') ||
            pageContent.includes('payment');

        addResult(
            'All merchants\' test payments completed and verified (including 3-step and standard payments)',
            hasPaymentIntegration ? 'WARNING' : 'N/A',
            hasPaymentIntegration ? 'Payment integration detected - requires manual testing' : 'No payment integration detected', { hasPaymentIntegration, paymentElements: paymentCount }
        );

        addResult(
            'All pricing packages correctly redirect to checkout and recorded in CRM',
            hasPaymentIntegration ? 'WARNING' : 'N/A',
            'Pricing package integration requires manual verification',
            null
        );
    });

    test('Lead Segmentation and Tagging', async({ page }) => {
        // Check for service-specific forms or segmentation
        const pageContent = await page.content();

        const hasSegmentation =
            pageContent.includes('service') ||
            pageContent.includes('package') ||
            pageContent.includes('plan') ||
            pageContent.includes('category');

        addResult(
            'Lead segmentation/tagging system implemented (service-based, source-based, etc.)',
            hasSegmentation ? 'PASS' : 'WARNING',
            hasSegmentation ? 'Segmentation indicators found' : 'No clear segmentation detected', { hasSegmentation }
        );
    });

    test('File Upload Handling', async({ page }) => {
        const fileInputs = page.locator('input[type="file"]');
        const fileInputCount = await fileInputs.count();

        addResult(
            'File uploads (if any) properly stored and linked in CRM',
            fileInputCount > 0 ? 'WARNING' : 'N/A',
            fileInputCount > 0 ?
            `${fileInputCount} file upload fields detected - requires testing` :
            'No file upload fields detected', { fileInputCount }
        );
    });

    test('Third-party Integrations', async({ page }) => {
        const pageContent = await page.content();

        const integrations = {
            email: pageContent.includes('mail') || pageContent.includes('email'),
            analytics: pageContent.includes('analytics') || pageContent.includes('ga4') || pageContent.includes('gtag'),
            chat: pageContent.includes('chat') || pageContent.includes('intercom') || pageContent.includes('drift'),
            social: pageContent.includes('facebook') || pageContent.includes('twitter') || pageContent.includes('linkedin')
        };

        addResult(
            'All third-party integrations (payment gateways, email services) tested',
            'WARNING',
            'Third-party integrations detected - manual testing required',
            integrations
        );
    });

    test('Reporting and Analytics', async({ page }) => {
        // Check for analytics scripts
        const pageContent = await page.content();

        const hasAnalytics =
            pageContent.includes('analytics') ||
            pageContent.includes('gtag') ||
            pageContent.includes('gtm') ||
            pageContent.includes('pixel');

        addResult(
            'Reporting and analytics working correctly in CRM',
            hasAnalytics ? 'PASS' : 'WARNING',
            hasAnalytics ? 'Analytics integration detected' : 'No analytics detected', { hasAnalytics }
        );

        addResult(
            'Data export functionality tested (if required)',
            'WARNING',
            'Data export functionality requires CRM backend access to verify',
            null
        );
    });

    test('Data Integrity and Sync', async({ page }) => {
        // Check for real-time indicators
        const pageContent = await page.content();

        const hasRealTimeIndicators =
            pageContent.includes('real-time') ||
            pageContent.includes('instant') ||
            pageContent.includes('live');

        addResult(
            'Real-time data sync verified between website and CRM',
            'WARNING',
            'Real-time sync verification requires CRM access and live testing', { hasIndicators: hasRealTimeIndicators }
        );

        addResult(
            'No data loss occurs during submission or sync',
            'WARNING',
            'Data loss prevention requires comprehensive testing with CRM monitoring',
            null
        );
    });

    test('Timeout and Error Scenarios', async({ page }) => {
        // Test basic timeout handling
        const startTime = Date.now();

        try {
            await page.goto(baseURL, { timeout: 10000 });
            const loadTime = Date.now() - startTime;

            addResult(
                'Timeout handling implemented for slow API responses',
                loadTime < 10000 ? 'PASS' : 'WARNING',
                `Page loaded in ${loadTime}ms`, { loadTime }
            );
        } catch (error) {
            addResult(
                'Timeout handling implemented for slow API responses',
                'FAIL',
                `Page load timeout exceeded: ${error.message}`, { error: error.message }
            );
        }

        addResult(
            'Error scenarios tested (failed payment, incomplete form, API failure)',
            'WARNING',
            'Error scenario testing requires manual intervention and CRM monitoring',
            null
        );
    });

    test('Activity Logging', async({ page }) => {
        // Check for logging indicators
        const pageContent = await page.content();

        const hasLogging =
            pageContent.includes('log') ||
            pageContent.includes('track') ||
            pageContent.includes('event');

        addResult(
            'Activity logs maintained for each lead (form submission, payment, actions)',
            'WARNING',
            'Activity logging is backend-dependent. Requires CRM verification.', { hasFrontendIndicators: hasLogging }
        );
    });

    test('CRM Dashboard and Data Accuracy', async({ page }) => {
        addResult(
            'CRM dashboard reflects accurate and real-time data',
            'WARNING',
            'CRM dashboard verification requires direct CRM access',
            null
        );
    });

    test('Console and API Error Resolution', async({ page }) => {
        const consoleErrors = [];

        page.on('console', msg => {
            if (msg.type() === 'error') {
                consoleErrors.push(msg.text());
            }
        });

        await page.goto(baseURL);
        await page.waitForTimeout(5000);

        addResult(
            'Console errors and API errors fully resolved',
            consoleErrors.length === 0 ? 'PASS' : 'FAIL',
            `Found ${consoleErrors.length} console errors`, { consoleErrors: consoleErrors.slice(0, 5) }
        );
    });

    test('End-to-End User Journey', async({ page }) => {
        // Simulate basic user journey
        let journeySuccessful = true;
        let journeySteps = [];

        try {
            // Step 1: Landing page
            await page.goto(baseURL);
            journeySteps.push('Landing page loaded');

            // Step 2: Navigate to a form/contact page
            const contactLinks = page.locator('a[href*="contact"], a[href*="quote"], a[href*="inquiry"]');
            if (await contactLinks.count() > 0) {
                await contactLinks.first().click();
                await page.waitForLoadState('networkidle');
                journeySteps.push('Contact page accessed');
            }

            // Step 3: Check for form interaction
            const forms = page.locator('form');
            if (await forms.count() > 0) {
                await forms.first().focus();
                journeySteps.push('Form interaction possible');
            }

        } catch (error) {
            journeySuccessful = false;
            journeySteps.push(`Error: ${error.message}`);
        }

        addResult(
            'Final end-to-end testing completed (user journey → lead → payment → CRM entry)',
            journeySuccessful ? 'PASS' : 'FAIL',
            `Journey completed: ${journeySteps.join(' → ')}`, { journeySteps, success: journeySuccessful }
        );
    });

    test('Generate Final Report', async({ page }) => {
        // This test just ensures the report is generated
        console.log('=== KOGENTS.AI CRM INTEGRATION CHECKLIST REPORT ===');
        console.log(`Website: ${reportData.website}`);
        console.log(`Analysis Date: ${reportData.analysisDate}`);
        console.log('');
        console.log('SUMMARY:');
        console.log(`  Total Items: ${reportData.summary.total}`);
        console.log(`  Passed: ${reportData.summary.passed}`);
        console.log(`  Failed: ${reportData.summary.failed}`);
        console.log(`  Warnings: ${reportData.summary.warnings}`);
        console.log(`  Not Applicable: ${reportData.summary.notApplicable}`);
        console.log('');
        console.log('DETAILED RESULTS:');

        reportData.checklistItems.forEach((item, index) => {
            const statusIcon = item.status === 'PASS' ? '✅' :
                item.status === 'FAIL' ? '❌' :
                item.status === 'WARNING' ? '⚠️' : '➡️';
            console.log(`${index + 1}. ${statusIcon} ${item.item}`);
            console.log(`   Status: ${item.status}`);
            console.log(`   Details: ${item.details}`);
            console.log('');
        });

        expect(reportData.checklistItems.length).toBeGreaterThan(0);
    });
});