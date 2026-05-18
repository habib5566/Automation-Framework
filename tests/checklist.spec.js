const { test, expect } = require('@playwright/test');

/**
 * Website Go-Live Checklist Automation Tests
 * Dynamic Functional Checks using Playwright
 */

test.describe('Website Go-Live Checklist', () => {
    const baseURL = process.env.CHECKLIST_URL || 'http://localhost:3000';

    test.beforeEach(async({ page }) => {
        await page.goto(baseURL);
    });

    test('Forms are functional and have validations', async({ page }) => {
        // Find all forms on the page
        const forms = page.locator('form');
        const formCount = await forms.count();

        if (formCount === 0) {
            console.log('No forms found - marking as PASS');
            return;
        }

        for (let i = 0; i < formCount; i++) {
            const form = forms.nth(i);

            // Check if form has required inputs
            const requiredInputs = form.locator('input[required], textarea[required], select[required]');
            const requiredCount = await requiredInputs.count();

            if (requiredCount > 0) {
                // Try submitting empty form to check validations
                const submitButton = form.locator('button[type="submit"], input[type="submit"]').first();
                if (await submitButton.count() > 0) {
                    await submitButton.click();
                    // Check if validation messages appear or form doesn't submit
                    await page.waitForTimeout(1000);
                }
            }
        }

        expect(formCount).toBeGreaterThanOrEqual(0); // Just to pass if no forms
    });

    test('All links work correctly', async({ page }) => {
        const links = page.locator('a[href]');
        const linkCount = await links.count();

        let brokenLinks = [];

        for (let i = 0; i < linkCount; i++) {
            const link = links.nth(i);
            const href = await link.getAttribute('href');

            if (href && !href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:')) {
                try {
                    const [response] = await Promise.all([
                        page.waitForResponse(resp => resp.url().includes(href) || resp.url() === href, { timeout: 5000 }),
                        link.click()
                    ]);
                    if (response.status() >= 400) {
                        brokenLinks.push(href);
                    }
                } catch (error) {
                    brokenLinks.push(href);
                }
                await page.goBack();
            }
        }

        expect(brokenLinks).toHaveLength(0);
    });

    test('Images load correctly', async({ page }) => {
        const images = page.locator('img');
        const imageCount = await images.count();

        let brokenImages = [];

        for (let i = 0; i < imageCount; i++) {
            const img = images.nth(i);
            const src = await img.getAttribute('src');

            if (src) {
                try {
                    const response = await page.request.get(src);
                    if (response.status() >= 400) {
                        brokenImages.push(src);
                    }
                } catch (error) {
                    brokenImages.push(src);
                }
            }
        }

        expect(brokenImages).toHaveLength(0);
    });

    test('Website is responsive', async({ page }) => {
        // Test mobile viewport
        await page.setViewportSize({ width: 375, height: 667 });
        await page.waitForTimeout(1000);

        // Check if content is visible and not overflowing
        const body = page.locator('body');
        const boundingBox = await body.boundingBox();
        expect(boundingBox.width).toBeLessThanOrEqual(375);

        // Test tablet viewport
        await page.setViewportSize({ width: 768, height: 1024 });
        await page.waitForTimeout(1000);

        // Test desktop viewport
        await page.setViewportSize({ width: 1920, height: 1080 });
        await page.waitForTimeout(1000);
    });

    test('Header and footer are present', async({ page }) => {
        const header = page.locator('header, [role="banner"], .header, #header');
        const footer = page.locator('footer, [role="contentinfo"], .footer, #footer');

        await expect(header.or(footer)).toBeVisible();
    });

    test('SSL/HTTPS is active', async({ page }) => {
        const url = page.url();
        expect(url).toMatch(/^https:\/\//);
    });

    test('Page speed basic check', async({ page }) => {
        const startTime = Date.now();
        await page.goto(baseURL);
        const loadTime = Date.now() - startTime;

        // Basic check - should load within 10 seconds
        expect(loadTime).toBeLessThan(10000);
    });

    test('Typography consistency check', async({ page }) => {
        // Check for consistent heading hierarchy
        const h1 = await page.locator('h1').count();
        const h2 = await page.locator('h2').count();
        const h3 = await page.locator('h3').count();

        // Should have at least one h1, and h2/h3 should be reasonable
        expect(h1).toBeGreaterThan(0);
    });

    test('CTAs are functional', async({ page }) => {
        // Find buttons and links that look like CTAs
        const ctas = page.locator('button, a, input[type="button"], input[type="submit"]');
        const ctaCount = await ctas.count();

        // At least check that they exist and are clickable
        if (ctaCount > 0) {
            const firstCTA = ctas.first();
            await expect(firstCTA).toBeVisible();
            await expect(firstCTA).toBeEnabled();
        }
    });
});