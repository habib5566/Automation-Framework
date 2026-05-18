'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { assertHttpOk, routeKey } = require('./crmPath.js');

test('assertHttpOk accepts 2xx and 3xx', () => {
  assert.strictEqual(assertHttpOk(200), true);
  assert.strictEqual(assertHttpOk(302), true);
  assert.strictEqual(assertHttpOk(399), true);
});

test('assertHttpOk rejects 4xx/5xx and garbage', () => {
  assert.strictEqual(assertHttpOk(400), false);
  assert.strictEqual(assertHttpOk(500), false);
  assert.strictEqual(assertHttpOk(NaN), false);
});

test('routeKey extracts admin segment', () => {
  assert.strictEqual(routeKey('/crm-pay/admin/dashboard'), 'dashboard');
  assert.strictEqual(routeKey('/crm-pay/admin/brief/list'), 'brief-list');
  assert.strictEqual(routeKey('/crm-pay/admin/activity-logs'), 'activity-logs');
});
