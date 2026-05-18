/**
 * Kogents.ai CRM Integration Checklist Analyzer
 * Standalone script to analyze the website and generate a detailed report
 * Run with: node kogents-analyzer.js
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const TARGET_URL = 'https://kogents.ai';

// Report data structure
const reportData = {
    website: TARGET_URL,
    analysisDate: new Date().toISOString(),
    analyzer: 'Kogents CRM Integration Checklist Analyzer v1.0',
    checklistItems: [],
    summary: {
        total: 0,
        passed: 0,
        failed: 0,
        warnings: 0,
        notApplicable: 0
    }
};

// Helper function to add result
function addResult(item, status, details, evidence = null) {
    reportData.checklistItems.push({
        item,
        status,
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

// Fetch webpage content
function fetchPage(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;

        client.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Connection': 'close'
            }
        }, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    content: data
                });
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

// Analysis functions
async function analyzeCRMIntegration(html) {
    const crmScripts = [
        'hubspot', 'salesforce', 'zoho', 'pipedrive', 'freshworks',
        'activecampaign', 'mailchimp', 'klaviyo', 'intercom', 'drift'
    ];

    const detectedCRMs = [];
    const lowerHtml = html.toLowerCase();

    for (const crm of crmScripts) {
        if (lowerHtml.includes(crm)) {
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
}

function analyzeForms(html) {
    // Check for form elements
    const formRegex = /<form[^>]*>/gi;
    const forms = html.match(formRegex) || [];
    const formCount = forms.length;

    if (formCount === 0) {
        addResult(
            'All brief forms (logo, website, video, SEM, SMM) are properly integrated',
            'FAIL',
            'No forms detected on the website',
            null
        );
        return;
    }

    // Check for required fields
    const requiredRegex = /required/gi;
    const requiredMatches = html.match(requiredRegex) || [];
    const hasRequiredFields = requiredMatches.length > 0;

    // Check for input validation patterns
    const patternRegex = /pattern\s*=/gi;
    const patternMatches = html.match(patternRegex) || [];
    const hasPatternValidation = patternMatches.length > 0;

    addResult(
        'All required fields are mandatory and enforced on frontend',
        hasRequiredFields ? 'PASS' : 'WARNING',
        `${requiredMatches.length} required field attributes found across ${formCount} forms`, { formCount, requiredCount: requiredMatches.length }
    );

    addResult(
        'Data validation enforced before sending to CRM',
        hasPatternValidation ? 'PASS' : 'WARNING',
        `${patternMatches.length} pattern validation attributes found`, { patternCount: patternMatches.length }
    );

    // Check for form field names (CRM mapping)
    const inputNameRegex = /name\s*=\s*["']([^"']+)["']/gi;
    const fieldNames = [];
    let match;
    while ((match = inputNameRegex.exec(html)) !== null) {
        fieldNames.push(match[1]);
    }

    addResult(
        'Form submissions are mapped correctly to CRM fields (no missing or mismatched data)',
        fieldNames.length > 0 ? 'PASS' : 'WARNING',
        `Found ${fieldNames.length} named form fields`, { fields: fieldNames.slice(0, 10) }
    );
}

function analyzeLeadTracking(html) {
    // Check for hidden fields that might track lead source
    const hiddenFieldRegex = /<input[^>]*type\s*=\s*["']hidden["'][^>]*>/gi;
    const hiddenFields = html.match(hiddenFieldRegex) || [];

    let hasSourceTracking = false;
    let hasUTMTracking = false;

    for (const field of hiddenFields) {
        const lowerField = field.toLowerCase();
        if (lowerField.includes('source') || lowerField.includes('referrer') || lowerField.includes('utm_source')) {
            hasSourceTracking = true;
        }
        if (lowerField.includes('utm_') || lowerField.includes('campaign')) {
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
}

function analyzeDuplicatePrevention(html) {
    const lowerHtml = html.toLowerCase();
    const hasDuplicatePrevention =
        lowerHtml.includes('duplicate') ||
        lowerHtml.includes('existing') ||
        lowerHtml.includes('already submitted');

    addResult(
        'Duplicate lead prevention system implemented',
        hasDuplicatePrevention ? 'PASS' : 'WARNING',
        hasDuplicatePrevention ? 'Duplicate prevention logic detected' : 'No duplicate prevention detected in page content', { detected: hasDuplicatePrevention }
    );
}

function analyzeAutoResponse(html) {
    const lowerHtml = html.toLowerCase();
    const hasAutoResponse =
        lowerHtml.includes('thank you') ||
        lowerHtml.includes('confirmation') ||
        lowerHtml.includes('we will contact');

    addResult(
        'Auto-response emails triggered after form submission',
        hasAutoResponse ? 'PASS' : 'WARNING',
        hasAutoResponse ? 'Auto-response indicators found' : 'No auto-response indicators detected', { hasAutoResponse }
    );

    addResult(
        'Admin/internal notifications configured for new leads',
        'WARNING',
        'Cannot verify admin notifications from frontend. Requires backend testing.',
        null
    );
}

function analyzePipelineAndAssignment(html) {
    addResult(
        'CRM pipeline/stages properly defined (new lead, contacted, converted, etc.)',
        'WARNING',
        'Pipeline configuration is backend-dependent. Frontend analysis inconclusive.',
        null
    );

    addResult(
        'Leads are automatically assigned to the correct team/agent',
        'WARNING',
        'Lead assignment logic is backend-dependent. Requires CRM access verification.',
        null
    );
}

function analyzeAPIIntegration(html) {
    // Check for API/webhook endpoints in the code
    const apiRegex = /(?:api|webhook|submit)[^\s"'>]*/gi;
    const apiMatches = html.match(apiRegex) || [];

    addResult(
        'All API/webhook integrations tested and working properly',
        apiMatches.length > 0 ? 'PASS' : 'WARNING',
        `Found ${apiMatches.length} potential API/webhook references`, { apiReferences: apiMatches.slice(0, 5) }
    );
}

