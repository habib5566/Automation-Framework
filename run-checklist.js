#!/usr/bin/env node

const ChecklistChecker = require('./checklist-checker');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Master Checklist Runner
 * Combines static checks and Playwright tests
 */

class MasterChecklistRunner {
    constructor(url) {
        this.url = url;
        this.results = {
            timestamp: new Date().toISOString(),
            url: url,
            staticChecks: {},
            dynamicChecks: {},
            summary: {}
        };
    }

    async runStaticChecks() {
        console.log('🔍 Running static content checks...');
        const checker = new ChecklistChecker(this.url);
        this.results.staticChecks = await checker.runChecks();
        console.log('✅ Static checks completed');
    }

    async runDynamicChecks() {
        console.log('🚀 Running dynamic functional tests...');

        // Set environment variable for Playwright tests
        process.env.CHECKLIST_URL = this.url;

        try {
            // Run Playwright tests
            const output = execSync(`npx playwright test tests/checklist.spec.js --reporter=json`, {
                encoding: 'utf8',
                cwd: process.cwd()
            });

            const testResults = JSON.parse(output);
            this.results.dynamicChecks = this.parsePlaywrightResults(testResults);

        } catch (error) {
            console.log('⚠️  Some dynamic tests failed - this is expected for incomplete websites');
            try {
                const testResults = JSON.parse(error.stdout || '{}');
                this.results.dynamicChecks = this.parsePlaywrightResults(testResults);
            } catch (parseError) {
                this.results.dynamicChecks = { error: 'Failed to parse test results' };
            }
        }

        console.log('✅ Dynamic checks completed');
    }

    parsePlaywrightResults(results) {
        const parsed = {};

        if (results.suites && results.suites[0]) {
            const suite = results.suites[0];
            suite.specs.forEach(spec => {
                spec.tests.forEach(test => {
                    const testName = test.title;
                    const status = test.results[0]?.status === 'passed' ? 'PASS' : 'FAIL';
                    parsed[testName] = {
                        status: status,
                        duration: test.results[0]?.duration || 0
                    };
                });
            });
        }

        return parsed;
    }

    generateSummary() {
        const summary = {
            totalChecks: 0,
            passed: 0,
            failed: 0,
            warnings: 0,
            manualRequired: 0
        };

        // Count static checks
        Object.values(this.results.staticChecks).forEach(check => {
            if (typeof check === 'object' && check.status) {
                summary.totalChecks++;
                if (check.status === 'PASS') summary.passed++;
                else if (check.status === 'FAIL') summary.failed++;
                else if (check.status === 'WARN') summary.warnings++;
            } else if (typeof check === 'object') {
                // Handle nested objects like metaTags
                Object.values(check).forEach(subCheck => {
                    if (subCheck.status) {
                        summary.totalChecks++;
                        if (subCheck.status === 'PASS') summary.passed++;
                        else if (subCheck.status === 'FAIL') summary.failed++;
                        else if (subCheck.status === 'WARN') summary.warnings++;
                    }
                });
            }
        });

        // Count dynamic checks
        Object.values(this.results.dynamicChecks).forEach(check => {
            if (check.status) {
                summary.totalChecks++;
                if (check.status === 'PASS') summary.passed++;
                else summary.failed++;
            }
        });

        // Add manual checks count
        const manualItems = [
            'Visual alignment and spacing',
            'Content quality review',
            'Legal page content verification',
            'Zendesk chat integration testing',
            'Security measures verification',
            'SSR implementation verification',
            'Cross-browser testing (Chrome, Safari, Edge, Firefox)',
            'Analytics, tracking codes, and third-party scripts testing',
            'Chat, CRM, webhook, and email automation integrations'
        ];

        summary.manualRequired = manualItems.length;
        summary.manualItems = manualItems;

        this.results.summary = summary;
    }

    generateReport() {
        const report = {
            ...this.results,
            recommendations: this.generateRecommendations()
        };

        return report;
    }

