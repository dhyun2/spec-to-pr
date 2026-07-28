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
const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
]);

const server = createServer(async (request, response) => {
  try {
    const requested = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
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
      requiredAssertionIds: [`assert-shop-${state}`],
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
      assert.equal(await page.locator("button").isDisabled(), state === "unavailable");
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
      await writeFile(receiptPath, receiptBytes);
      captures.push({
        state,
        fixtureId: ready.fixtureId,
        fixtureDigest,
        stateContractDigest,
        width: decoded.width,
        height: decoded.height,
        receiptDigest: `sha256:${createHash("sha256").update(receiptBytes).digest("hex")}`,
        receipt,
      });
    } finally {
      await context.close();
    }
  }

  execFileSync(
    "pnpm",
    [
      "vitest",
      "run",
      "tests/unit/figma-capture-contract.test.ts",
      "tests/unit/visual-normalizer.test.ts",
      "tests/unit/capture-receipt.test.ts",
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
      "persisted Figma target|repairs implementation across visual packets|pinned publication|workspace binding",
    ],
    { cwd: root, env: process.env, stdio: "inherit" },
  );

  process.stdout.write(
    `${JSON.stringify({ status: "passed", mode: "figma", captures }, null, 2)}\n`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(outputRoot, { recursive: true, force: true });
}
