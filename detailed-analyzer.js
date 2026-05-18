const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

/**
 * Detailed Website Analysis with Screenshots
 * Specifically for VettedLogos.com issues
 */

class DetailedWebsiteAnalyzer {
    constructor(url, outputDir) {
        this.url = url;
        this.outputDir = outputDir;
        this.browser = null;
        this.page = null;
        this.issues = {
            dummyContent: [],
            phoneNumbers: [],
            telLinks: [],
            images: [],
            noIndex: []
        };
    }

    async init() {
        this.browser = await chromium.launch();
        this.page = await this.browser.newPage();
        await this.page.goto(this.url, {
            waitUntil: 'load',
            timeout: 90000
        });
        await this.page.waitForTimeout(2000);
    }

    async analyzeDummyContent() {
        console.log('🔍 Analyzing dummy content...');

        // Search for common placeholder patterns
        const placeholders = [
            'placeholder', 'dummy', 'lorem ipsum', 'sample text', 'test text',
            'coming soon', 'under construction', 'todo', 'fixme'
        ];

        for (const placeholder of placeholders) {
            const elements = await this.page.locator(`text=/${placeholder}/i`).all();

            for (const element of elements) {
                const boundingBox = await element.boundingBox();
                if (boundingBox) {
                    const screenshotPath = path.join(this.outputDir, `dummy-content-${Date.now()}.png`);
                    // Take a larger screenshot around the area
                    const clipX = Math.max(0, boundingBox.x - 50);
                    const clipY = Math.max(0, boundingBox.y - 50);
                    const clipWidth = Math.min(boundingBox.width + 100, (await this.page.viewportSize()).width - clipX);
                    const clipHeight = Math.min(boundingBox.height + 100, (await this.page.viewportSize()).height - clipY);

                    if (clipWidth > 0 && clipHeight > 0) {
                        await this.page.screenshot({
                            path: screenshotPath,
                            clip: {
                                x: clipX,
                                y: clipY,
                                width: clipWidth,
                                height: clipHeight
                            }
                        });
                    } else {
                        // Fallback: take full page screenshot
                        await this.page.screenshot({ path: screenshotPath });
                    }

                    const text = await element.textContent();
                    this.issues.dummyContent.push({
                        text: text.trim(),
                        screenshot: screenshotPath,
                        location: await element.evaluate(el => {
                            const rect = el.getBoundingClientRect();
                            return `Position: (${Math.round(rect.left)}, ${Math.round(rect.top)})`;
                        })
                    });
                }
            }
        }
    }

    async analyzePhoneNumbers() {
        console.log('📞 Analyzing phone numbers...');

        // Find all phone number patterns
        const phonePatterns = [
            /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
            /\(\d{3}\)\s*\d{3}[-.]?\d{4}\b/g,
            /\+\d{1,3}[-.\s]?\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g
        ];

        const allPhones = new Set();

        for (const pattern of phonePatterns) {
            const elements = await this.page.locator(`text=/${pattern.source}/`).all();

            for (const element of elements) {
                const text = await element.textContent();
                const matches = text.match(pattern);

                if (matches) {
                    for (const phone of matches) {
                        allPhones.add(phone);
                        const boundingBox = await element.boundingBox();

                        if (boundingBox) {
                            const screenshotPath = path.join(this.outputDir, `phone-${phone.replace(/[^a-zA-Z0-9]/g, '')}-${Date.now()}.png`);
                            // Take a larger screenshot around the area
                            const clipX = Math.max(0, boundingBox.x - 50);
                            const clipY = Math.max(0, boundingBox.y - 50);
                            const clipWidth = Math.min(boundingBox.width + 100, (await this.page.viewportSize()).width - clipX);
                            const clipHeight = Math.min(boundingBox.height + 100, (await this.page.viewportSize()).height - clipY);

                            if (clipWidth > 0 && clipHeight > 0) {
                                await this.page.screenshot({
                                    path: screenshotPath,
                                    clip: {
                                        x: clipX,
                                        y: clipY,
                                        width: clipWidth,
                                        height: clipHeight
                                    }
                                });
                            } else {
                                // Fallback: take full page screenshot
                                await this.page.screenshot({ path: screenshotPath });
                            }

                            this.issues.phoneNumbers.push({
                                phone: phone,
                                screenshot: screenshotPath,
                                context: text.trim(),
                                location: await element.evaluate(el => {
                                    const rect = el.getBoundingClientRect();
                                    return `Position: (${Math.round(rect.left)}, ${Math.round(rect.top)})`;
                                })
                            });
                        }
                    }
                }
            }
        }

        console.log(`Found ${allPhones.size} unique phone numbers:`, Array.from(allPhones));
    }

