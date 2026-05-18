const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

/**
 * Website Go-Live Checklist Automation System
 * Static Content Checker
 */

class ChecklistChecker {
    constructor(url) {
        this.url = url;
        this.results = {};
        this.html = '';
    }

    async fetchHtml() {
        return new Promise((resolve, reject) => {
            const protocol = this.url.startsWith('https') ? https : http;
            const req = protocol.get(this.url, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    this.html = data;
                    resolve(data);
                });
            });
            req.on('error', reject);
            req.setTimeout(10000, () => reject(new Error('Request timeout')));
        });
    }

    checkDummyContent() {
        const placeholders = [
            'lorem ipsum', 'placeholder', 'dummy', 'test text', 'sample text',
            'coming soon', 'under construction', 'todo', 'fixme'
        ];

        const lowerHtml = this.html.toLowerCase();
        const found = placeholders.filter(p => lowerHtml.includes(p));

        this.results.dummyContent = {
            status: found.length === 0 ? 'PASS' : 'FAIL',
            details: found.length === 0 ? 'No dummy content found' : `Found placeholders: ${found.join(', ')}`
        };
    }

    checkMetaTags() {
        const titleMatch = this.html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const descMatch = this.html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
        const faviconMatch = this.html.match(/<link[^>]*rel="icon"[^>]*href="([^"]+)"/i);

        this.results.metaTags = {
            title: titleMatch ? { status: 'PASS', value: titleMatch[1] } : { status: 'FAIL', details: 'Missing title tag' },
            description: descMatch ? { status: 'PASS', value: descMatch[1] } : { status: 'FAIL', details: 'Missing meta description' },
            favicon: faviconMatch ? { status: 'PASS', value: faviconMatch[1] } : { status: 'FAIL', details: 'Missing favicon' }
        };
    }

    checkContactConsistency() {
        const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
        const phoneRegex = /(\+?\d{1,3}[-.\s]?)?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})\b/g;

        const emails = this.html.match(emailRegex) || [];
        const phones = this.html.match(phoneRegex) || [];

        const uniqueEmails = [...new Set(emails)];
        const uniquePhones = [...new Set(phones)];

        this.results.contactConsistency = {
            emails: {
                status: uniqueEmails.length <= 1 ? 'PASS' : 'WARN',
                details: `Found ${uniqueEmails.length} unique emails: ${uniqueEmails.join(', ')}`
            },
            phones: {
                status: uniquePhones.length <= 1 ? 'PASS' : 'WARN',
                details: `Found ${uniquePhones.length} unique phones: ${uniquePhones.join(', ')}`
            }
        };
    }

    checkTelLinks() {
        const telLinks = this.html.match(/href="tel:[^"]+"/g) || [];
        const phones = this.html.match(/(\+?\d{1,3}[-.\s]?)?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})\b/g) || [];

        this.results.telLinks = {
            status: telLinks.length >= phones.length ? 'PASS' : 'FAIL',
            details: `${telLinks.length} tel: links found, ${phones.length} phone numbers detected`
        };
    }

    checkImages() {
        const imgTags = this.html.match(/<img[^>]+>/g) || [];
        const brokenIndicators = ['src=""', 'src="#"', 'alt=""'];

        let issues = [];
        imgTags.forEach(img => {
            brokenIndicators.forEach(indicator => {
                if (img.includes(indicator)) {
                    issues.push(`Image with ${indicator}`);
                }
            });
        });

        this.results.images = {
            status: issues.length === 0 ? 'PASS' : 'FAIL',
            details: issues.length === 0 ? 'No broken images detected' : `Issues: ${issues.join(', ')}`
        };
    }

    checkNoIndex() {
        const noIndex = this.html.includes('noindex') || this.html.includes('nofollow');
        this.results.noIndex = {
            status: noIndex ? 'PASS' : 'FAIL',
            details: noIndex ? 'Website is noindex/nofollow' : 'Website may be indexed - check robots meta tag'
        };
    }

    async runChecks() {
        try {
            await this.fetchHtml();
            this.checkDummyContent();
            this.checkMetaTags();
            this.checkContactConsistency();
            this.checkTelLinks();
            this.checkImages();
            this.checkNoIndex();

            return this.results;
        } catch (error) {
            return { error: error.message };
        }
    }
}

module.exports = ChecklistChecker;

// CLI usage
if (require.main === module) {
    const url = process.argv[2];
    if (!url) {
        console.log('Usage: node checklist-checker.js <url>');
        process.exit(1);
    }

    const checker = new ChecklistChecker(url);
    checker.runChecks().then(results => {
        console.log(JSON.stringify(results, null, 2));
    });
}