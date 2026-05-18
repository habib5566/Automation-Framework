async function queryVisible(page, selector, options = {}) {
  try {
    return await page.isVisible(selector, options);
  } catch {
    return false;
  }
}

async function safeClick(page, selectors, options = {}) {
  for (const selector of selectors) {
    if (await queryVisible(page, selector, options)) {
      try {
        await page.click(selector, options);
        return true;
      } catch {
        continue;
      }
    }
  }
  return false;
}

async function safeFill(page, selectors, value, options = {}) {
  for (const selector of selectors) {
    if (await queryVisible(page, selector, options)) {
      try {
        await page.fill(selector, value, options);
        return true;
      } catch {
        continue;
      }
    }
  }
  return false;
}

async function safeSelect(page, selectors, value, options = {}) {
  for (const selector of selectors) {
    if (await queryVisible(page, selector, options)) {
      try {
        const element = await page.$(selector);
        if (!element) continue;
        const tagName = await element.evaluate(node => node.tagName.toLowerCase());
        if (tagName === 'select') {
          await page.selectOption(selector, value, options);
          return true;
        }
        await page.fill(selector, value, options);
        return true;
      } catch {
        continue;
      }
    }
  }
  return false;
}

async function safeCheck(page, selectors, options = {}) {
  for (const selector of selectors) {
    if (await queryVisible(page, selector, options)) {
      try {
        await page.check(selector, options);
        return true;
      } catch {
        continue;
      }
    }
  }
  return false;
}

module.exports = {
  queryVisible,
  safeClick,
  safeFill,
  safeSelect,
  safeCheck,
};