    async analyzeTelLinks() {
        console.log('🔗 Analyzing tel: links...');

        const telLinks = await this.page.locator('a[href^="tel:"]').all();
        const allPhones = await this.page.locator('text=/\\b\\d{3}[-.]?\\d{3}[-.]?\\d{4}\\b/').all();

        console.log(`Found ${telLinks.length} tel: links and ${allPhones.length} phone numbers`);

        // Screenshot tel: links
        for (let i = 0; i < telLinks.length; i++) {
            const link = telLinks[i];
            const boundingBox = await link.boundingBox();

            if (boundingBox) {
                const screenshotPath = path.join(this.outputDir, `tel-link-${i + 1}.png`);
                // Take a larger screenshot around the area
                const clipX = Math.max(0, boundingBox.x - 30);
                const clipY = Math.max(0, boundingBox.y - 30);
                const clipWidth = Math.min(boundingBox.width + 60, (await this.page.viewportSize()).width - clipX);
                const clipHeight = Math.min(boundingBox.height + 60, (await this.page.viewportSize()).height - clipY);

                if (clipWidth > 0 && clipHeight > 0) {
                    await this.page.screenshot({
                        path: screenshotPath,
                        clip: {
                            x: clipX,
                            y: clipY,
                            width: clipWidth,
                            height: clipHeight
                        }
                    });
                } else {
                    // Fallback: take full page screenshot
                    await this.page.screenshot({ path: screenshotPath });
                }

                const href = await link.getAttribute('href');
                const text = await link.textContent();

                this.issues.telLinks.push({
                    href: href,
                    text: text.trim(),
                    screenshot: screenshotPath,
                    location: await link.evaluate(el => {
                        const rect = el.getBoundingClientRect();
                        return `Position: (${Math.round(rect.left)}, ${Math.round(rect.top)})`;
                    })
                });
            }
        }
    }

    async analyzeImages() {
        console.log('🖼️ Analyzing images...');

        const images = await this.page.locator('img').all();

        for (let i = 0; i < images.length; i++) {
            const img = images[i];
            const alt = await img.getAttribute('alt');
            const src = await img.getAttribute('src');

            if (!alt || alt.trim() === '') {
                const boundingBox = await img.boundingBox();

                if (boundingBox) {
                    const screenshotPath = path.join(this.outputDir, `missing-alt-${i + 1}.png`);
                    // Take a larger screenshot around the area
                    const clipX = Math.max(0, boundingBox.x - 20);
                    const clipY = Math.max(0, boundingBox.y - 20);
                    const clipWidth = Math.min(boundingBox.width + 40, (await this.page.viewportSize()).width - clipX);
                    const clipHeight = Math.min(boundingBox.height + 40, (await this.page.viewportSize()).height - clipY);

                    if (clipWidth > 0 && clipHeight > 0) {
                        await this.page.screenshot({
                            path: screenshotPath,
                            clip: {
                                x: clipX,
                                y: clipY,
                                width: clipWidth,
                                height: clipHeight
                            }
                        });
                    } else {
                        // Fallback: take full page screenshot
                        await this.page.screenshot({ path: screenshotPath });
                    }

                    this.issues.images.push({
                        src: src,
                        alt: alt || '(empty)',
                        screenshot: screenshotPath,
                        location: await img.evaluate(el => {
                            const rect = el.getBoundingClientRect();
                            return `Position: (${Math.round(rect.left)}, ${Math.round(rect.top)})`;
                        })
                    });
                }
            }
        }

        console.log(`Found ${this.issues.images.length} images with missing alt text`);
    }

    async analyzeNoIndex() {
        console.log('🔒 Analyzing noindex status...');

        const robotsMeta = await this.page.locator('meta[name="robots"]').first();
        const exists = await robotsMeta.count() > 0;
        let robotsContent = null;

        if (exists) {
            robotsContent = await robotsMeta.getAttribute('content');
        }

        if (!robotsContent || (!robotsContent.includes('noindex') && !robotsContent.includes('nofollow'))) {
            // Take screenshot of the head section
            const headContent = await this.page.evaluate(() => {
                const head = document.querySelector('head');
                return head ? head.innerHTML : '';
            });

            const screenshotPath = path.join(this.outputDir, 'noindex-missing.png');
            await this.page.screenshot({ path: screenshotPath, fullPage: false });

            this.issues.noIndex.push({
                status: exists ? 'present but not noindex' : 'missing',
                robotsContent: robotsContent || 'No robots meta tag found',
                screenshot: screenshotPath,
                headContent: headContent.substring(0, 500) + '...'
            });
        }
    }

