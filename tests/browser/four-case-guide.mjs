import assert from "node:assert/strict";

import { chromium } from "playwright";

const origin = process.env.GUIDE_BASE_URL ?? "http://127.0.0.1:3000/spec-to-pr";
const cases = [
  { value: "brief", ko: "1. 기획서 → draft PR", en: "1. Brief → draft PR" },
  {
    value: "legacy",
    ko: "2. 레거시 마이그레이션 → draft PR",
    en: "2. Legacy migration → draft PR",
  },
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
const experiencePages = [
  {
    value: "home",
    path: "",
    ko: "SpecToPR",
    en: "SpecToPR",
    marker: '[data-testid="guide-hero"]',
  },
  {
    value: "chooser",
    path: "/usage/",
    ko: "어디서 시작하나요?",
    en: "Where are you starting from?",
    marker: '[data-testid="mode-chooser"]',
  },
  {
    value: "pipeline",
    path: "/concepts/pipeline",
    ko: "Run은 어떻게 움직이나요?",
    en: "How a Run moves",
    marker: '[data-testid="run-pipeline"]',
  },
  {
    value: "reviews",
    path: "/concepts/reviews",
    ko: "에이전트는 무엇을 검증하나요?",
    en: "What each agent verifies",
    marker: '[data-testid="agent-review-map"]',
  },
  {
    value: "visual-verification",
    path: "/concepts/visual-verification",
    ko: "화면 일치율은 어떻게 계산하나요?",
    en: "How visual similarity is computed",
    marker: '[data-testid="visual-proof"]',
  },
];

async function createPage(browser, viewport) {
  return browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: viewport.name === "mobile" ? "dark" : "light",
    reducedMotion: viewport.name === "mobile" ? "reduce" : "no-preference",
  });
}

async function assertFocusVisible(locator, label) {
  assert.equal(
    await locator.evaluate((element) => element.matches(":focus-visible")),
    true,
    `${label}:visible keyboard focus`,
  );
}

async function assertSkipLinkActivation(page, label) {
  const skipLink = page.locator('a[href="#__docusaurus_skipToContent_fallback"]');
  await skipLink.focus();
  await assertFocusVisible(skipLink, `${label}:skip link`);
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      window.location.hash === "#__docusaurus_skipToContent_fallback" &&
      (document.activeElement?.id === "__docusaurus_skipToContent_fallback" ||
        document
          .querySelector("#__docusaurus_skipToContent_fallback")
          ?.contains(document.activeElement)),
  );
}

