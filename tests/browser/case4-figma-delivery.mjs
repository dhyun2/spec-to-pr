import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { chromium } from "playwright";
import { PNG } from "pngjs";

const runFile = promisify(execFile);
const root = path.resolve(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
const playwrightVersion = require("playwright/package.json").version;
const fixtureRoot = path.join(root, "tests/fixtures/case4-figma");
const outputRoot = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-case4-"));
const browserChannel = "chromium";
const adapterVersion = "capture-runner-v2";
const playwrightTestId = "case4 focused UI assertions";

const baselineImage = new PNG({ width: 1, height: 1 });
baselineImage.data.set([29, 78, 216, 255]);
const baselineBytes = PNG.sync.write(baselineImage);
const baselineDigest = digest(baselineBytes);

const sourcePaths = [
  "tests/fixtures/case4-figma/index.html",
  "tests/fixtures/case4-figma/ui-consumer/consumer.js",
  "tests/fixtures/case4-figma/ui-consumer/index.js",
  "tests/fixtures/case4-figma/ui-consumer/icons/vue.js",
  "tests/fixtures/case4-figma/ui-consumer/code-connect.manifest.json",
];
const sourceEvidence = await Promise.all(
  sourcePaths.map(async (repositoryPath) => {
    const bytes = await readFile(path.join(root, repositoryPath));
    return { path: repositoryPath, bytes, digest: digest(bytes) };
  }),
);
const sourceByPath = new Map(sourceEvidence.map((evidence) => [evidence.path, evidence]));
const validSourceBytes = sourceByPath.get(sourcePaths[0]).bytes;
const maliciousSourceBytes = await readFile(path.join(fixtureRoot, "baseline-overlay.html"));

const codeConnectPath = "tests/fixtures/case4-figma/ui-consumer/code-connect.manifest.json";
const codeConnectManifest = JSON.parse(sourceByPath.get(codeConnectPath).bytes.toString("utf8"));
const publicApiCatalogFields = {
  schemaVersion: "figma-public-api-catalog-v1",
  packageName: "@frontend/ui",
  packageVersion: "1.2.3",
  publicBarrels: [
    {
      module: "@frontend/ui",
      path: "tests/fixtures/case4-figma/ui-consumer/index.js",
      digest: sourceByPath.get("tests/fixtures/case4-figma/ui-consumer/index.js").digest,
    },
    {
      module: "@frontend/ui/icons/vue",
      path: "tests/fixtures/case4-figma/ui-consumer/icons/vue.js",
      digest: sourceByPath.get("tests/fixtures/case4-figma/ui-consumer/icons/vue.js").digest,
    },
  ],
  codeConnectManifest: {
    path: codeConnectPath,
    digest: sourceByPath.get(codeConnectPath).digest,
  },
  exports: codeConnectManifest.mappings.map((entry) => ({
    figmaComponent: entry.figmaComponent,
    nodeId: entry.nodeId,
    module: entry.module,
    exportName: entry.exportName,
    allowedProps: entry.allowedProps,
  })),
};
const publicApiCatalog = {
  ...publicApiCatalogFields,
  digest: digest(
    Buffer.from(
      JSON.stringify({
        schemaVersion: publicApiCatalogFields.schemaVersion,
        packageName: publicApiCatalogFields.packageName,
        packageVersion: publicApiCatalogFields.packageVersion,
        publicBarrels: [...publicApiCatalogFields.publicBarrels].sort((left, right) =>
          canonicalCompare(left.module, right.module),
        ),
        codeConnectManifest: publicApiCatalogFields.codeConnectManifest,
        exports: [...publicApiCatalogFields.exports]
          .sort((left, right) =>
            canonicalCompare(
              `${left.figmaComponent}\u0000${left.nodeId}`,
              `${right.figmaComponent}\u0000${right.nodeId}`,
            ),
          )
          .map((entry) => ({
            ...entry,
            allowedProps: [...entry.allowedProps].sort(canonicalCompare),
          })),
      }),
    ),
  ),
};

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
  {
    id: "copy-button",
    figmaComponent: "button/copy",
    nodeId: "900:4",
    role: "component",
    resolution: {
      kind: "component",
      module: "@frontend/ui",
      exportName: "IconButton",
      props: { ariaLabel: "비교 링크 복사", onPress: "copyCurrentUrl" },
    },
    semanticTokens: [
      {
        role: "border",
        figmaVariable: "semantic/border/primary",
        codeToken: "var(--semantic-border-primary)",
      },
    ],
    expectedGeometry: { width: 32, height: 32, alignment: "center", flexShrink: 0 },
  },
];
const designMapping = {
  designSystem: {
    packageName: "@frontend/ui",
    packageVersion: "1.2.3",
    catalogDigest: publicApiCatalog.digest,
    guidanceSkill: "@frontend/codex-skill-design-system",
  },
  publicApiCatalog,
  components: exactDesignBindings,
  fonts: [],
  tokens: [],
};
const implementationBindings = exactDesignBindings.map((binding) => ({
  mappingId: binding.id,
  sourceFile: "tests/fixtures/case4-figma/ui-consumer/consumer.js",
  resolution: {
    kind: "component",
    module: binding.resolution.module,
    exportName: binding.resolution.exportName,
    appliedProps: binding.resolution.props,
    tokenUsages: binding.semanticTokens,
    observedGeometry: binding.expectedGeometry,
  },
}));