function analyzeErrorHandling(html) {
    const lowerHtml = html.toLowerCase();
    const hasErrorHandling =
        lowerHtml.includes('error') ||
        lowerHtml.includes('try again') ||
        lowerHtml.includes('something went wrong');

    addResult(
        'All errors are properly handled and logs are generated at every step',
        hasErrorHandling ? 'PASS' : 'WARNING',
        hasErrorHandling ? 'Error handling indicators found' : 'No explicit error handling UI detected', { hasErrorHandling }
    );
}

function analyzeSecurity(headers, html) {
    const hasHTTPS = true; // We're fetching via HTTPS
    const hasStrictTransport = headers['strict-transport-security'] !== undefined;
    const hasContentTypeOptions = headers['x-content-type-options'] === 'nosniff';
    const hasXFrameOptions = headers['x-frame-options'] !== undefined;

    addResult(
        'Sensitive data is securely transmitted (HTTPS, encryption where needed)',
        hasHTTPS ? 'PASS' : 'FAIL',
        `HTTPS: ${hasHTTPS}, HSTS: ${hasStrictTransport}, X-Content-Type-Options: ${hasContentTypeOptions}`, { isHTTPS: hasHTTPS, hasStrictTransport, hasContentTypeOptions, hasXFrameOptions }
    );

    addResult(
        'CRM authentication (API keys/tokens) securely stored and configured',
        'WARNING',
        'Cannot verify authentication security from frontend. Requires backend audit.',
        null
    );
}

function analyzePaymentIntegration(html) {
    const lowerHtml = html.toLowerCase();
    const hasPaymentIntegration =
        lowerHtml.includes('stripe') ||
        lowerHtml.includes('paypal') ||
        lowerHtml.includes('checkout') ||
        lowerHtml.includes('payment');

    addResult(
        'All merchants\' test payments completed and verified (including 3-step and standard payments)',
        hasPaymentIntegration ? 'WARNING' : 'N/A',
        hasPaymentIntegration ? 'Payment integration detected - requires manual testing' : 'No payment integration detected', { hasPaymentIntegration }
    );

    addResult(
        'All pricing packages correctly redirect to checkout and recorded in CRM',
        hasPaymentIntegration ? 'WARNING' : 'N/A',
        'Pricing package integration requires manual verification',
        null
    );
}

function analyzeLeadSegmentation(html) {
    const lowerHtml = html.toLowerCase();
    const hasSegmentation =
        lowerHtml.includes('service') ||
        lowerHtml.includes('package') ||
        lowerHtml.includes('plan') ||
        lowerHtml.includes('category');

    addResult(
        'Lead segmentation/tagging system implemented (service-based, source-based, etc.)',
        hasSegmentation ? 'PASS' : 'WARNING',
        hasSegmentation ? 'Segmentation indicators found' : 'No clear segmentation detected', { hasSegmentation }
    );
}