async function assertTextContrast(page, label) {
  const samples = await page.evaluate(() => {
    const parseRgb = (value) => {
      const values = value.match(/[\d.]+/g)?.map(Number) ?? [];
      if (value.startsWith("color(srgb")) {
        return {
          red: (values[0] ?? 0) * 255,
          green: (values[1] ?? 0) * 255,
          blue: (values[2] ?? 0) * 255,
          alpha: values[3] ?? 1,
        };
      }
      return {
        red: values[0] ?? 0,
        green: values[1] ?? 0,
        blue: values[2] ?? 0,
        alpha: values[3] ?? 1,
      };
    };
    const opaqueBackground = (element) => {
      let current = element;
      while (current) {
        const color = parseRgb(getComputedStyle(current).backgroundColor);
        if (color.alpha > 0.99) return color;
        current = current.parentElement;
      }
      return { red: 255, green: 255, blue: 255, alpha: 1 };
    };
    const luminance = ({ red, green, blue }) => {
      const linear = [red, green, blue].map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const ratio = (foreground, background) => {
      const light = Math.max(luminance(foreground), luminance(background));
      const dark = Math.min(luminance(foreground), luminance(background));
      return (light + 0.05) / (dark + 0.05);
    };

    return [
      { selector: "main .theme-doc-markdown p", required: true },
      { selector: ".navbar__brand", required: true },
      { selector: ".footer__link-item", required: true },
      { selector: '[data-testid="guide-hero"] > p', required: false },
      { selector: '[data-testid="mode-chooser"] a span:nth-child(3)', required: false },
      { selector: '[data-testid="run-pipeline"] button strong', required: false },
      { selector: '[data-testid="agent-review-map"] article p', required: false },
      { selector: '[data-testid="visual-proof"] p span', required: false },
      { selector: "aside[aria-label] > div > p", required: false },
    ].map(({ selector, required }) => {
      const element = [...document.querySelectorAll(selector)].find((candidate) => {
        const style = getComputedStyle(candidate);
        return style.display !== "none" && style.visibility !== "hidden";
      });
      if (!element) return { selector, required, missing: true, ratio: 0 };
      return {
        selector,
        required,
        missing: false,
        ratio: ratio(parseRgb(getComputedStyle(element).color), opaqueBackground(element)),
      };
    });
  });

  for (const sample of samples) {
    if (sample.missing && !sample.required) continue;
    assert.equal(sample.missing, false, `${label}:${sample.selector}:contrast sample`);
    assert.ok(
      sample.ratio >= 4.5,
      `${label}:${sample.selector}:contrast ${sample.ratio.toFixed(2)}`,
    );
  }
}

async function assertKeyboardTraversal(page, label) {
  const target = page.locator("#__docusaurus_skipToContent_fallback");
  await target.focus();
  for (let index = 0; index < 4; index += 1) {
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    const state = await focused.evaluate((element) => ({
      interactive: element.matches(
        'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
      visible: element.matches(":focus-visible"),
    }));
    assert.equal(state.interactive, true, `${label}:keyboard stop ${index + 1} is interactive`);
    assert.equal(state.visible, true, `${label}:keyboard stop ${index + 1} has visible focus`);
  }
}

async function assertAccessibleStructure(page, locale, viewport, label) {
  assert.equal(
    await page.locator("html").getAttribute("lang"),
    locale.name === "ko" ? "ko-KR" : "en-US",
    `${label}:html lang`,
  );
  assert.equal(
    await page.locator("html").getAttribute("data-theme"),
    viewport.name === "mobile" ? "dark" : "light",
    `${label}:preferred color scheme`,
  );
  assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1, `${label}:unique h1`);
  assert.equal(await page.locator("main").count(), 1, `${label}:main landmark`);
  assert.ok((await page.locator("nav").count()) > 0, `${label}:nav landmark`);
  assert.ok((await page.locator("footer").count()) > 0, `${label}:footer landmark`);
  assert.equal(
    await page.locator('a[href="#__docusaurus_skipToContent_fallback"]').count(),
    1,
    `${label}:skip link`,
  );

  const duplicateIds = await page.evaluate(() => {
    const counts = new Map();
    for (const element of document.querySelectorAll("[id]")) {
      const id = element.id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return [...counts].filter(([, count]) => count > 1).map(([id]) => id);
  });
  assert.deepEqual(duplicateIds, [], `${label}:duplicate ids`);

  const unnamedInteractive = await page.evaluate(() =>
    [...document.querySelectorAll("a[href], button")]
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const visible = style.display !== "none" && style.visibility !== "hidden";
        if (!visible || element.closest('[aria-hidden="true"]')) return false;
        const text = element.textContent?.trim() ?? "";
        const aria = element.getAttribute("aria-label")?.trim() ?? "";
        const title = element.getAttribute("title")?.trim() ?? "";
        const imageAlt = element.querySelector("img[alt]")?.getAttribute("alt")?.trim() ?? "";
        return text === "" && aria === "" && title === "" && imageAlt === "";
      })
      .map((element) => element.outerHTML.slice(0, 180)),
  );
  assert.deepEqual(unnamedInteractive, [], `${label}:interactive accessible names`);
  await assertSkipLinkActivation(page, label);
  await assertTextContrast(page, label);
  await assertKeyboardTraversal(page, label);

  const media = await page.evaluate(() => ({
    dark: matchMedia("(prefers-color-scheme: dark)").matches,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
    scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    cardTransition: (() => {
      const card = document.querySelector('[data-testid="mode-chooser"] a');
      return card ? getComputedStyle(card).transitionDuration : null;
    })(),
  }));
  assert.equal(media.dark, viewport.name === "mobile", `${label}:dark media preference`);
  assert.equal(media.reduced, viewport.name === "mobile", `${label}:motion media preference`);
  if (viewport.name === "mobile") {
    assert.equal(media.scrollBehavior, "auto", `${label}:reduced-motion scrolling`);
    if (media.cardTransition !== null) {
      assert.ok(
        media.cardTransition.split(",").every((duration) => duration.trim() === "0s"),
        `${label}:reduced-motion card transition ${media.cardTransition}`,
      );
    }
  }
}

