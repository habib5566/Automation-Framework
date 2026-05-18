const { test, expect } = require('@playwright/test');
const VettedLogosPage = require('../pages/VettedLogosPage');
const PermissionsPage = require('../pages/PermissionsPage');

test.describe('Permissions Page Tests', () => {
  test.use({ storageState: 'auth.json' });

  test('Navigate to permissions page', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos');
    await vettedLogosPage.navigateToPermissions();
    expect(page.url()).toContain('/permissions');
  });

  test('Permissions page loads', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/permissions');
    expect(await page.isVisible('.permissions-list')).toBe(true);
  });

  test('Add permission functionality', async ({ page }) => {
    const permissionsPage = new PermissionsPage(page);
    await permissionsPage.navigate('/vetted-logos/permissions');
    await permissionsPage.addPermission('Test Permission', 'A test permission description');
    expect(await permissionsPage.verifyPermissionAdded('Test Permission')).toBe(true);
  });

  test('Edit permission', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/permissions');
    await page.click('.permission-item .edit');
    await page.fill('input[name="name"]', 'Updated Permission');
    await page.click('button:has-text("Save")');
    expect(await page.isVisible('text=Updated Permission')).toBe(true);
  });

  test('Delete permission', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/permissions');
    await page.click('.permission-item .delete');
    await page.click('button:has-text("Confirm")');
    // Verify deleted
  });

  test('Permission categories', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/permissions');
    await page.selectOption('select[name="category"]', 'user-management');
    // Verify filtered
  });

  test('Search permissions', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/permissions');
    await page.fill('input[placeholder*="search"]', 'create');
    await page.click('button:has-text("Search")');
    // Verify search
  });

  test('Permission inheritance', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/permissions');
    expect(await page.isVisible('.inheritance-tree')).toBe(true);
  });

  test('Bulk permission assignment', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/permissions');
    await page.check('.permission-checkbox');
    await page.click('button:has-text("Assign to Role")');
    expect(await page.isVisible('.role-selection')).toBe(true);
  });

  test('Permission dependencies', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/permissions');
    await page.click('.permission-item .dependencies');
    expect(await page.isVisible('.dependency-list')).toBe(true);
  });

  test('Permission audit log', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/permissions');
    await page.click('.permission-item .audit');
    expect(await page.isVisible('.audit-log')).toBe(true);
  });
});