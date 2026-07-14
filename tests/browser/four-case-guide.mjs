import assert from "node:assert/strict";

import { chromium } from "playwright";

const origin = process.env.GUIDE_BASE_URL ?? "http://127.0.0.1:3000/spec-to-pr";
const locales = [
  {
    name: "ko",
    url: `${origin}/usage/recipes`,
    alternative: "/spec-to-pr/en/usage/recipes",
    tabs: ["1. 기획서", "2. 레거시", "3. 기능 개발", "4. Figma"],
  },
  {
    name: "en",
    url: `${origin}/en/usage/recipes`,
    alternative: "/spec-to-pr/usage/recipes",
    tabs: ["1. Brief", "2. Legacy", "3. Feature", "4. Figma"],
  },
];
const values = ["brief", "legacy", "feature", "figma"];
const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
];

const browser = await chromium.launch({ headless: true });
try {
  for (const locale of locales) {
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (error) => errors.push(error.message));

      await page.goto(locale.url, { waitUntil: "networkidle" });
      const tabs = page.getByRole("tab");
      assert.equal(await tabs.count(), 4, `${locale.name}:${viewport.name}:tab count`);

      for (let index = 0; index < values.length; index += 1) {
        const tab = tabs.filter({ hasText: locale.tabs[index] });
        await tab.click();
        assert.equal(await tab.getAttribute("aria-selected"), "true");
        await page.locator(`[data-case-panel="${values[index]}"]`).waitFor({ state: "attached" });
        await page
          .locator(`#use-this-case-${values[index]}`)
          .locator("..")
          .waitFor({ state: "visible" });
      }

      assert.ok(
        (await page.locator(`a[href*="${locale.alternative}"]`).count()) > 0,
        `${locale.name}:${viewport.name}:locale link`,
      );
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      const overflowElements =
        overflow <= 1
          ? []
          : await page.evaluate(() => {
              const candidates = [...document.querySelectorAll("*")]
                .map((element) => {
                  const rect = element.getBoundingClientRect();
                  return {
                    element,
                    tag: element.tagName,
                    className: element.className,
                    text: element.textContent?.trim().slice(0, 80),
                    left: Math.round(rect.left),
                    right: Math.round(rect.right),
                    width: Math.round(rect.width),
                    scrollWidth: element.scrollWidth,
                  };
                })
                .filter(
                  (element) =>
                    element.right > document.documentElement.clientWidth + 1 ||
                    element.scrollWidth > element.width + 1,
                )
                .sort((left, right) => right.right - left.right)
                .slice(0, 12);
              const widest = candidates[0]?.element;
              const ancestors = [];
              for (
                let element = widest;
                element && ancestors.length < 10;
                element = element.parentElement
              ) {
                const rect = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                ancestors.push({
                  tag: element.tagName,
                  className: element.className,
                  left: Math.round(rect.left),
                  right: Math.round(rect.right),
                  width: Math.round(rect.width),
                  scrollWidth: element.scrollWidth,
                  display: style.display,
                  minWidth: style.minWidth,
                  overflowX: style.overflowX,
                });
              }
              return {
                candidates: candidates.map(({ element: _element, ...rest }) => rest),
                ancestors,
              };
            });
      assert.ok(
        overflow <= 1,
        `${locale.name}:${viewport.name}:horizontal overflow ${overflow}px ${JSON.stringify(overflowElements)}`,
      );
      assert.deepEqual(errors, [], `${locale.name}:${viewport.name}:console errors`);
      await page.close();
    }
  }
} finally {
  await browser.close();
}