async function assertMobileNavigation(page, locale, targetPath, label) {
  const toggle = page.locator(".navbar__toggle");
  await toggle.focus();
  assert.equal(await toggle.evaluate((element) => document.activeElement === element), true);
  await assertFocusVisible(toggle, `${label}:mobile toggle`);
  await page.keyboard.press("Enter");
  assert.equal(await toggle.getAttribute("aria-expanded"), "true", `${label}:mobile menu expanded`);
  await page.locator(".navbar-sidebar").waitFor();

  if ((await page.locator(".navbar-sidebar__items--show-secondary").count()) > 0) {
    await page.locator(".navbar-sidebar__back").click({ force: true });
    await page.waitForFunction(
      () => !document.querySelector(".navbar-sidebar__item.menu")?.hasAttribute("inert"),
    );
  }
  const languageMenu = page.locator(".navbar-sidebar a[role=button]").filter({
    has: page.locator("svg[class*=iconLanguage]"),
  });
  await languageMenu.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  assert.equal(
    await languageMenu.evaluate((element) => document.activeElement === element),
    true,
    `${label}:language menu keyboard focus`,
  );
  await assertFocusVisible(languageMenu, `${label}:language menu`);
  await page.keyboard.press("Enter");

  const alternativeLanguage = locale.name === "ko" ? "en-US" : "ko-KR";
  const localeLink = page.locator(`.navbar-sidebar a[lang="${alternativeLanguage}"]`);
  await localeLink.waitFor();
  await localeLink.focus();
  assert.equal(
    await localeLink.evaluate((element) => document.activeElement === element),
    true,
    `${label}:locale link keyboard focus`,
  );
  await assertFocusVisible(localeLink, `${label}:locale link`);
  await Promise.all([
    page.waitForURL((url) => url.pathname === targetPath),
    page.keyboard.press("Enter"),
  ]);

  const destinationToggle = page.locator(".navbar__toggle");
  await destinationToggle.focus();
  await page.keyboard.press("Enter");
  assert.equal(
    await destinationToggle.getAttribute("aria-expanded"),
    "true",
    `${label}:destination menu expanded`,
  );
  const close = page.locator(".navbar-sidebar__close");
  await close.waitFor({ state: "visible" });
  await close.focus();
  await assertFocusVisible(close, `${label}:mobile close`);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => {
    const toggle = document.querySelector(".navbar__toggle");
    return toggle?.getAttribute("aria-expanded") === "false" && document.activeElement === toggle;
  });
  assert.equal(
    await destinationToggle.evaluate((element) => document.activeElement === element),
    true,
    `${label}:focus returns to mobile toggle`,
  );
}

