import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "playwright/test";

const origin = requiredEnvironment("CASE4_ORIGIN");
const state = requiredEnvironment("CASE4_STATE");
const observationPath = requiredEnvironment("CASE4_OBSERVATION_PATH");
const screenshotPath = requiredEnvironment("CASE4_SCREENSHOT_PATH");
const targetId = requiredEnvironment("CASE4_TARGET_ID");
const observationRepositoryPath = requiredEnvironment("CASE4_OBSERVATION_REPOSITORY_PATH");
const screenshotRepositoryPath = requiredEnvironment("CASE4_SCREENSHOT_REPOSITORY_PATH");

test.use({
  viewport: { width: 360, height: 800 },
  deviceScaleFactor: 1,
  locale: "ko-KR",
  colorScheme: "light",
  reducedMotion: "reduce",
  timezoneId: "Asia/Seoul",
  permissions: ["clipboard-read", "clipboard-write"],
});

test("case4 focused UI assertions", async ({ page }, testInfo) => {
  const requestedResources = [];
  page.on("request", (request) => {
    requestedResources.push(new URL(request.url()).pathname);
  });

  await page.goto(`${origin}/?state=${state}`);
  await page.waitForFunction(() => window.__CASE4_READY__ !== undefined);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const ready = await page.evaluate(() => window.__CASE4_READY__);
  expect(ready.fixtureId).toBe(`fixture:shop-${state}`);
  expect(ready.assetCount).toBeGreaterThanOrEqual(1);
  expect(await page.locator("main").evaluate((node) => node.scrollHeight)).toBe(1824);

  await expect(page.getByRole("heading", { level: 1, name: "내 주변 충전소" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "화면 비교" })).toBeVisible();
  const copyButton = page.getByRole("button", { name: "비교 링크 복사", exact: true });
  await expect(copyButton).toBeVisible();
  await expect(page.getByRole("img", { name: "기본 상태", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "사용 가능", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "사용 불가", exact: true })).toBeVisible();
  if (state === "available") {
    await expect(page.getByRole("button", { name: "길 안내 시작" })).toBeEnabled();
  } else {
    await expect(page.getByRole("button", { name: "현재 이용할 수 없어요" })).toBeDisabled();
  }

  const focusBefore = await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    return document.activeElement?.tagName ?? "";
  });
  expect(focusBefore).toBe("BODY");
  await page.keyboard.press("Tab");
  await expect(copyButton).toBeFocused();
  const focusAfter = await page.evaluate(() => document.activeElement?.id ?? "");
  const focusVisible = await copyButton.evaluate((element) => element.matches(":focus-visible"));
  expect(focusAfter).toBe("copy-link");
  expect(focusVisible).toBe(true);

  await copyButton.click();
  await expect(page.getByRole("status")).toHaveText("비교 링크를 복사했습니다");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
  const clickOutcome = "clipboard matches current URL";

  await page.getByRole("status").evaluate((element) => {
    element.textContent = "";
  });
  await copyButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toHaveText("비교 링크를 복사했습니다");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
  const keyboardOutcome = "clipboard matches current URL";

  const observation = await page.evaluate(() => {
    const rect = (selector) => {
      const value = document.querySelector(selector).getBoundingClientRect();
      return {
        x: value.x,
        y: value.y,
        width: value.width,
        height: value.height,
      };
    };
    const tableStyle = getComputedStyle(document.querySelector("[data-ui=comparison-table]"));
    const icons = Object.fromEntries(
      ["spot", "circle", "close"].map((icon) => {
        const element = document.querySelector(`[data-icon="${icon}"]`);
        const style = getComputedStyle(element);
        return [
          icon,
          {
            inlineColor: element.style.color,
            width: style.width,
            height: style.height,
            color: style.color,
            alignment: style.alignSelf,
            flexShrink: style.flexShrink,
          },
        ];
      }),
    );
    return {
      ready: window.__CASE4_READY__,
      documentReadyState: document.readyState,
      fontsReady: document.fonts.status === "loaded",
      imagesReady: [...document.images].every((image) => image.complete && image.naturalWidth > 0),
      images: {
        left: rect("[data-ui=left-image]"),
        right: rect("[data-ui=right-image]"),
      },
      table: {
        rect: rect("[data-ui=comparison-table]"),
        borderTopStyle: tableStyle.borderTopStyle,
        borderBottomStyle: tableStyle.borderBottomStyle,
        borderLeftStyle: tableStyle.borderLeftStyle,
        borderRightStyle: tableStyle.borderRightStyle,
      },
      copyButton: {
        rect: rect("[data-ui=copy-button]"),
        accessibleName: document.querySelector("[data-ui=copy-button]").getAttribute("aria-label"),
      },
      icons,
      rootSemanticTokens: {
        "--semantic-text-tertiary": getComputedStyle(document.documentElement)
          .getPropertyValue("--semantic-text-tertiary")
          .trim(),
        "--semantic-status-positive": getComputedStyle(document.documentElement)
          .getPropertyValue("--semantic-status-positive")
          .trim(),
        "--semantic-status-negative": getComputedStyle(document.documentElement)
          .getPropertyValue("--semantic-status-negative")
          .trim(),
      },
      headingOrder: [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
        .map((heading) => heading.tagName.slice(1))
        .join(","),
      userAgent: navigator.userAgent,
    };
  });

  expect(observation.images.right).toEqual({
    x: 184,
    y: observation.images.left.y,
    width: 156,
    height: 88,
  });
  expect(observation.copyButton.rect.x).toBeCloseTo(308, 1);
  expect(Math.abs(observation.copyButton.rect.y - 16)).toBeLessThanOrEqual(0.5);
  expect(observation.copyButton.rect.width).toBe(32);
  expect(observation.copyButton.rect.height).toBe(32);
  for (const border of [
    observation.table.borderTopStyle,
    observation.table.borderBottomStyle,
    observation.table.borderLeftStyle,
    observation.table.borderRightStyle,
  ]) {
    expect(border).toBe("solid");
  }
  const iconExpectations = {
    spot: {
      inlineColor: "var(--semantic-text-tertiary)",
      color: "rgb(107, 114, 128)",
    },
    circle: {
      inlineColor: "var(--semantic-status-positive)",
      color: "rgb(15, 107, 55)",
    },
    close: {
      inlineColor: "var(--semantic-status-negative)",
      color: "rgb(159, 18, 57)",
    },
  };
  for (const [icon, expected] of Object.entries(iconExpectations)) {
    expect(observation.icons[icon]).toEqual({
      inlineColor: expected.inlineColor,
      width: "16px",
      height: "16px",
      color: expected.color,
      alignment: "center",
      flexShrink: "0",
    });
  }
  expect(observation.headingOrder).toBe("1,2");
  expect(observation.copyButton.accessibleName).toBe("비교 링크 복사");
  expect(requestedResources).toEqual(
    expect.arrayContaining([
      "/ui-consumer/consumer.js",
      "/ui-consumer/index.js",
      "/ui-consumer/icons/vue.js",
    ]),
  );

  await mkdir(path.dirname(observationPath), { recursive: true });
  await mkdir(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const screenshotDigest = sha256(await readFile(screenshotPath));
  const assertionObservations = {
    "paired-image-geometry": observation.images.right,
    "table-border-top": observation.table.borderTopStyle,
    "table-border-bottom": observation.table.borderBottomStyle,
    "table-border-left": observation.table.borderLeftStyle,
    "table-border-right": observation.table.borderRightStyle,
    "copy-button-geometry": observation.copyButton.rect,
    ...Object.fromEntries(
      ["spot", "circle", "close"].flatMap((icon) => [
        [`${icon}-icon-width`, observation.icons[icon].width],
        [`${icon}-icon-height`, observation.icons[icon].height],
        [`${icon}-icon-color`, observation.icons[icon].color],
        [`${icon}-icon-token`, observation.icons[icon].inlineColor],
        [`${icon}-icon-alignment`, observation.icons[icon].alignment],
        [`${icon}-icon-flex-shrink`, observation.icons[icon].flexShrink],
      ]),
    ),
    "copy-button-focus-order": `${focusBefore}->${focusAfter}`,
    "copy-button-focus-visible": focusVisible,
    "heading-order": observation.headingOrder,
    "copy-button-name": observation.copyButton.accessibleName,
    "copy-click": clickOutcome,
    "copy-keyboard": keyboardOutcome,
  };
  const observationEnvelope = {
    schemaVersion: "ui-assertion-observation-v1",
    targetId,
    state,
    fixtureId: ready.fixtureId,
    screenshot: {
      path: screenshotRepositoryPath,
      digest: screenshotDigest,
    },
    observations: assertionObservations,
    diagnostics: {
      ...observation,
      focusBefore,
      focusAfter,
      focusVisible,
      clickOutcome,
      keyboardOutcome,
      route: page.url(),
      requestedResources,
    },
  };
  const observationBytes = Buffer.from(`${JSON.stringify(observationEnvelope, null, 2)}\n`, "utf8");
  await writeFile(observationPath, observationBytes);
  const binding = {
    targetId,
    state,
    fixtureId: ready.fixtureId,
    observation: {
      path: observationRepositoryPath,
      digest: sha256(observationBytes),
    },
    screenshot: {
      path: screenshotRepositoryPath,
      digest: screenshotDigest,
    },
  };
  testInfo.annotations.push({
    type: "spec-to-pr-ui-binding",
    description: JSON.stringify(binding),
  });
  await testInfo.attach("spec-to-pr-ui-observation", {
    body: observationBytes,
    contentType: "application/vnd.spec-to-pr.ui-observation+json",
  });
});

function requiredEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
