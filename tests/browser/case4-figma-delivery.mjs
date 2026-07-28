import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";
import { PNG } from "pngjs";

const root = path.resolve(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
const playwrightVersion = require("playwright/package.json").version;
const fixtureRoot = path.join(root, "tests/fixtures/case4-figma");
const outputRoot = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-case4-"));
const baselineImage = new PNG({ width: 1, height: 1 });
baselineImage.data.set([29, 78, 216, 255]);
const baselineBytes = PNG.sync.write(baselineImage);
const baselineDigest = `sha256:${createHash("sha256").update(baselineBytes).digest("hex")}`;
const validSourceBytes = await readFile(path.join(fixtureRoot, "index.html"));
const maliciousSourceBytes = await readFile(path.join(fixtureRoot, "baseline-overlay.html"));
const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
]);

const server = createServer(async (request, response) => {
  try {
    const requested = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (requested === "/baseline.png") {
      response.writeHead(200, {
        "content-type": "image/png",
        "cache-control": "no-store",
      });
      response.end(baselineBytes);
      return;
    }
    const relative = requested === "/" ? "index.html" : requested.replace(/^\/+/, "");
    assert.equal(relative.includes(".."), false);
    const filePath = path.join(fixtureRoot, relative);
    response.writeHead(200, {
      "content-type": contentTypes.get(path.extname(filePath)) ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(await readFile(filePath));
  } catch {
    response.writeHead(404).end("not found");
  }
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
assert.notEqual(address, null);
assert.equal(typeof address, "object");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
const browserChannel = "chromium";
const adapterVersion = "capture-runner-v2";
const requiredAssertionIds = [
  "paired-image-geometry",
  "table-border-top",
  "table-border-bottom",
  "table-border-left",
  "table-border-right",
  "copy-button-geometry",
  ...["spot", "circle", "close"].flatMap((icon) => [
    `${icon}-icon-width`,
    `${icon}-icon-height`,
    `${icon}-icon-color`,
    `${icon}-icon-token`,
    `${icon}-icon-alignment`,
    `${icon}-icon-flex-shrink`,
  ]),
  "copy-button-focus-order",
  "copy-button-focus-visible",
  "heading-order",
  "copy-button-name",
  "copy-click",
  "copy-keyboard",
].sort();
const exactDesignBindings = [
  {
    id: "icon-normal-spot",
    figmaComponent: "icon/normal/spot",
    nodeId: "900:1",
    role: "icon",
    resolution: {
      kind: "component",
      module: "@frontend/ui/icons/vue",
      exportName: "Spot",
      props: { size: 16, color: "--semantic-text-tertiary", state: "normal" },
    },
    semanticTokens: [
      {
        role: "icon",
        figmaVariable: "semantic/text/tertiary",
        codeToken: "--semantic-text-tertiary",
      },
    ],
    expectedGeometry: { width: 16, height: 16, alignment: "center", flexShrink: 0 },
  },
  {
    id: "icon-status-circle",
    figmaComponent: "icon/status/circle",
    nodeId: "900:2",
    role: "icon",
    resolution: {
      kind: "component",
      module: "@frontend/ui/icons/vue",
      exportName: "Circle",
      props: { size: 16, color: "--semantic-status-positive", state: "available" },
    },
    semanticTokens: [
      {
        role: "icon",
        figmaVariable: "semantic/status/positive",
        codeToken: "--semantic-status-positive",
      },
    ],
    expectedGeometry: { width: 16, height: 16, alignment: "center", flexShrink: 0 },
  },
  {
    id: "icon-status-close",
    figmaComponent: "icon/status/close",
    nodeId: "900:3",
    role: "icon",
    resolution: {
      kind: "component",
      module: "@frontend/ui/icons/vue",
      exportName: "Close",
      props: { size: 16, color: "--semantic-status-negative", state: "unavailable" },
    },
    semanticTokens: [
      {
        role: "icon",
        figmaVariable: "semantic/status/negative",
        codeToken: "--semantic-status-negative",
      },
    ],
    expectedGeometry: { width: 16, height: 16, alignment: "center", flexShrink: 0 },
  },
];

try {
  const captures = [];
  for (const state of ["available", "unavailable"]) {
    const fixtureBytes = await readFile(path.join(fixtureRoot, `${state}.json`));
    const fixture = JSON.parse(fixtureBytes.toString("utf8"));
    const fixtureDigest = `sha256:${createHash("sha256").update(fixtureBytes).digest("hex")}`;
    const stateContractFields = {
      targetId: `shop-${state}`,
      nodeId: state === "available" ? "2558:4382" : "2558:4383",
      state,
      fixtureId: fixture.id,
      facts: [
        {
          id: "cinema",
          kind: "variant",
          subject: "CINEMA 4K",
          value: fixture.stateFacts.cinema4k,
        },
        {
          id: "money",
          kind: "visibility",
          subject: "G패스 머니",
          value: fixture.stateFacts.gpassMoney,
        },
        {
          id: "parking",
          kind: "text",
          subject: "주차",
          value: fixture.stateFacts.parking,
        },
      ],
      requiredAssertionIds,
    };
    const stateContractDigest = `sha256:${createHash("sha256")
      .update(JSON.stringify(stateContractFields))
      .digest("hex")}`;
    const context = await browser.newContext({
      viewport: { width: 360, height: 800 },
      deviceScaleFactor: 1,
      locale: "ko-KR",
      colorScheme: "light",
      reducedMotion: "reduce",
      timezoneId: "Asia/Seoul",
    });
    const page = await context.newPage();
    try {
      await page.goto(`${origin}/?state=${state}`);
      await page.waitForLoadState("networkidle");
      const readiness = await page.evaluate(async () => {
        await document.fonts.ready;
        const images = [...document.images];
        if (!images.every((image) => image.complete && image.naturalWidth > 0)) {
          throw new Error("images not ready");
        }
        return {
          documentReadyState: document.readyState,
          fontsReady: document.fonts.status === "loaded",
          imagesReady: true,
          assetsReady: window.__CASE4_READY__?.assetCount >= 1,
        };
      });
      assert.deepEqual(readiness, {
        documentReadyState: "complete",
        fontsReady: true,
        imagesReady: true,
        assetsReady: true,
      });
      const ready = await page.evaluate(() => window.__CASE4_READY__);
      assert.equal(ready.fixtureId, `fixture:shop-${state}`);
      assert.deepEqual(ready.stateFacts, fixture.stateFacts);
      assert.ok(ready.assetCount >= 1);
      assert.equal(await page.locator("main").evaluate((node) => node.scrollHeight), 1824);
      assert.equal(await page.locator("h1").textContent(), "내 주변 충전소");
      assert.equal(await page.locator("#action").isDisabled(), state === "unavailable");
      const focusBefore = await page.evaluate(() => {
        document.querySelector("#copy-link").blur();
        document.querySelector("#action").blur();
        return document.activeElement?.tagName ?? "";
      });
      await page.keyboard.press("Tab");
      const focusAfter = await page.evaluate(
        () => document.activeElement?.id ?? document.activeElement?.tagName ?? "",
      );
      const focusVisible = await page
        .locator("#copy-link")
        .evaluate((element) => element.matches(":focus-visible"));
      await page.locator("#copy-link").click();
      const clickOutcome = await page.locator("#copy-link").getAttribute("data-copy-result");
      await page.locator("#copy-link").evaluate((element) => {
        delete element.dataset.copyResult;
      });
      await page.locator("#copy-link").focus();
      await page.keyboard.press("Enter");
      const keyboardOutcome = await page.locator("#copy-link").getAttribute("data-copy-result");
      const uiObservation = await page.evaluate(() => {
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
                exportName: element.dataset.export,
                stateProp: element.dataset.stateProp,
                token: element.dataset.token,
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
            accessibleName: document
              .querySelector("[data-ui=copy-button]")
              .getAttribute("aria-label"),
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
        };
      });
      const geometryAssertion = (id, selector, subject, expected, observed) => ({
        id,
        kind: "geometry",
        selector,
        subject,
        expected,
        observed,
        tolerance: 0.5,
        status: "passed",
      });
      const styleAssertion = (id, selector, subject, property, expected, observed) => ({
        id,
        kind: "computed-style",
        selector,
        subject,
        property,
        expected,
        observed,
        status: "passed",
      });
      const accessibilityAssertion = (id, selector, subject, check, expected, observed) => ({
        id,
        kind: "accessibility",
        selector,
        subject,
        check,
        expected,
        observed,
        status: "passed",
      });
      const interactionAssertion = (id, selector, subject, action, expected, observed) => ({
        id,
        kind: "interaction",
        selector,
        subject,
        action,
        expected,
        observed,
        status: "passed",
      });
      const rightImageExpected = {
        x: 184,
        y: uiObservation.images.left.y,
        width: 156,
        height: 88,
      };
      const uiAssertions = [
        geometryAssertion(
          "paired-image-geometry",
          "[data-ui=right-image]",
          "left and right preview image geometry",
          rightImageExpected,
          uiObservation.images.right,
        ),
        ...[
          ["table-border-top", "border-top-style", uiObservation.table.borderTopStyle],
          ["table-border-bottom", "border-bottom-style", uiObservation.table.borderBottomStyle],
          ["table-border-left", "border-left-style", uiObservation.table.borderLeftStyle],
          ["table-border-right", "border-right-style", uiObservation.table.borderRightStyle],
        ].map(([id, property, observed]) =>
          styleAssertion(
            id,
            "[data-ui=comparison-table]",
            `comparison table ${property}`,
            property,
            "solid",
            observed,
          ),
        ),
        geometryAssertion(
          "copy-button-geometry",
          "[data-ui=copy-button]",
          "copy button size and placement",
          { x: 308, y: 16, width: 32, height: 32 },
          uiObservation.copyButton.rect,
        ),
        ...Object.entries({
          spot: {
            color: "rgb(107, 114, 128)",
            token: "--semantic-text-tertiary",
          },
          circle: {
            color: "rgb(15, 107, 55)",
            token: "--semantic-status-positive",
          },
          close: {
            color: "rgb(159, 18, 57)",
            token: "--semantic-status-negative",
          },
        }).flatMap(([icon, expected]) => {
          const observed = uiObservation.icons[icon];
          return [
            styleAssertion(
              `${icon}-icon-width`,
              `[data-icon=${icon}]`,
              `${icon} icon width`,
              "width",
              "16px",
              observed.width,
            ),
            styleAssertion(
              `${icon}-icon-height`,
              `[data-icon=${icon}]`,
              `${icon} icon height`,
              "height",
              "16px",
              observed.height,
            ),
            styleAssertion(
              `${icon}-icon-color`,
              `[data-icon=${icon}]`,
              `${icon} icon computed color`,
              "color",
              expected.color,
              observed.color,
            ),
            styleAssertion(
              `${icon}-icon-token`,
              `[data-icon=${icon}]`,
              `${icon} icon semantic color prop`,
              "color-token",
              expected.token,
              observed.token,
            ),
            styleAssertion(
              `${icon}-icon-alignment`,
              `[data-icon=${icon}]`,
              `${icon} icon alignment`,
              "align-self",
              "center",
              observed.alignment,
            ),
            styleAssertion(
              `${icon}-icon-flex-shrink`,
              `[data-icon=${icon}]`,
              `${icon} icon flex shrink`,
              "flex-shrink",
              "0",
              observed.flexShrink,
            ),
          ];
        }),
        accessibilityAssertion(
          "copy-button-focus-order",
          "[data-ui=copy-button]",
          "keyboard focus before and after Tab",
          "keyboard-focus",
          "BODY->copy-link",
          `${focusBefore}->${focusAfter}`,
        ),
        accessibilityAssertion(
          "copy-button-focus-visible",
          "[data-ui=copy-button]",
          "visible keyboard focus",
          "focus-visible",
          true,
          focusVisible,
        ),
        accessibilityAssertion(
          "heading-order",
          "main",
          "ordered heading levels",
          "heading-order",
          "1,2",
          uiObservation.headingOrder,
        ),
        accessibilityAssertion(
          "copy-button-name",
          "[data-ui=copy-button]",
          "copy button accessible name",
          "accessible-name",
          "비교 링크 복사",
          uiObservation.copyButton.accessibleName,
        ),
        interactionAssertion(
          "copy-click",
          "[data-ui=copy-button]",
          "copy click result",
          "click",
          "copied",
          clickOutcome,
        ),
        interactionAssertion(
          "copy-keyboard",
          "[data-ui=copy-button]",
          "copy Enter result",
          "keyboard",
          "copied",
          keyboardOutcome,
        ),
      ];
      assert.deepEqual(uiAssertions.map((assertion) => assertion.id).sort(), requiredAssertionIds);
      for (const assertion of uiAssertions) {
        if (assertion.kind === "geometry") {
          for (const key of ["x", "y", "width", "height"]) {
            assert.ok(
              Math.abs(assertion.expected[key] - assertion.observed[key]) <= assertion.tolerance,
              `${assertion.id} ${key}: expected ${assertion.expected[key]}, observed ${assertion.observed[key]}`,
            );
          }
        } else {
          assert.deepEqual(
            assertion.observed,
            assertion.expected,
            `${assertion.id}: focused UI assertion failed`,
          );
        }
      }
      for (const [index, icon] of ["spot", "circle", "close"].entries()) {
        const observed = uiObservation.icons[icon];
        const binding = exactDesignBindings[index];
        assert.equal(observed.exportName, binding.resolution.exportName);
        assert.equal(observed.stateProp, binding.resolution.props.state);
        assert.equal(observed.token, binding.resolution.props.color);
        assert.ok(uiObservation.rootSemanticTokens[observed.token].length > 0);
      }
      const capturePath = path.join(outputRoot, `${state}.png`);
      await page.screenshot({ path: capturePath, fullPage: true });
      const bytes = await readFile(capturePath);
      const actualDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      const decoded = PNG.sync.read(bytes);
      assert.deepEqual(
        { width: decoded.width, height: decoded.height },
        { width: 360, height: 1824 },
      );
      const receipt = {
        schemaVersion: "visual-capture-receipt-v2",
        reviewPacketId: `packet_${"a".repeat(64)}`,
        headSha: "b".repeat(40),
        targetId: `shop-${state}`,
        route: page.url(),
        state,
        captureKind: "full-frame",
        logicalSize: { width: 360, height: 1824 },
        deviceScaleFactor: 1,
        environment: {
          browser: {
            family: "chromium",
            channel: browserChannel,
            version: browser.version(),
            userAgent: await page.evaluate(() => navigator.userAgent),
          },
          renderer: {
            adapter: "spec-to-pr-playwright",
            adapterVersion,
            playwrightVersion,
          },
          locale: "ko-KR",
          timezone: "Asia/Seoul",
          colorScheme: "light",
          reducedMotion: "reduce",
          serverOrigin: origin,
          readiness,
        },
        fonts: [],
        fixture: {
          id: ready.fixtureId,
          digest: fixtureDigest,
        },
        assets: [{ path: `tests/fixtures/case4-figma/${state}.json`, digest: fixtureDigest }],
        actual: {
          path: `visual/actual/case4/${state}.png`,
          digest: actualDigest,
          bitmapSize: { width: decoded.width, height: decoded.height },
        },
        normalizerVersion: "visual-normalizer-v1",
        capturedAt: "2026-07-28T00:00:00.000Z",
      };
      const receiptPath = path.join(outputRoot, `${state}.receipt.json`);
      const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
      const receiptDigest = `sha256:${createHash("sha256").update(receiptBytes).digest("hex")}`;
      await writeFile(receiptPath, receiptBytes);
      const uiAssertionReport = {
        schemaVersion: "ui-assertions-v1",
        reviewPacketId: receipt.reviewPacketId,
        headSha: receipt.headSha,
        targetId: receipt.targetId,
        fixtureId: receipt.fixture.id,
        captureReceiptDigest: receiptDigest,
        assertions: uiAssertions,
        status: "passed",
      };
      const uiAssertionReportBytes = Buffer.from(
        `${JSON.stringify(uiAssertionReport, null, 2)}\n`,
        "utf8",
      );
      await writeFile(path.join(outputRoot, `${state}.ui-assertions.json`), uiAssertionReportBytes);
      captures.push({
        state,
        fixtureId: ready.fixtureId,
        fixtureDigest,
        stateContractDigest,
        width: decoded.width,
        height: decoded.height,
        receiptDigest,
        receipt,
        uiAssertionReportDigest: `sha256:${createHash("sha256")
          .update(uiAssertionReportBytes)
          .digest("hex")}`,
        uiAssertionReport,
        baselineIsolation: {
          schemaVersion: "baseline-isolation-v1",
          reviewPacketId: receipt.reviewPacketId,
          headSha: receipt.headSha,
          baselineArtifacts: [
            {
              artifactId: `art_${"c".repeat(32)}`,
              path: "visual/case4-baseline.png",
              digest: baselineDigest,
            },
          ],
          checkedSourceFiles: [
            {
              path: "tests/fixtures/case4-figma/index.html",
              digest: `sha256:${createHash("sha256").update(validSourceBytes).digest("hex")}`,
            },
          ],
          requestedResources: [],
          renderedMedia: [],
          violations: [],
          status: "passed",
        },
      });
    } finally {
      await context.close();
    }
  }

  assert.equal(validSourceBytes.includes(Buffer.from("/baseline.png")), false);
  assert.equal(maliciousSourceBytes.includes(Buffer.from("/baseline.png")), true);
  const maliciousContext = await browser.newContext({
    viewport: { width: 360, height: 800 },
    deviceScaleFactor: 1,
    locale: "ko-KR",
    colorScheme: "light",
    reducedMotion: "reduce",
    timezoneId: "Asia/Seoul",
  });
  const maliciousPage = await maliciousContext.newPage();
  const baselineRequests = [];
  maliciousPage.on("request", (request) => {
    if (new URL(request.url()).pathname === "/baseline.png") {
      baselineRequests.push(request.url());
    }
  });
  let maliciousObservation;
  try {
    const baselineResponse = maliciousPage.waitForResponse(
      (response) => new URL(response.url()).pathname === "/baseline.png",
    );
    await maliciousPage.goto(`${origin}/baseline-overlay.html`);
    const response = await baselineResponse;
    await maliciousPage.waitForFunction(() => window.__BASELINE_OVERLAY_READY__ === true);
    const requestedBytes = await response.body();
    assert.equal(
      `sha256:${createHash("sha256").update(requestedBytes).digest("hex")}`,
      baselineDigest,
    );
    assert.ok(baselineRequests.length >= 1);
    const renderedMedia = await maliciousPage.evaluate(() => {
      const overlay = document.querySelector("#baseline-overlay");
      const svgImage = document.querySelector("#baseline-svg");
      const canvas = document.querySelector("#baseline-canvas");
      const overlayStyle = getComputedStyle(overlay);
      return [
        {
          selector: "#baseline-overlay",
          sourceUrl: overlay.currentSrc,
          fullFrame:
            overlayStyle.position === "fixed" &&
            overlayStyle.inset === "0px" &&
            overlay.getBoundingClientRect().width === innerWidth &&
            overlay.getBoundingClientRect().height === innerHeight,
        },
        {
          selector: "#baseline-svg",
          sourceUrl: new URL(svgImage.getAttribute("href"), location.href).href,
        },
        {
          selector: "#baseline-canvas",
          sourceUrl: canvas.dataset.sourceUrl,
          digest: canvas.dataset.digest,
        },
      ];
    });
    assert.equal(renderedMedia[0].fullFrame, true);
    assert.ok(
      renderedMedia.every((media) => new URL(media.sourceUrl).pathname === "/baseline.png"),
    );
    assert.equal(renderedMedia[2].digest, baselineDigest);
    maliciousObservation = {
      checkedSourcePath: "tests/fixtures/case4-figma/baseline-overlay.html",
      checkedSourceDigest: `sha256:${createHash("sha256")
        .update(maliciousSourceBytes)
        .digest("hex")}`,
      requestedResources: [
        {
          url: baselineRequests[0],
          digest: baselineDigest,
        },
      ],
      renderedMedia,
      violationKinds: ["source-reference", "network-request", "rendered-baseline"],
    };
  } finally {
    await maliciousContext.close();
  }

  execFileSync(
    "pnpm",
    [
      "vitest",
      "run",
      "tests/unit/figma-capture-contract.test.ts",
      "tests/unit/visual-normalizer.test.ts",
      "tests/unit/capture-receipt.test.ts",
      "tests/unit/baseline-isolation.test.ts",
      "tests/unit/figma-design-mapping.test.ts",
      "tests/unit/ui-assertion-contract.test.ts",
      "tests/unit/remote-detector.test.ts",
      "tests/unit/workspace-binding.test.ts",
    ],
    { cwd: root, env: process.env, stdio: "inherit" },
  );
  execFileSync(
    "pnpm",
    [
      "vitest",
      "run",
      "tests/integration/publisher-service.test.ts",
      "tests/integration/workflow-service.test.ts",
      "-t",
      "persisted Figma target|baseline isolation|pinned publication|workspace binding",
    ],
    { cwd: root, env: process.env, stdio: "inherit" },
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        status: "passed",
        mode: "figma",
        exactDesignBindings,
        captures,
        maliciousObservation,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(outputRoot, { recursive: true, force: true });
}
