import assert from "node:assert/strict";

import { chromium } from "playwright";

const origin = process.env.GUIDE_BASE_URL ?? "http://127.0.0.1:3000/spec-to-pr";
const cases = [
  { value: "brief", ko: "1. 기획서 → draft PR", en: "1. Brief → draft PR" },
  { value: "legacy", ko: "2. 레거시 변경 → draft PR", en: "2. Legacy change → draft PR" },
  {
    value: "feature",
    ko: "3. 기능 개발 → E2E·영상·draft PR",
    en: "3. Feature → E2E, video, and draft PR",
  },
  { value: "figma", ko: "4. Figma → 디자인 구현", en: "4. Figma → design implementation" },
];
const locales = [
  { name: "ko", prefix: "", titleKey: "ko", alternativePrefix: "/en" },
  { name: "en", prefix: "/en", titleKey: "en", alternativePrefix: "" },
];
const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
];
const comparison = {
  value: "comparison",
  ko: "Spec-to-development 비교와 채택 정책",
  en: "Spec-to-development comparison and adoption policy",
};

const browser = await chromium.launch({ headless: true });
try {
  for (const locale of locales) {
    for (const testCase of cases) {
      for (const viewport of viewports) {
        const page = await browser.newPage({ viewport });
        const errors = [];
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
        page.on("pageerror", (error) => errors.push(error.message));

        await page.goto(`${origin}${locale.prefix}/usage/${testCase.value}`, {
          waitUntil: "networkidle",
        });
        await page.getByRole("heading", { level: 1, name: testCase[locale.titleKey] }).waitFor();
        await page.locator(`#use-this-case-${testCase.value}`).locator("..").waitFor();
        assert.equal(await page.getByRole("tab").count(), 0);

        if (viewport.name === "desktop") {
          const usageLinks = page.locator('nav.menu a.menu__link[href*="/usage/"]');
          assert.equal(await usageLinks.count(), 4, `${locale.name}:sidebar usage links`);
        }
        assert.ok(
          (await page
            .locator(`a[href*="/spec-to-pr${locale.alternativePrefix}/usage/${testCase.value}"]`)
            .count()) > 0,
          `${locale.name}:${testCase.value}:locale link`,
        );

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        assert.ok(
          overflow <= 1,
          `${locale.name}:${testCase.value}:${viewport.name}:horizontal overflow ${overflow}px`,
        );
        assert.deepEqual(
          errors,
          [],
          `${locale.name}:${testCase.value}:${viewport.name}:console errors`,
        );
        await page.close();
      }
    }

    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (error) => errors.push(error.message));

      await page.goto(`${origin}${locale.prefix}/concepts/${comparison.value}`, {
        waitUntil: "networkidle",
      });
      await page.getByRole("heading", { level: 1, name: comparison[locale.titleKey] }).waitFor();
      await page.locator("#comparison-matrix").locator("..").waitFor();
      await page.getByRole("link", { name: "GitHub Spec Kit" }).first().waitFor();
      await page.getByRole("link", { name: "Chrome DevTools MCP" }).first().waitFor();
      if (viewport.name === "desktop") {
        assert.equal(
          await page.locator('nav.menu a.menu__link[href*="/concepts/"]').count(),
          2,
          `${locale.name}:sidebar concept links`,
        );
      }
      assert.ok(
        (await page
          .locator(`a[href*="/spec-to-pr${locale.alternativePrefix}/concepts/comparison"]`)
          .count()) > 0,
        `${locale.name}:comparison:locale link`,
      );
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert.ok(overflow <= 1, `${locale.name}:comparison:${viewport.name}:overflow ${overflow}px`);
      assert.deepEqual(errors, [], `${locale.name}:comparison:${viewport.name}:console errors`);
      await page.close();
    }
  }

  const redirectPage = await browser.newPage();
  for (const redirect of [
    { from: `${origin}/usage/recipes`, to: "/spec-to-pr/usage/brief" },
    { from: `${origin}/en/usage/recipes`, to: "/spec-to-pr/en/usage/brief" },
  ]) {
    await redirectPage.goto(redirect.from, { waitUntil: "networkidle" });
    await redirectPage.waitForURL((url) => url.pathname === redirect.to);
  }
  await redirectPage.close();
} finally {
  await browser.close();
}
