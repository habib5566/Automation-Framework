const { test, expect } = require('@playwright/test');
const VettedLogosPage = require('../pages/VettedLogosPage');
const PersonalPage = require('../pages/PersonalPage');

test.describe('Personal Page Tests', () => {
  test.use({ storageState: 'auth.json' });

  test('Navigate to personal page', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos');
    await vettedLogosPage.navigateToPersonal();
    expect(page.url()).toContain('/personal');
  });

  test('Personal page loads', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/personal');
    expect(await page.isVisible('.personal-settings')).toBe(true);
  });

  test('Edit profile functionality', async ({ page }) => {
    const personalPage = new PersonalPage(page);
    await personalPage.navigate('/vetted-logos/personal');
    await personalPage.editProfile('Updated Name', 'updated@example.com');
    expect(await personalPage.verifyProfileUpdated('Updated Name')).toBe(true);
  });

  test('Change password', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/personal');
    await page.click('button:has-text("Change Password")');
    await page.fill('input[name="current-password"]', 'ABCDabcd1234$$');
    await page.fill('input[name="new-password"]', 'NewPass123!');
    await page.fill('input[name="confirm-password"]', 'NewPass123!');
    await page.click('button:has-text("Update Password")');
    // Verify password changed
  });

  test('Profile picture upload', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/personal');
    await page.setInputFiles('input[type="file"]', 'path/to/profile-pic.jpg');
    await page.click('button:has-text("Upload")');
    // Verify upload
  });

  test('Notification preferences', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/personal');
    await page.click('.notification-settings');
    await page.check('input[name="email-notifications"]');
    await page.click('button:has-text("Save Preferences")');
    // Verify saved
  });

  test('Timezone settings', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/personal');
    await page.selectOption('select[name="timezone"]', 'America/New_York');
    // Verify timezone
  });

  test('Language settings', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/personal');
    await page.selectOption('select[name="language"]', 'es');
    // Verify language
  });

  test('Two-factor authentication', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/personal');
    await page.click('button:has-text("Enable 2FA")');
    expect(await page.isVisible('.qr-code')).toBe(true);
  });

  test('Account deletion', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/personal');
    await page.click('button:has-text("Delete Account")');
    expect(await page.isVisible('.delete-confirmation')).toBe(true);
  });

  test('Session management', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/personal');
    await page.click('.active-sessions');
    expect(await page.isVisible('.session-list')).toBe(true);
  });
});