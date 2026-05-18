const { test, expect } = require('@playwright/test');
const VettedLogosPage = require('../pages/VettedLogosPage');
const RolesPage = require('../pages/RolesPage');

test.describe('Roles Page Tests', () => {
  test.use({ storageState: 'auth.json' });

  test('Navigate to roles page', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos');
    await vettedLogosPage.navigateToRoles();
    expect(page.url()).toContain('/roles');
  });

  test('Roles page loads', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/roles');
    expect(await page.isVisible('.roles-list')).toBe(true);
  });

  test('Add role functionality', async ({ page }) => {
    const rolesPage = new RolesPage(page);
    await rolesPage.navigate('/vetted-logos/roles');
    await rolesPage.addRole('Test Role', 'A test role description');
    expect(await rolesPage.verifyRoleAdded('Test Role')).toBe(true);
  });

  test('Edit role', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/roles');
    await page.click('.role-item .edit');
    await page.fill('input[name="name"]', 'Updated Role');
    await page.click('button:has-text("Save")');
    expect(await page.isVisible('text=Updated Role')).toBe(true);
  });

  test('Delete role', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/roles');
    await page.click('.role-item .delete');
    await page.click('button:has-text("Confirm")');
    // Verify deleted
  });

  test('Role permissions assignment', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/roles');
    await page.click('.role-item .permissions');
    expect(await page.isVisible('.permissions-list')).toBe(true);
  });

  test('Search roles', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/roles');
    await page.fill('input[placeholder*="search"]', 'admin');
    await page.click('button:has-text("Search")');
    // Verify search
  });

  test('Role hierarchy', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/roles');
    expect(await page.isVisible('.role-hierarchy')).toBe(true);
  });

  test('Duplicate role prevention', async ({ page }) => {
    const rolesPage = new RolesPage(page);
    await rolesPage.navigate('/vetted-logos/roles');
    await rolesPage.addRole('Duplicate Role', 'Description');
    await rolesPage.addRole('Duplicate Role', 'Description');
    expect(await page.isVisible('.error')).toBe(true);
  });

  test('Role user assignment', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/roles');
    await page.click('.role-item .assign-users');
    expect(await page.isVisible('.user-assignment')).toBe(true);
  });

  test('Role activity log', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/roles');
    await page.click('.role-item .activity');
    expect(await page.isVisible('.activity-log')).toBe(true);
  });
});