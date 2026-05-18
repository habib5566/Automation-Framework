const { test: baseTest, expect: baseExpect } = require('@playwright/test');
const logger = require('../../utils/logger');

const test = baseTest.extend({
  _testLogger: [
    async ({}, use, testInfo) => {
      logger.info(`Start: ${testInfo.titlePath.join(' > ')}`);
      await use();
      if (testInfo.status === 'passed') {
        logger.info(`Pass: ${testInfo.titlePath.join(' > ')}`);
      } else {
        logger.error(`Fail: ${testInfo.titlePath.join(' > ')}`, testInfo.error);
      }
    },
    { auto: true },
  ],
});

const expect = baseExpect;

module.exports = { test, expect };