const browser = await chromium.launch({ headless: true });
try {
  for (const locale of locales) {
    for (const testCase of cases) {
      for (const viewport of viewports) {
        const page = await createPage(browser, viewport);
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
        const label = `${locale.name}:${testCase.value}:${viewport.name}`;
        await assertAccessibleStructure(page, locale, viewport, label);

        if (viewport.name === "desktop") {
          const usageLinks = page.locator('nav.menu a.menu__link[href*="/usage/"]');
          assert.equal(await usageLinks.count(), 5, `${locale.name}:sidebar usage links`);
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
        assert.deepEqual(errors, [], `${label}:console errors`);
        if (viewport.name === "mobile") {
          await assertMobileNavigation(
            page,
            locale,
            `/spec-to-pr${locale.alternativePrefix}/usage/${testCase.value}`,
            label,
          );
        }
        await page.close();
      }
    }

    for (const viewport of viewports) {
      const page = await createPage(browser, viewport);
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
      const label = `${locale.name}:comparison:${viewport.name}`;
      await assertAccessibleStructure(page, locale, viewport, label);
      if (viewport.name === "desktop") {
        assert.equal(
          await page.locator('nav.menu a.menu__link[href*="/concepts/"]').count(),
          4,
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
      if (viewport.name === "mobile") {
        await assertMobileNavigation(
          page,
          locale,
          `/spec-to-pr${locale.alternativePrefix}/concepts/comparison`,
          label,
        );
      }
      await page.close();
    }

    for (const experiencePage of experiencePages) {
      for (const viewport of viewports) {
        const page = await createPage(browser, viewport);
        const errors = [];
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
        page.on("pageerror", (error) => errors.push(error.message));

        await page.goto(`${origin}${locale.prefix}${experiencePage.path}`, {
          waitUntil: "networkidle",
        });
        const label = `${locale.name}:${experiencePage.value}:${viewport.name}`;
        await page
          .getByRole("heading", { level: 1, name: experiencePage[locale.titleKey] })
          .waitFor();
        await page.locator(experiencePage.marker).waitFor();
        await assertAccessibleStructure(page, locale, viewport, label);

        if (experiencePage.value === "pipeline") {
          const stages = page.locator('[data-testid="run-pipeline"] button[aria-pressed]');
          assert.equal(await stages.count(), 8, `${label}:eight stage controls`);
          for (let index = 0; index < 8; index += 1) {
            const stage = stages.nth(index);
            await stage.focus();
            await assertFocusVisible(stage, `${label}:stage ${index + 1}`);
            await page.keyboard.press("Enter");
            assert.equal(
              await stage.getAttribute("aria-pressed"),
              "true",
              `${label}:stage ${index + 1} keyboard activation`,
            );
          }
          const detail = page.locator('[data-testid="run-pipeline-detail"]');
          await detail.waitFor();
          assert.ok(
            (await detail.innerText()).includes(
              locale.name === "ko" ? "통과 조건" : "Pass condition",
            ),
            `${label}:stage action and pass condition`,
          );
        }

        if (experiencePage.value === "visual-verification") {
          assert.equal(
            await page.locator('[data-testid="visual-proof"] img').count(),
            4,
            `${label}:four authentic evidence images`,
          );
        }

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        assert.ok(overflow <= 1, `${label}:horizontal overflow ${overflow}px`);
        assert.deepEqual(errors, [], `${label}:console errors`);
        await page.close();
      }
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

  for (const locale of locales) {
    const noScriptPage = await browser.newPage({
      javaScriptEnabled: false,
      viewport: { width: 390, height: 844 },
      colorScheme: "dark",
      reducedMotion: "reduce",
    });
    await noScriptPage.goto(`${origin}${locale.prefix}/concepts/pipeline`, {
      waitUntil: "domcontentloaded",
    });
    await noScriptPage
      .getByRole("heading", { level: 1, name: experiencePages[2][locale.titleKey] })
      .waitFor();
    const fallback = noScriptPage.locator('[data-testid="pipeline-noscript"]');
    await fallback.waitFor();
    const fallbackText = await fallback.innerText();
    for (const stage of [
      "intake",
      "contracts",
      "implementation",
      "functional-review",
      "design-review",
      "report",
      "publish",
      "archive",
    ]) {
      assert.ok(fallbackText.includes(stage), `${locale.name}:no-js:${stage}`);
    }
    assert.ok(
      fallbackText.includes(locale.name === "ko" ? "통과 조건" : "Pass condition"),
      `${locale.name}:no-js:pass conditions`,
    );
    await noScriptPage.close();
  }
} finally {
  await browser.close();
}
