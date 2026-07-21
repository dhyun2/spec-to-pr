import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

import { compareVisualPngs } from "../src/visual/visual-comparator.js";

const outputDirectory = path.resolve("website/static/img/guide/visual-proof");
const viewport = { width: 960, height: 560 };

function sha256(content: Buffer) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function checkoutFixture(variant: "baseline" | "actual") {
  const actionColor = variant === "baseline" ? "#0f766e" : "#b45309";

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; }
    body {
      display: grid;
      place-items: center;
      overflow: hidden;
      background: #eef4f2;
      color: #17322f;
      font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif;
    }
    main {
      width: 840px;
      padding: 36px;
      border: 1px solid #d5e4e0;
      border-radius: 18px;
      background: #ffffff;
      box-shadow: 0 22px 55px rgba(23, 50, 47, 0.10);
    }
    header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
    .eyebrow { margin: 0 0 8px; color: #0f766e; font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: 0; font-size: 30px; letter-spacing: -.04em; }
    .order { color: #607571; font: 13px ui-monospace, SFMono-Regular, monospace; }
    .notice { margin: 28px 0 0; padding: 18px 20px; border-left: 4px solid #c2410c; background: #fff7ed; }
    .notice strong { display: block; margin-bottom: 4px; color: #9a3412; }
    .notice p { margin: 0; color: #6c4b3c; font-size: 14px; line-height: 1.55; }
    .content { display: grid; grid-template-columns: 1fr 260px; gap: 28px; margin-top: 28px; }
    .methods { display: grid; gap: 10px; }
    .method { display: flex; align-items: center; justify-content: space-between; padding: 15px 16px; border: 1px solid #d9e5e2; border-radius: 10px; }
    .method span { color: #526965; font-size: 13px; }
    .method strong { font-size: 15px; }
    aside { padding: 18px; border: 1px solid #d9e5e2; border-radius: 12px; background: #f8fbfa; }
    dl { display: grid; grid-template-columns: 1fr auto; gap: 12px; margin: 0; }
    dt { color: #607571; font-size: 13px; }
    dd { margin: 0; font-weight: 700; }
    .total { padding-top: 12px; border-top: 1px solid #d9e5e2; font-size: 17px; }
    footer { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-top: 28px; }
    footer p { margin: 0; color: #607571; font-size: 13px; }
    button { width: 132px; height: 42px; border: 0; border-radius: 8px; background: ${actionColor}; color: #fff; font: 700 14px inherit; }
  </style>
</head>
<body>
  <main aria-label="결제 재시도 상태">
    <header>
      <div><p class="eyebrow">Checkout recovery</p><h1>결제를 다시 시도해 주세요</h1></div>
      <span class="order">ORDER #STP-2407</span>
    </header>
    <section class="notice"><strong>승인이 완료되지 않았습니다</strong><p>카드 정보는 안전하게 유지됩니다. 결제 수단을 확인한 뒤 다시 시도해 주세요.</p></section>
    <div class="content">
      <section class="methods" aria-label="결제 수단">
        <div class="method"><strong>개인 카드</strong><span>Visa ···· 4242</span></div>
        <div class="method"><strong>회사 카드</strong><span>Mastercard ···· 2026</span></div>
      </section>
      <aside><dl><dt>상품 금액</dt><dd>₩48,000</dd><dt>배송비</dt><dd>₩0</dd><dt class="total">결제 금액</dt><dd class="total">₩48,000</dd></dl></aside>
    </div>
    <footer><p>문제가 계속되면 다른 결제 수단을 선택할 수 있습니다.</p><button type="button">다시 시도</button></footer>
  </main>
</body>
</html>`;
}

async function captureFixtures() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    await page.setContent(checkoutFixture("baseline"), { waitUntil: "load" });
    const baseline = await page.screenshot({ type: "png", animations: "disabled" });
    await page.setContent(checkoutFixture("actual"), { waitUntil: "load" });
    const actual = await page.screenshot({ type: "png", animations: "disabled" });
    return { baseline, actual };
  } finally {
    await browser.close();
  }
}

async function main() {
  const { baseline, actual } = await captureFixtures();
  const comparison = await compareVisualPngs({ baseline, actual });
  if (comparison.status !== "passed") {
    throw new Error(
      `Guide fixture must pass the production visual gate; review ratio was ${(comparison.metrics.reviewMatchRatio * 100).toFixed(2)}%`,
    );
  }

  const files = {
    baseline: { path: "baseline.png", digest: sha256(baseline) },
    actual: { path: "actual.png", digest: sha256(actual) },
    diff: { path: "diff.png", digest: sha256(comparison.diff) },
    overlay: { path: "overlay.png", digest: sha256(comparison.overlay) },
  };
  const manifest = {
    schemaVersion: "guide-visual-proof-v1",
    status: comparison.status,
    attempt: 1,
    target: {
      route: "/checkout/retry",
      state: "payment-declined",
      viewport,
      deviceScaleFactor: 1,
      fixture: "guide-checkout-retry-v1",
    },
    metrics: comparison.metrics,
    maskReasons: comparison.maskReasons,
    files,
  };

  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputDirectory, "baseline.png"), baseline),
    writeFile(path.join(outputDirectory, "actual.png"), actual),
    writeFile(path.join(outputDirectory, "diff.png"), comparison.diff),
    writeFile(path.join(outputDirectory, "overlay.png"), comparison.overlay),
    writeFile(
      path.join(outputDirectory, "metrics.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    ),
  ]);

  process.stdout.write(
    `guide visual proof: ${comparison.status}; review ${(comparison.metrics.reviewMatchRatio * 100).toFixed(2)}%; exact ${(comparison.metrics.exactMatchRatio * 100).toFixed(2)}%; ${viewport.width}x${viewport.height}\n`,
  );
}

await main();