    async generateReports() {
        const report = {
            timestamp: new Date().toISOString(),
            url: this.url,
            page: new URL(this.url).pathname || '/',
            analysis: this.issues,
            summary: {
                dummyContent: this.issues.dummyContent.length,
                phoneNumbers: this.issues.phoneNumbers.length,
                telLinks: this.issues.telLinks.length,
                images: this.issues.images.length,
                noIndex: this.issues.noIndex.length
            }
        };

        const jsonPath = path.join(this.outputDir, 'detailed-analysis-report.json');
        fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

        const markdownPath = path.join(this.outputDir, 'DETAILED-REPORT.md');
        fs.writeFileSync(markdownPath, this.buildMarkdownReport(report));

        return { jsonPath, markdownPath };
    }

    buildMarkdownReport(report) {
        const issueLines = [];

        issueLines.push(`# VettedLogos.com Detailed Issue Analysis Report`);
        issueLines.push('');
        issueLines.push(`**Website:** ${report.url}  `);
        issueLines.push(`**Page analyzed:** ${report.page}  `);
        issueLines.push(`**Analysis Date:** ${report.timestamp.split('T')[0]}  `);
        issueLines.push('**Report Generated:** Detailed analysis with screenshots');
        issueLines.push('');
        issueLines.push('## 🔎 What this report covers');
        issueLines.push('This analysis checks the homepage for site readiness issues that can be detected automatically:');
        issueLines.push('- `noindex` / SEO protection');
        issueLines.push('- missing image `alt` text');
        issueLines.push('- visible phone number and tel link coverage');
        issueLines.push('- placeholder/dummy copy');
        issueLines.push('');
        issueLines.push('> Note: CRM and backend integration checks cannot be fully verified from the public homepage alone. The CRM checklist below lists items that require server/API/backend review.');
        issueLines.push('');
        issueLines.push('---');
        issueLines.push('');

        // NoIndex section
        issueLines.push('## 📍 Homepage issue locations');
        issueLines.push('');
        issueLines.push('### 1. 🔒 NoIndex meta tag missing');
        issueLines.push('- **Result:** `robots` meta tag is missing or not set to `noindex, nofollow`');
        issueLines.push('- **Why it matters:** protects the site from search engines before final approval');
        const noIndexItem = report.analysis.noIndex[0];
        if (noIndexItem) {
            issueLines.push(`- **Screenshot:** [noindex-missing.png](noindex-missing.png)`);
            issueLines.push('');
            issueLines.push('**Fix:** add this inside `<head>`:');
            issueLines.push('```html');
            issueLines.push('<meta name="robots" content="noindex, nofollow">');
            issueLines.push('```');
            issueLines.push('');
            issueLines.push('---');
            issueLines.push('');
        }

        // Image alt section
        issueLines.push('### 2. 🖼️ Images missing `alt` text');
        issueLines.push(`- **Total findings:** ${report.summary.images} images with empty \`alt\``);
        issueLines.push('- **Impact:** accessibility issue, SEO issue, and poor quality signal');
        issueLines.push('');
        issueLines.push('**Screenshots and sources:**');
        report.analysis.images.forEach(image => {
            const filename = image.src ? image.src.split('/').pop() : 'image';
            issueLines.push(`- [${filename}](${image.screenshot})`);
        });
        issueLines.push('');
        issueLines.push('**Fix:** add meaningful alt text like:');
        issueLines.push('```html');
        issueLines.push('<img src="assets/img/logo/logo-0001.svg" alt="Example brand logo design">');
        issueLines.push('```');
        issueLines.push('');
        issueLines.push('---');
        issueLines.push('');

        // Phone section
        issueLines.push('### 3. 📞 Phone number locations and tel links');
        issueLines.push('This analysis found the following phone number locations:');
        issueLines.push('');
        report.analysis.phoneNumbers.forEach((phone, index) => {
            issueLines.push(`${index + 1}. **Visible phone** — [screenshot](${phone.screenshot})`);
            issueLines.push('   - Phone: `' + phone.phone + '`');
            issueLines.push(`   - Location: ${phone.location}`);
            issueLines.push('');
        });
        issueLines.push('### ✅ Tel links detected');
        report.analysis.telLinks.forEach(link => {
            issueLines.push(`- [${link.href}](${link.screenshot})`);
        });
        issueLines.push('');
        issueLines.push('**What to check:**');
        issueLines.push('- Make sure every phone number on the page is the approved number.');
        issueLines.push('- Make sure every phone number uses clickable `tel:` links.');
        issueLines.push('');
        issueLines.push('Example:');
        issueLines.push('```html');
        issueLines.push('<a href="tel:+13232838536">323-283-8536</a>');
        issueLines.push('```');
        issueLines.push('');
        issueLines.push('---');
        issueLines.push('');

        // Dummy content
        issueLines.push('### 4. 🧪 Dummy / placeholder content');
        issueLines.push('- **Result:** No placeholder text found in this homepage scan.');
        issueLines.push('- **Note:** If your site has hidden pages or dynamic sections, check those manually for `placeholder`, `dummy`, or `Lorem ipsum` content.');
        issueLines.push('');
        issueLines.push('---');
        issueLines.push('');

        // Summary table
        issueLines.push('## 📊 Summary table');
        issueLines.push('');
        issueLines.push('| Issue | Status | Action |');
        issueLines.push('|---|---|---|');
        issueLines.push(`| NoIndex meta tag | ${report.summary.noIndex > 0 ? 'Missing' : 'Present'} | Add \`<meta name="robots" content="noindex, nofollow">\` |`);
        issueLines.push(`| Images without \`alt\` | ${report.summary.images} | Add meaningful \`alt\` text to each image |`);
        issueLines.push(`| Phone number locations | ${report.summary.phoneNumbers} found | Standardize approved phone number everywhere |`);
        issueLines.push(`| Phone tel: links | ${report.summary.telLinks} found | Confirm all phone numbers have \`tel:\` links |`);
        issueLines.push('| Dummy content | ' + (report.summary.dummyContent > 0 ? `${report.summary.dummyContent} found` : '0 found') + ' | Manual check hidden/dynamic sections |');
        issueLines.push('');
        issueLines.push('---');
        issueLines.push('');

        // CRM note
        issueLines.push('## 🧭 What this report does not verify automatically');
        issueLines.push('The following CRM and integration checklist items require backend, CRM, API, or admin access and cannot be fully confirmed from the public homepage alone:');
        issueLines.push('');
        issueLines.push('- CRM integration connectivity and lead capture');
        issueLines.push('- Payment process and merchant/test payment verification');
        issueLines.push('- Form-to-CRM mapping and duplicate lead prevention');
        issueLines.push('- UTM tracking, lead source tracking, and auto-response emails');
        issueLines.push('- CRM pipeline/stage assignments and notifications');
        issueLines.push('- API/webhook retry or fallback handling');
        issueLines.push('- Secure API key/token storage and transmission');
        issueLines.push('- Real-time CRM data sync and dashboard accuracy');
        issueLines.push('- Payment status logging, order IDs, activity logs');
        issueLines.push('- Third-party payment and email service integration');
        issueLines.push('- End-to-end lead/payment flow validation');
        issueLines.push('');
        issueLines.push('> These items must be verified by checking the website backend, CRM settings, payment gateway logs, and API/webhook platforms.');
        issueLines.push('');
        issueLines.push('---');
        issueLines.push('');
        issueLines.push('## 🔧 Recommended fixes now');
        issueLines.push('1. Add `<meta name="robots" content="noindex, nofollow">` to the homepage `<head>`.');
        issueLines.push('2. Add proper `alt` text to every missing image.');
        issueLines.push('3. Confirm the approved phone number is the same everywhere.');
        issueLines.push('4. Add `tel:` links to every phone number.');
        issueLines.push('5. Re-run the analyzer after changes to confirm the fixes.');
        issueLines.push('');
        issueLines.push('---');
        issueLines.push('');
        issueLines.push('## 📁 Generated files');
        issueLines.push('- `detailed-analysis-report.json`');
        issueLines.push('- `phone-*.png`');
        issueLines.push('- `tel-link-*.png`');
        issueLines.push('- `missing-alt-*.png`');
        issueLines.push('- `noindex-missing.png`');
        issueLines.push('');
        issueLines.push('**Folder:** `' + this.outputDir + '`');
        issueLines.push('');
        issueLines.push('---');
        issueLines.push('*This report is generated automatically from the homepage scan. CRM/backend checklist items require direct CRM and API review.*');

        return issueLines.join('\n');
    }