const geometryDefinition = (id, selector, subject, expected) => ({
  id,
  kind: "geometry",
  selector,
  subject,
  expected,
  maxTolerance: 0.5,
});
const styleDefinition = (id, selector, subject, property, expected) => ({
  id,
  kind: "computed-style",
  selector,
  subject,
  property,
  expected,
});
const accessibilityDefinition = (id, selector, subject, check, expected) => ({
  id,
  kind: "accessibility",
  selector,
  subject,
  check,
  expected,
});
const interactionDefinition = (id, selector, subject, action, expected) => ({
  id,
  kind: "interaction",
  selector,
  subject,
  action,
  expected,
});
const requiredAssertions = [
  geometryDefinition(
    "paired-image-geometry",
    "[data-ui=right-image]",
    "left and right preview image geometry",
    { x: 184, y: 1110.359375, width: 156, height: 88 },
  ),
  ...["top", "bottom", "left", "right"].map((edge) =>
    styleDefinition(
      `table-border-${edge}`,
      "[data-ui=comparison-table]",
      `comparison table border-${edge}-style`,
      `border-${edge}-style`,
      "solid",
    ),
  ),
  geometryDefinition(
    "copy-button-geometry",
    "[data-ui=copy-button]",
    "copy button size and placement",
    { x: 308, y: 16, width: 32, height: 32 },
  ),
  ...Object.entries({
    spot: {
      color: "rgb(107, 114, 128)",
      token: "var(--semantic-text-tertiary)",
    },
    circle: {
      color: "rgb(15, 107, 55)",
      token: "var(--semantic-status-positive)",
    },
    close: {
      color: "rgb(159, 18, 57)",
      token: "var(--semantic-status-negative)",
    },
  }).flatMap(([icon, expected]) => [
    styleDefinition(
      `${icon}-icon-width`,
      `[data-icon=${icon}]`,
      `${icon} icon width`,
      "width",
      "16px",
    ),
    styleDefinition(
      `${icon}-icon-height`,
      `[data-icon=${icon}]`,
      `${icon} icon height`,
      "height",
      "16px",
    ),
    styleDefinition(
      `${icon}-icon-color`,
      `[data-icon=${icon}]`,
      `${icon} icon computed color`,
      "color",
      expected.color,
    ),
    styleDefinition(
      `${icon}-icon-token`,
      `[data-icon=${icon}]`,
      `${icon} icon semantic color prop`,
      "inline-color-token",
      expected.token,
    ),
    styleDefinition(
      `${icon}-icon-alignment`,
      `[data-icon=${icon}]`,
      `${icon} icon alignment`,
      "align-self",
      "center",
    ),
    styleDefinition(
      `${icon}-icon-flex-shrink`,
      `[data-icon=${icon}]`,
      `${icon} icon flex shrink`,
      "flex-shrink",
      "0",
    ),
  ]),
  accessibilityDefinition(
    "copy-button-focus-order",
    "[data-ui=copy-button]",
    "keyboard focus before and after Tab",
    "keyboard-focus",
    "BODY->copy-link",
  ),
  accessibilityDefinition(
    "copy-button-focus-visible",
    "[data-ui=copy-button]",
    "visible keyboard focus",
    "focus-visible",
    true,
  ),
  accessibilityDefinition(
    "heading-order",
    "main",
    "ordered heading levels",
    "heading-order",
    "1,2",
  ),
  accessibilityDefinition(
    "copy-button-name",
    "[data-ui=copy-button]",
    "copy button accessible name",
    "accessible-name",
    "비교 링크 복사",
  ),
  interactionDefinition(
    "copy-click",
    "[data-ui=copy-button]",
    "copy click result",
    "click",
    "clipboard matches current URL",
  ),
  interactionDefinition(
    "copy-keyboard",
    "[data-ui=copy-button]",
    "copy Enter result",
    "keyboard",
    "clipboard matches current URL",
  ),
].sort((left, right) => canonicalCompare(left.id, right.id));

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
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