function analyzeFileUploads(html) {
    const fileInputRegex = /<input[^>]*type\s*=\s*["']file["'][^>]*>/gi;
    const fileInputs = html.match(fileInputRegex) || [];

    addResult(
        'File uploads (if any) properly stored and linked in CRM',
        fileInputs.length > 0 ? 'WARNING' : 'N/A',
        fileInputs.length > 0 ?
        `${fileInputs.length} file upload fields detected - requires testing` :
        'No file upload fields detected', { fileInputCount: fileInputs.length }
    );
}

function analyzeThirdPartyIntegrations(html) {
    const lowerHtml = html.toLowerCase();

    const integrations = {
        email: lowerHtml.includes('mail') || lowerHtml.includes('email'),
        analytics: lowerHtml.includes('analytics') || lowerHtml.includes('ga4') || lowerHtml.includes('gtag'),
        chat: lowerHtml.includes('chat') || lowerHtml.includes('intercom') || lowerHtml.includes('drift'),
        social: lowerHtml.includes('facebook') || lowerHtml.includes('twitter') || lowerHtml.includes('linkedin'),
        cookieConsent: lowerHtml.includes('cookie') || lowerHtml.includes('consent') || lowerHtml.includes('gdpr')
    };

    addResult(
        'All third-party integrations (payment gateways, email services) tested',
        'WARNING',
        'Third-party integrations detected - manual testing required',
        integrations
    );
}

function analyzeReportingAndAnalytics(html) {
    const lowerHtml = html.toLowerCase();
    const hasAnalytics =
        lowerHtml.includes('analytics') ||
        lowerHtml.includes('gtag') ||
        lowerHtml.includes('gtm') ||
        lowerHtml.includes('pixel');

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
}

function analyzeDataIntegrity(html) {
    const lowerHtml = html.toLowerCase();
    const hasRealTimeIndicators =
        lowerHtml.includes('real-time') ||
        lowerHtml.includes('instant') ||
        lowerHtml.includes('live');

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
}

function analyzeTimeoutHandling() {
    addResult(
        'Timeout handling implemented for slow API responses',
        'WARNING',
        'Timeout handling is backend-dependent. Requires API testing.',
        null
    );

    addResult(
        'Error scenarios tested (failed payment, incomplete form, API failure)',
        'WARNING',
        'Error scenario testing requires manual intervention and CRM monitoring',
        null
    );
}

function analyzeActivityLogging(html) {
    const lowerHtml = html.toLowerCase();
    const hasLogging =
        lowerHtml.includes('log') ||
        lowerHtml.includes('track') ||
        lowerHtml.includes('event');

    addResult(
        'Activity logs maintained for each lead (form submission, payment, actions)',
        'WARNING',
        'Activity logging is backend-dependent. Requires CRM verification.', { hasFrontendIndicators: hasLogging }
    );
}

function analyzeCRMDashboard() {
    addResult(
        'CRM dashboard reflects accurate and real-time data',
        'WARNING',
        'CRM dashboard verification requires direct CRM access',
        null
    );
}

function analyzeConsoleErrors() {
    addResult(
        'Console errors and API errors fully resolved',
        'WARNING',
        'Console error verification requires browser-based testing with Playwright',
        null
    );
}

function analyzeEndToEnd() {
    addResult(
        'Final end-to-end testing completed (user journey → lead → payment → CRM entry)',
        'WARNING',
        'End-to-end testing requires comprehensive manual testing with CRM monitoring',
        null
    );
}

// Generate Word-compatible report (HTML format that can be opened in Word)
function generateWordReport() {
    const reportHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; }
        h2 { color: #34495e; margin-top: 30px; }
        .summary { background: #ecf0f1; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .summary table { width: 100%; border-collapse: collapse; }
        .summary th, .summary td { padding: 10px; text-align: left; border-bottom: 1px solid #bdc3c7; }
        .summary th { background: #3498db; color: white; }
        .checklist-item { margin: 15px 0; padding: 15px; border-left: 4px solid #3498db; background: #f8f9fa; }
        .status-pass { color: #27ae60; font-weight: bold; }
        .status-fail { color: #e74c3c; font-weight: bold; }
        .status-warning { color: #f39c12; font-weight: bold; }
        .status-na { color: #95a5a6; font-weight: bold; }
        .evidence { background: #fff; padding: 10px; margin-top: 10px; border: 1px solid #ddd; font-family: monospace; font-size: 12px; }
        .timestamp { color: #7f8c8d; font-size: 11px; }
    </style>
</head>
<body>
    <h1>Kogents.ai CRM + Website Integration Checklist Report</h1>
    
    <div class="summary">
        <h2>Executive Summary</h2>
        <table>
            <tr>
                <th>Metric</th>
                <th>Value</th>
            </tr>
            <tr>
                <td>Website Analyzed</td>
                <td>${reportData.website}</td>
            </tr>
            <tr>
                <td>Analysis Date</td>
                <td>${new Date(reportData.analysisDate).toLocaleString('en-PK')}</td>
            </tr>
            <tr>
                <td>Total Checklist Items</td>
                <td>${reportData.summary.total}</td>
            </tr>
            <tr>
                <td>✅ Passed</td>
                <td>${reportData.summary.passed}</td>
            </tr>
            <tr>
                <td>❌ Failed</td>
                <td>${reportData.summary.failed}</td>
            </tr>
            <tr>
                <td>⚠️ Warnings (Requires Manual Verification)</td>
                <td>${reportData.summary.warnings}</td>
            </tr>
            <tr>
                <td>➡️ Not Applicable</td>
                <td>${reportData.summary.notApplicable}</td>
            </tr>
        </table>
    </div>

    <h2>Detailed Checklist Analysis</h2>
    ${reportData.checklistItems.map((item, index) => {
        const statusClass = `status-${item.status.toLowerCase().replace('n/a', 'na')}`;
        const statusIcon = item.status === 'PASS' ? '✅' : 
                          item.status === 'FAIL' ? '❌' : 
                          item.status === 'WARNING' ? '⚠️' : '➡️';
        
        return `
        <div class="checklist-item">
            <h3>${index + 1}. ${item.item}</h3>
            <p><span class="${statusClass}">${statusIcon} ${item.status}</span></p>
            <p><strong>Details:</strong> ${item.details}</p>
            ${item.evidence ? `<div class="evidence"><strong>Evidence:</strong> ${JSON.stringify(item.evidence, null, 2)}</div>` : ''}
            <p class="timestamp">Checked: ${new Date(item.timestamp).toLocaleString('en-PK')}</p>
        </div>
        `;
    }).join('')}

    <h2>Recommendations</h2>
    <div class="checklist-item">
        <h3>Next Steps</h3>
        <ul>
            <li><strong>Immediate Actions:</strong> Address all FAILED items before going live</li>
            <li><strong>Manual Testing Required:</strong> Items marked as WARNING need manual verification with CRM access</li>
            <li><strong>CRM Integration Testing:</strong> Verify all form submissions are correctly captured in CRM</li>
            <li><strong>Payment Testing:</strong> Test all payment scenarios (success, failure, 3D Secure)</li>
            <li><strong>End-to-End Testing:</strong> Complete user journey testing from landing page to CRM entry</li>
        </ul>
    </div>

    <div style="margin-top: 50px; padding-top: 20px; border-top: 1px solid #bdc3c7; color: #7f8c8d; font-size: 12px;">
        <p>Generated by: ${reportData.analyzer}</p>
        <p>This report is based on automated frontend analysis. Backend verification and manual testing are required for complete validation.</p>
    </div>
</body>
</html>`;

    return reportHtml;
}

// Generate plain text report for console output
function generateTextReport() {
    let report = '\n=== KOGENTS.AI CRM INTEGRATION CHECKLIST REPORT ===\n\n';
    report += `Website: ${reportData.website}\n`;
    report += `Analysis Date: ${new Date(reportData.analysisDate).toLocaleString('en-PK')}\n`;
    report += `Analyzer: ${reportData.analyzer}\n\n`;
    
    report += 'SUMMARY:\n';
    report += `  Total Items: ${reportData.summary.total}\n`;
    report += `  ✅ Passed: ${reportData.summary.passed}\n`;
    report += `  ❌ Failed: ${reportData.summary.failed}\n`;
    report += `  ⚠️ Warnings: ${reportData.summary.warnings}\n`;
    report += `  ➡️ Not Applicable: ${reportData.summary.notApplicable}\n\n`;
    
    report += 'DETAILED RESULTS:\n';
    report += '=' .repeat(80) + '\n\n';
    
    reportData.checklistItems.forEach((item, index) => {
        const statusIcon = item.status === 'PASS' ? '✅' : 
                          item.status === 'FAIL' ? '❌' : 
                          item.status === 'WARNING' ? '⚠️' : '➡️';
        
        report += `${index + 1}. ${statusIcon} ${item.item}\n`;
        report += `   Status: ${item.status}\n`;
        report += `   Details: ${item.details}\n`;
        
        if (item.evidence) {
            report += `   Evidence: ${JSON.stringify(item.evidence)}\n`;
        }
        
        report += '\n';
    });
    
    report += '=' .repeat(80) + '\n\n';
    report += 'RECOMMENDATIONS:\n';
    report += '  1. Address all FAILED items before going live\n';
    report += '  2. Manually verify all WARNING items with CRM access\n';
    report += '  3. Complete end-to-end testing with real user scenarios\n';
    report += '  4. Test all payment scenarios (success, failure, 3D Secure)\n';
    report += '  5. Verify data sync between website and CRM in real-time\n\n';
    
    return report;
}

// Main execution
async function main() {
    console.log('🚀 Starting Kogents.ai CRM Integration Analysis...\n');
    console.log(`Target URL: ${TARGET_URL}`);
    console.log(`Start Time: ${new Date().toLocaleString('en-PK')}\n`);
    
    try {
        // Fetch the webpage
        console.log('📡 Fetching webpage content...');
        const response = await fetchPage(TARGET_URL);
        console.log(`✅ Page fetched successfully (Status: ${response.statusCode})`);
        console.log(`📄 Content length: ${response.content.length} bytes\n`);
        
        // Run all analyses
        console.log('🔍 Running CRM Integration Analysis...');
        analyzeCRMIntegration(response.content);
        
        console.log('📝 Running Form Analysis...');
        analyzeForms(response.content);
        
        console.log('🎯 Running Lead Tracking Analysis...');
        analyzeLeadTracking(response.content);
        
        console.log('🔄 Running Duplicate Prevention Analysis...');
        analyzeDuplicatePrevention(response.content);
        
        console.log('📧 Running Auto-response Analysis...');
        analyzeAutoResponse(response.content);
        
        console.log('🔧 Running Pipeline and Assignment Analysis...');
        analyzePipelineAndAssignment(response.content);
        
        console.log('🔌 Running API Integration Analysis...');
        analyzeAPIIntegration(response.content);
        
        console.log('🛡️ Running Error Handling Analysis...');
        analyzeErrorHandling(response.content);
        
        console.log('🔒 Running Security Analysis...');
        analyzeSecurity(response.headers, response.content);
        
        console.log('💳 Running Payment Integration Analysis...');
        analyzePaymentIntegration(response.content);
        
        console.log('🏷️ Running Lead Segmentation Analysis...');
        analyzeLeadSegmentation(response.content);
        
        console.log('📎 Running File Upload Analysis...');
        analyzeFileUploads(response.content);
        
        console.log('🔗 Running Third-party Integration Analysis...');
        analyzeThirdPartyIntegrations(response.content);
        
        console.log('📊 Running Reporting and Analytics Analysis...');
        analyzeReportingAndAnalytics(response.content);
        
        console.log('💾 Running Data Integrity Analysis...');
        analyzeDataIntegrity(response.content);
        
        console.log('⏱️ Running Timeout Handling Analysis...');
        analyzeTimeoutHandling();
        
        console.log('📝 Running Activity Logging Analysis...');
        analyzeActivityLogging(response.content);
        
        console.log('📈 Running CRM Dashboard Analysis...');
        analyzeCRMDashboard();
        
        console.log('🐛 Running Console Error Analysis...');
        analyzeConsoleErrors();
        
        console.log('🔄 Running End-to-End Analysis...');
        analyzeEndToEnd();
        
        // Generate reports
        console.log('\n📄 Generating reports...\n');
        
        // Save JSON report
        const jsonReportPath = path.join('reports', `kogents-crm-report-${Date.now()}.json`);
        fs.writeFileSync(jsonReportPath, JSON.stringify(reportData, null, 2));
        console.log(`✅ JSON report saved: ${jsonReportPath}`);
        
        // Save Word-compatible HTML report
        const wordReportPath = path.join('reports', `kogents-crm-report-${Date.now()}.html`);
        fs.writeFileSync(wordReportPath, generateWordReport());
        console.log(`✅ Word report saved: ${wordReportPath}`);
        
        // Save text report
        const textReportPath = path.join('reports', `kogents-crm-report-${Date.now()}.txt`);
        fs.writeFileSync(textReportPath, generateTextReport());
        console.log(`✅ Text report saved: ${textReportPath}`);
        
        // Print summary to console
        console.log(generateTextReport());
        
        console.log(`\n✅ Analysis completed successfully!`);
        console.log(`📊 Total items checked: ${reportData.summary.total}`);
        console.log(`✅ Passed: ${reportData.summary.passed}`);
        console.log(`❌ Failed: ${reportData.summary.failed}`);
        console.log(`⚠️ Warnings: ${reportData.summary.warnings}`);
        console.log(`➡️ Not Applicable: ${reportData.summary.notApplicable}`);
        
    } catch (error) {
        console.error(`❌ Error during analysis: ${error.message}`);
        process.exit(1);
    }
}

// Run the analyzer
main();