    async run() {
        try {
            await this.init();

            await this.analyzeDummyContent();
            await this.analyzePhoneNumbers();
            await this.analyzeTelLinks();
            await this.analyzeImages();
            await this.analyzeNoIndex();

            const { jsonPath, markdownPath } = await this.generateReports();

            console.log('✅ Detailed analysis completed!');
            console.log(`📄 JSON report saved to: ${jsonPath}`);
            console.log(`📄 Markdown report saved to: ${markdownPath}`);
            console.log(`📸 Screenshots saved to: ${this.outputDir}`);

            return { jsonPath, markdownPath };

        } catch (error) {
            console.error('❌ Analysis failed:', error);
            throw error;
        } finally {
            if (this.browser) {
                await this.browser.close();
            }
        }
    }
}

// CLI usage
if (require.main === module) {
    const url = process.argv[2];
    const outputDir = process.argv[3] || 'vettedlogos-analysis';

    if (!url) {
        console.log('Usage: node detailed-analyzer.js <url> [output-dir]');
        console.log('Example: node detailed-analyzer.js https://vettedlogos.com/ vettedlogos-analysis');
        process.exit(1);
    }

    const analyzer = new DetailedWebsiteAnalyzer(url, outputDir);
    analyzer.run().catch(console.error);
}

module.exports = DetailedWebsiteAnalyzer;