    generateRecommendations() {
        const recommendations = [];

        // Check static results
        if (this.results.staticChecks.dummyContent?.status === 'FAIL') {
            recommendations.push('Remove all dummy content and placeholder text');
        }

        if (this.results.staticChecks.contactConsistency?.emails?.status === 'WARN') {
            recommendations.push('Use consistent email address across the website');
        }

        if (this.results.staticChecks.contactConsistency?.phones?.status === 'WARN') {
            recommendations.push('Use consistent phone number across the website');
        }

        if (this.results.staticChecks.telLinks?.status === 'FAIL') {
            recommendations.push('Add tel: links for all phone numbers');
        }

        if (this.results.staticChecks.noIndex?.status === 'FAIL') {
            recommendations.push('Add noindex/nofollow meta tags until final approval');
        }

        // Check dynamic results
        Object.entries(this.results.dynamicChecks).forEach(([testName, result]) => {
            if (result.status === 'FAIL') {
                recommendations.push(`Fix: ${testName}`);
            }
        });

        return recommendations;
    }

    async saveWordReport(report) {
        const filename = 'Framework Report.doc';
        const filepath = path.join(process.cwd(), 'reports', filename);

        if (!fs.existsSync(path.dirname(filepath))) {
            fs.mkdirSync(path.dirname(filepath), { recursive: true });
        }

        const rows = [
            ['Total Checks', report.summary.totalChecks || 0],
            ['Passed', report.summary.passed || 0],
            ['Failed', report.summary.failed || 0],
            ['Warnings', report.summary.warnings || 0],
            ['Manual Required', report.summary.manualRequired || 0]
        ];

        const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Framework Report</title>
</head>
<body>
<h1>Framework Report</h1>
<p><strong>Website:</strong> ${this.url}</p>
<p><strong>Generated:</strong> ${new Date().toISOString()}</p>
<h2>Summary</h2>
<table border="1" cellpadding="5" cellspacing="0">
<thead><tr><th>Metric</th><th>Value</th></tr></thead>
<tbody>
${rows.map(([label, value]) => `<tr><td>${label}</td><td>${value}</td></tr>`).join('')}
</tbody>
</table>
<h2>Checklist Details</h2>
<ul>
${Object.entries(report.staticChecks || {}).map(([key, value]) => {
            const status = value && value.status ? value.status : typeof value === 'object' ? JSON.stringify(value) : value;
            return `<li><strong>${key}:</strong> ${status}</li>`;
        }).join('')}
${Object.entries(report.dynamicChecks || {}).map(([key, value]) => `\n<li><strong>${key}:</strong> ${value.status || JSON.stringify(value)}</li>`).join('')}
</ul>
<h2>Recommendations</h2>
<ul>
${(report.recommendations || []).map(rec => `<li>${rec}</li>`).join('')}
</ul>
</body>
</html>`;

        fs.writeFileSync(filepath, html, 'utf8');
        console.log(`📄 Word report saved to: ${filepath}`);

        return filepath;
    }

    saveReport() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `checklist-report-${timestamp}.json`;
        const filepath = path.join(process.cwd(), 'reports', filename);

        if (!fs.existsSync(path.dirname(filepath))) {
            fs.mkdirSync(path.dirname(filepath), { recursive: true });
        }

        const report = this.generateReport();
        fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
        console.log(`📄 JSON report saved to: ${filepath}`);

        return { filepath, report };
    }

    async run() {
        console.log(`🌐 Starting Website Go-Live Checklist for: ${this.url}`);
        console.log('='.repeat(60));

        await this.runStaticChecks();
        await this.runDynamicChecks();
        this.generateSummary();

        const { filepath: jsonPath, report } = this.saveReport();
        const wordPath = await this.saveWordReport(report);

        console.log('\n📊 SUMMARY:');
        console.log(`Total Checks: ${this.results.summary.totalChecks}`);
        console.log(`✅ Passed: ${this.results.summary.passed}`);
        console.log(`❌ Failed: ${this.results.summary.failed}`);
        console.log(`⚠️  Warnings: ${this.results.summary.warnings}`);
        console.log(`📝 Manual Checks Required: ${this.results.summary.manualRequired}`);

        if (this.results.summary.recommendations?.length > 0) {
            console.log('\n🔧 RECOMMENDATIONS:');
            this.results.summary.recommendations.forEach(rec => console.log(`- ${rec}`));
        }

        console.log(`\n📄 JSON report: ${jsonPath}`);
        console.log(`📄 Word report: ${wordPath}`);

        return report;
    }
}

// CLI usage
if (require.main === module) {
    const url = process.argv[2];
    if (!url) {
        console.log('Usage: node run-checklist.js <url>');
        console.log('Example: node run-checklist.js https://example.com');
        process.exit(1);
    }

    const runner = new MasterChecklistRunner(url);
    runner.run().catch(console.error);
}

module.exports = MasterChecklistRunner;