try {
  const captures = [];
  for (const state of ["available", "unavailable"]) {
    const fixtureBytes = await readFile(path.join(fixtureRoot, `${state}.json`));
    const fixture = JSON.parse(fixtureBytes.toString("utf8"));
    const fixtureDigest = digest(fixtureBytes);
    const screenshotPath = path.join(outputRoot, `${state}.png`);
    const observationPath = path.join(outputRoot, `${state}.observation.json`);
    const resultPath = path.join(outputRoot, `${state}.playwright-result.json`);

    await runFile(
      "pnpm",
      [
        "exec",
        "playwright",
        "test",
        "tests/browser/case4-figma-consumer.spec.mjs",
        "--reporter=json",
        "--workers=1",
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          CASE4_ORIGIN: origin,
          CASE4_STATE: state,
          CASE4_OBSERVATION_PATH: observationPath,
          CASE4_SCREENSHOT_PATH: screenshotPath,
          PLAYWRIGHT_JSON_OUTPUT_NAME: resultPath,
        },
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    const observation = JSON.parse(await readFile(observationPath, "utf8"));
    assert.equal(observation.ready.fixtureId, fixture.id);
    assert.deepEqual(observation.ready.stateFacts, fixture.stateFacts);
    assert.equal(observation.documentReadyState, "complete");
    assert.equal(observation.fontsReady, true);
    assert.equal(observation.imagesReady, true);
    assert.ok(observation.ready.assetCount >= 1);

    const uiAssertions = requiredAssertions.map((definition) => ({
      ...definition,
      observed: observedValue(definition, observation),
      status: "passed",
    }));
    for (const assertion of uiAssertions) {
      if (assertion.kind === "geometry") {
        for (const key of ["x", "y", "width", "height"]) {
          assert.ok(
            Math.abs(assertion.expected[key] - assertion.observed[key]) <= assertion.maxTolerance,
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
        ...exactDesignBindings.filter((binding) => binding.role === "icon").flatMap(iconStateFacts),
      ],
      requiredAssertions,
      designBindingIds: exactDesignBindings
        .filter((binding) => binding.role === "icon")
        .map((binding) => binding.id)
        .sort(canonicalCompare),
    };
    const stateContractDigest = digest(
      Buffer.from(
        JSON.stringify({
          targetId: stateContractFields.targetId,
          nodeId: stateContractFields.nodeId,
          state: stateContractFields.state,
          fixtureId: stateContractFields.fixtureId,
          facts: [...stateContractFields.facts]
            .sort((left, right) => canonicalCompare(left.id, right.id))
            .map((fact) => ({
              id: fact.id,
              kind: fact.kind,
              subject: fact.subject,
              value: fact.value,
              ...(fact.mappingId === undefined ? {} : { mappingId: fact.mappingId }),
              ...(fact.bindingAspect === undefined ? {} : { bindingAspect: fact.bindingAspect }),
            })),
          requiredAssertions: [...requiredAssertions].sort((left, right) =>
            canonicalCompare(left.id, right.id),
          ),
          designBindingIds: [...stateContractFields.designBindingIds].sort(canonicalCompare),
        }),
      ),
    );
    const stateContract = { ...stateContractFields, digest: stateContractDigest };

    const captureBytes = await readFile(screenshotPath);
    const actualDigest = digest(captureBytes);
    const decoded = PNG.sync.read(captureBytes);
    assert.deepEqual(
      { width: decoded.width, height: decoded.height },
      { width: 360, height: 1824 },
    );
    const readiness = {
      documentReadyState: "complete",
      fontsReady: true,
      imagesReady: true,
      assetsReady: true,
    };
    const receipt = {
      schemaVersion: "visual-capture-receipt-v2",
      reviewPacketId: `packet_${"a".repeat(64)}`,
      headSha: "b".repeat(40),
      targetId: `shop-${state}`,
      route: observation.route,
      state,
      captureKind: "full-frame",
      logicalSize: { width: 360, height: 1824 },
      deviceScaleFactor: 1,
      stateContractDigest,
      environment: {
        browser: {
          family: "chromium",
          channel: browserChannel,
          version: browser.version(),
          userAgent: observation.userAgent,
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
      fixture: { id: fixture.id, digest: fixtureDigest },
      assets: [{ path: `tests/fixtures/case4-figma/${state}.json`, digest: fixtureDigest }],
      actual: {
        path: `visual/actual/case4/${state}.png`,
        digest: actualDigest,
        bitmapSize: { width: decoded.width, height: decoded.height },
      },
      normalizerVersion: "visual-normalizer-v1",
      capturedAt: "2026-07-28T00:00:00.000Z",
    };
    const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    const receiptDigest = digest(receiptBytes);
    await writeFile(path.join(outputRoot, `${state}.receipt.json`), receiptBytes);

    const resultBytes = await readFile(resultPath);
    const producerResult = JSON.parse(resultBytes.toString("utf8"));
    assert.equal(producerResult.stats.expected, 1);
    assert.equal(producerResult.stats.unexpected, 0);
    assert.equal(producerResult.stats.flaky, 0);
    assert.equal(producerResult.suites[0].specs[0].title, playwrightTestId);
    assert.equal(producerResult.suites[0].specs[0].ok, true);
    const producerResultDigest = digest(resultBytes);
    const producerRepositoryPath = `visual/assertions/case4/${state}.playwright-result.json`;
    const uiAssertionReport = {
      schemaVersion: "ui-assertions-v1",
      reviewPacketId: receipt.reviewPacketId,
      headSha: receipt.headSha,
      targetId: receipt.targetId,
      fixtureId: receipt.fixture.id,
      stateContractDigest,
      captureReceiptDigest: receiptDigest,
      producer: {
        kind: "playwright-test-cli",
        testId: playwrightTestId,
        resultPath: producerRepositoryPath,
        resultDigest: producerResultDigest,
      },
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
      fixtureId: fixture.id,
      fixtureDigest,
      stateContract,
      width: decoded.width,
      height: decoded.height,
      receiptDigest,
      receipt,
      producerResultPath: producerRepositoryPath,
      producerResultDigest,
      producerResult,
      uiAssertionReportDigest: digest(uiAssertionReportBytes),
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
        checkedSourceFiles: sourceEvidence.map((evidence) => ({
          path: evidence.path,
          digest: evidence.digest,
        })),
        requestedResources: [],
        renderedMedia: [],
        violations: [],
        status: "passed",
      },
    });
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
    assert.equal(digest(requestedBytes), baselineDigest);
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
      checkedSourceDigest: digest(maliciousSourceBytes),
      requestedResources: [{ url: baselineRequests[0], digest: baselineDigest }],
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
      "persisted Figma target|baseline isolation|pinned publication|workspace binding|UI assertion|design system",
    ],
    { cwd: root, env: process.env, stdio: "inherit" },
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        status: "passed",
        mode: "figma",
        designMapping,
        implementationBindings,
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

function observedValue(definition, observation) {
  if (definition.id === "paired-image-geometry") return observation.images.right;
  if (definition.id === "copy-button-geometry") return observation.copyButton.rect;
  if (definition.id.startsWith("table-border-")) {
    const edge = definition.id.replace("table-border-", "");
    return observation.table[`border${edge[0].toUpperCase()}${edge.slice(1)}Style`];
  }
  const iconMatch = /^(spot|circle|close)-icon-(.+)$/.exec(definition.id);
  if (iconMatch !== null) {
    const [, icon, property] = iconMatch;
    const observationProperty = {
      width: "width",
      height: "height",
      color: "color",
      token: "inlineColor",
      alignment: "alignment",
      "flex-shrink": "flexShrink",
    }[property];
    return observation.icons[icon][observationProperty];
  }
  return {
    "copy-button-focus-order": `${observation.focusBefore}->${observation.focusAfter}`,
    "copy-button-focus-visible": observation.focusVisible,
    "heading-order": observation.headingOrder,
    "copy-button-name": observation.copyButton.accessibleName,
    "copy-click": observation.clickOutcome,
    "copy-keyboard": observation.keyboardOutcome,
  }[definition.id];
}

function iconStateFacts(binding) {
  const values = {
    export: { kind: "icon", value: binding.resolution.exportName },
    token: { kind: "token", value: binding.resolution.props.color },
    width: { kind: "geometry", value: binding.expectedGeometry.width },
    height: { kind: "geometry", value: binding.expectedGeometry.height },
    alignment: { kind: "geometry", value: binding.expectedGeometry.alignment },
    flexShrink: { kind: "geometry", value: binding.expectedGeometry.flexShrink },
  };
  return Object.entries(values).map(([aspect, entry]) => ({
    id: `${binding.id}:${aspect}`,
    kind: entry.kind,
    subject: binding.figmaComponent,
    value: entry.value,
    mappingId: binding.id,
    bindingAspect: aspect,
  }));
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
