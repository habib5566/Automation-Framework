# E2E Tests for Auto-Stagging Dashboard

This project contains end-to-end tests for the auto-stagging dashboard application.

## Setup

1. Install Node.js and npm
2. Install dependencies: `npm install`
3. Install Playwright browsers: `npx playwright install`

## Test Structure

- `tests/auth.setup.js` - Authentication setup
- `tests/login.spec.js` - Login tests
- `tests/visitors.spec.js` - Visitors page tests
- `tests/chat-logs.spec.js` - Chat logs tests
- `tests/analytics.spec.js` - Analytics tests
- `tests/monitor.spec.js` - Monitor tests
- `tests/users.spec.js` - Users management tests
- `tests/tags.spec.js` - Tags management tests
- `tests/canned-responses.spec.js` - Canned responses tests
- `tests/widget-settings.spec.js` - Widget settings tests
- `tests/roles.spec.js` - Roles management tests
- `tests/permissions.spec.js` - Permissions tests
- `tests/triggers.spec.js` - Triggers tests
- `tests/departments.spec.js` - Departments tests
- `tests/banned-visitors.spec.js` - Banned visitors tests
- `tests/personal.spec.js` - Personal settings tests
- `tests/widget.spec.js` - Widget interaction tests

## Running Tests

- Run all tests: `npm test`
- Run with headed browser: `npm run test:headed`
- Run specific test: `npx playwright test tests/login.spec.js`
- Debug tests: `npm run test:debug`
- View reports: `npm run report`

## Test Data

- Login URL: https://staging-dashboard.autobotx.ai/vetted-logos
- Email: hasananwar.sleekhive@gmail.com
- Password: ABCDabcd1234$$
- Widget URL: https://agent-builder-demo-nine.vercel.app/

## Test Matrix

See `test-matrix.csv` for detailed test cases with expected and actual results.

## Reports

- HTML reports: `reports/html-report/`
- JSON results: `reports/test-results.json`
- CSV results: `reports/test-results.csv`

## Page Objects

Located in `pages/` directory:
- BasePage.js - Base page class
- LoginPage.js - Login page
- VettedLogosPage.js - Main dashboard navigation
- UsersPage.js - Users management
- TagsPage.js - Tags management
- CannedResponsesPage.js - Canned responses
- WidgetSettingsPage.js - Widget settings
- RolesPage.js - Roles management
- PermissionsPage.js - Permissions
- TriggersPage.js - Triggers
- DepartmentsPage.js - Departments
- BannedVisitorsPage.js - Banned visitors
- PersonalPage.js - Personal settings
- WidgetPage.js - Widget interaction

## Configuration

- `playwright.config.js` - Playwright configuration
- Base URL: https://staging-dashboard.autobotx.ai
- Screenshots on failure enabled
- Traces retained on failure