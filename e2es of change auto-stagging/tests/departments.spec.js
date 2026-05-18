const { test, expect } = require('@playwright/test');
const VettedLogosPage = require('../pages/VettedLogosPage');
const DepartmentsPage = require('../pages/DepartmentsPage');

test.describe('Departments Page Tests', () => {
  test.use({ storageState: 'auth.json' });

  test('Navigate to departments page', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos');
    await vettedLogosPage.navigateToDepartments();
    expect(page.url()).toContain('/departments');
  });

  test('Departments page loads', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/departments');
    expect(await page.isVisible('.departments-list')).toBe(true);
  });

  test('Add department functionality', async ({ page }) => {
    const departmentsPage = new DepartmentsPage(page);
    await departmentsPage.navigate('/vetted-logos/departments');
    await departmentsPage.addDepartment('Test Department', 'A test department description');
    expect(await departmentsPage.verifyDepartmentAdded('Test Department')).toBe(true);
  });

  test('Edit department', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/departments');
    await page.click('.department-item .edit');
    await page.fill('input[name="name"]', 'Updated Department');
    await page.click('button:has-text("Save")');
    expect(await page.isVisible('text=Updated Department')).toBe(true);
  });

  test('Delete department', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/departments');
    await page.click('.department-item .delete');
    await page.click('button:has-text("Confirm")');
    // Verify deleted
  });

  test('Department hierarchy', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/departments');
    expect(await page.isVisible('.department-tree')).toBe(true);
  });

  test('Assign users to department', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/departments');
    await page.click('.department-item .assign-users');
    expect(await page.isVisible('.user-assignment')).toBe(true);
  });

  test('Search departments', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/departments');
    await page.fill('input[placeholder*="search"]', 'support');
    await page.click('button:has-text("Search")');
    // Verify search
  });

  test('Department routing rules', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/departments');
    await page.click('.department-item .routing');
    expect(await page.isVisible('.routing-rules')).toBe(true);
  });

  test('Department performance', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/departments');
    await page.click('.department-item .performance');
    expect(await page.isVisible('.performance-metrics')).toBe(true);
  });

  test('Department settings', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/departments');
    await page.click('.department-item .settings');
    expect(await page.isVisible('.department-settings')).toBe(true);
  });
});