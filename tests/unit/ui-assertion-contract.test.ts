import { describe, expect, it } from "vitest";

import { figmaStateFactsDigest } from "../../src/figma/figma-capture-contract.js";
import {
  UiAssertionReportSchema,
  assertUiAssertionReport,
} from "../../src/visual/ui-assertion-contract.js";

const reviewPacketId = `packet_${"a".repeat(64)}` as const;
const headSha = "b".repeat(40);
const captureReceiptDigest = `sha256:${"c".repeat(64)}` as const;
const producerResultPath = "visual/actual/packet/assert-checkout.playwright.json";
const producerResultDigest = `sha256:${"d".repeat(64)}` as const;
const producerTestId = "checkout focused UI assertions";
const producerProjectName = "ui-chromium";
const producerObservationPath = "visual/actual/packet/checkout.observation.json";
const producerObservationDigest = `sha256:${"e".repeat(64)}` as const;
const screenshotPath = "visual/actual/packet/checkout.png";
const screenshotDigest = `sha256:${"f".repeat(64)}` as const;
const producerBinding = {
  targetId: "checkout-default",
  state: "default",
  fixtureId: "fixture:checkout",
  observation: {
    path: producerObservationPath,
    digest: producerObservationDigest,
  },
  screenshot: {
    path: screenshotPath,
    digest: screenshotDigest,
  },
};
const bindingAnnotation = {
  type: "spec-to-pr-ui-binding",
  description: JSON.stringify(producerBinding),
};
const producerResultFor = (observation: unknown) => ({
  config: { version: "1.61.1" },
  suites: [
    {
      title: "checkout.spec.ts",
      specs: [
        {
          title: producerTestId,
          ok: true,
          tests: [
            {
              expectedStatus: "passed",
              projectId: producerProjectName,
              projectName: producerProjectName,
              results: [
                {
                  status: "passed",
                  errors: [],
                  annotations: [bindingAnnotation],
                  attachments: [
                    {
                      name: "spec-to-pr-ui-observation",
                      contentType: "application/vnd.spec-to-pr.ui-observation+json",
                      body: Buffer.from(JSON.stringify(observation), "utf8").toString("base64"),
                    },
                  ],
                },
              ],
              status: "expected",
              annotations: [bindingAnnotation],
            },
          ],
        },
      ],
    },
  ],
  errors: [],
  stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
});
const target = {
  targetId: "checkout-default",
  name: "Checkout",
  state: "default",
  route: "/checkout",
  baselineKind: "figma" as const,
  baselinePath: "visual/checkout.png",
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
  fixture: "fixture:checkout",
  masks: [],
  reviewThreshold: 0.92 as const,
};

const assertions = [
  {
    id: "paired-image-geometry",
    kind: "geometry" as const,
    selector: "[data-ui=right-image]",
    subject: "right image matches left image geometry",
    expected: { x: 72, y: 180, width: 320, height: 180 },
    observed: { x: 72, y: 180, width: 320, height: 180 },
    maxTolerance: 0.5,
    status: "passed" as const,
  },
  ...[
    ["table-border-top", "border-top-style", "solid"],
    ["table-border-bottom", "border-bottom-style", "solid"],
    ["table-border-left", "border-left-style", "solid"],
    ["table-border-right", "border-right-style", "solid"],
  ].map(([id, property, value]) => ({
    id: id!,
    kind: "computed-style" as const,
    selector: "[data-ui=comparison-table]",
    subject: `table ${property}`,
    property: property!,
    expected: value!,
    observed: value!,
    status: "passed" as const,
  })),
  {
    id: "copy-button-geometry",
    kind: "geometry" as const,
    selector: "[data-ui=copy-button]",
    subject: "copy button size and placement",
    expected: { x: 1184, y: 32, width: 32, height: 32 },
    observed: { x: 1184, y: 32, width: 32, height: 32 },
    maxTolerance: 0.5,
    status: "passed" as const,
  },
  ...[
    ["spot-icon-width", "width", "16px"],
    ["spot-icon-height", "height", "16px"],
    ["spot-icon-color", "color-token", "--semantic-text-tertiary"],
    ["spot-icon-alignment", "align-self", "center"],
    ["spot-icon-flex-shrink", "flex-shrink", "0"],
  ].map(([id, property, value]) => ({
    id: id!,
    kind: "computed-style" as const,
    selector: "[data-icon=spot]",
    subject: `spot icon ${property}`,
    property: property!,
    expected: value!,
    observed: value!,
    status: "passed" as const,
  })),
  {
    id: "copy-button-focus",
    kind: "accessibility" as const,
    selector: "[data-ui=copy-button]",
    subject: "copy button visible keyboard focus",
    check: "focus-visible" as const,
    expected: true,
    observed: true,
    status: "passed" as const,
  },
  {
    id: "heading-order",
    kind: "accessibility" as const,
    selector: "main",
    subject: "ordered heading levels",
    check: "heading-order" as const,
    expected: "1,2,2",
    observed: "1,2,2",
    status: "passed" as const,
  },
  {
    id: "copy-button-name",
    kind: "accessibility" as const,
    selector: "[data-ui=copy-button]",
    subject: "copy button accessible name",
    check: "accessible-name" as const,
    expected: "Copy comparison link",
    observed: "Copy comparison link",
    status: "passed" as const,
  },
  {
    id: "copy-click",
    kind: "interaction" as const,
    selector: "[data-ui=copy-button]",
    subject: "copy button click outcome",
    action: "click" as const,
    expected: "copied",
    observed: "copied",
    status: "passed" as const,
  },
  {
    id: "copy-keyboard",
    kind: "interaction" as const,
    selector: "[data-ui=copy-button]",
    subject: "copy button Enter outcome",
    action: "keyboard" as const,
    expected: "copied",
    observed: "copied",
    status: "passed" as const,
  },
];

const stateFields = {
  targetId: target.targetId,
  nodeId: "1:2",
  state: target.state,
  fixtureId: target.fixture,
  facts: [
    {
      id: "copy",
      kind: "interaction" as const,
      subject: "copy button",
      value: "copies comparison link",
    },
  ],
  requiredAssertions: assertions.map(
    ({ observed: _observed, status: _status, ...definition }) => definition,
  ),
  designBindingIds: [],
};
const stateContract = {
  ...stateFields,
  digest: figmaStateFactsDigest(stateFields),
};
const producerObservation = {
  schemaVersion: "ui-assertion-observation-v1",
  targetId: target.targetId,
  state: target.state,
  fixtureId: target.fixture,
  screenshot: {
    path: screenshotPath,
    digest: screenshotDigest,
  },
  observations: Object.fromEntries(
    assertions.map((assertion) => [assertion.id, assertion.observed]),
  ),
};
const producerResult = producerResultFor(producerObservation);
const producerEvidenceInput = {
  producerObservationPath,
  producerObservationDigest,
  producerObservation,
  screenshotPath,
  screenshotDigest,
};

function report(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "ui-assertions-v1",
    reviewPacketId,
    headSha,
    targetId: target.targetId,
    fixtureId: target.fixture,
    stateContractDigest: stateContract.digest,
    captureReceiptDigest,
    producer: {
      kind: "playwright-test-cli",
      testId: producerTestId,
      projectName: producerProjectName,
      resultPath: producerResultPath,
      resultDigest: producerResultDigest,
      binding: producerBinding,
    },
    assertions,
    status: "passed",
    ...overrides,
  };
}

describe("focused UI assertion report", () => {
  it("binds the report to packet, head, target, fixture, receipt, and exact state assertion IDs", () => {
    expect(() =>
      assertUiAssertionReport({
        report: report(),
        packet: { id: reviewPacketId, headSha },
        target,
        stateContract,
        captureReceiptDigest,
        producerResultPath,
        producerResultDigest,
        producerResult,
        ...producerEvidenceInput,
      }),
    ).not.toThrow();
  });

  it.each([
    ["reviewPacketId", `packet_${"d".repeat(64)}`],
    ["headSha", "e".repeat(40)],
    ["targetId", "checkout-other"],
    ["fixtureId", "fixture:other"],
    ["captureReceiptDigest", `sha256:${"f".repeat(64)}`],
  ])("rejects a report with a mismatched %s binding", (field, value) => {
    expect(() =>
      assertUiAssertionReport({
        report: report({ [field]: value }),
        packet: { id: reviewPacketId, headSha },
        target,
        stateContract,
        captureReceiptDigest,
        producerResultPath,
        producerResultDigest,
        producerResult,
        ...producerEvidenceInput,
      }),
    ).toThrow(/UI_ASSERTION_REPORT_INVALID/);
  });

  it("requires exact required assertion ID coverage with no missing, unknown, or duplicate IDs", () => {
    for (const reportAssertions of [
      assertions.slice(1),
      [...assertions, { ...assertions[0]!, id: "unknown-assertion" }],
      [...assertions, assertions[0]!],
    ]) {
      expect(() =>
        assertUiAssertionReport({
          report: report({ assertions: reportAssertions }),
          packet: { id: reviewPacketId, headSha },
          target,
          stateContract,
          captureReceiptDigest,
          producerResultPath,
          producerResultDigest,
          producerResult,
          ...producerEvidenceInput,
        }),
      ).toThrow(/UI_ASSERTION_REPORT_INVALID.*assertion IDs/i);
    }
  });

  it("rejects semantic substitution behind an otherwise required assertion ID", () => {
    const substitutedAssertions = assertions.map((assertion) =>
      assertion.id === "copy-click"
        ? {
            ...assertion,
            selector: "[data-ui=unrelated-button]",
            subject: "unrelated button click outcome",
            expected: "opened",
            observed: "opened",
          }
        : assertion,
    );

    expect(() =>
      assertUiAssertionReport({
        report: report({ assertions: substitutedAssertions }),
        packet: { id: reviewPacketId, headSha },
        target,
        stateContract,
        captureReceiptDigest,
        producerResultPath,
        producerResultDigest,
        producerResult,
        ...producerEvidenceInput,
      }),
    ).toThrow(/UI_ASSERTION_REPORT_INVALID.*definition|immutable|semantic/i);
  });

  it("FABRICATED_PLAYWRIGHT_RESULT_AND_OBSERVATION_ACCEPTED", () => {
    const fabricatedResult = {
      config: { version: "not-a-real-project" },
      suites: [
        {
          title: "fabricated.spec.ts",
          specs: [{ title: producerTestId, ok: true, tests: [] }],
        },
      ],
      errors: [],
      stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
    };

    expect(() =>
      assertUiAssertionReport({
        report: report(),
        packet: { id: reviewPacketId, headSha },
        target,
        stateContract,
        captureReceiptDigest,
        producerResultPath,
        producerResultDigest,
        producerResult: fabricatedResult,
        ...producerEvidenceInput,
      }),
    ).toThrow(/UI_ASSERTION_REPORT_INVALID.*Playwright|project|result|attachment|binding/i);
  });

  it("rejects an observation artifact that substitutes a report observation", () => {
    expect(() =>
      assertUiAssertionReport({
        report: report(),
        packet: { id: reviewPacketId, headSha },
        target,
        stateContract,
        captureReceiptDigest,
        producerResultPath,
        producerResultDigest,
        producerResult,
        ...producerEvidenceInput,
        producerObservation: {
          ...producerObservation,
          observations: {
            ...producerObservation.observations,
            "copy-click": "fabricated",
          },
        },
      }),
    ).toThrow(/UI_ASSERTION_REPORT_INVALID.*observation|assertion|artifact/i);
  });

  it.each([
    [
      "unequal left/right image geometry",
      "paired-image-geometry",
      { observed: { x: 72, y: 180, width: 300, height: 180 } },
    ],
    ["missing top table border", "table-border-top", { observed: "none" }],
    ["missing bottom table border", "table-border-bottom", { observed: "none" }],
    ["missing outer table border", "table-border-left", { observed: "none" }],
    [
      "wrong copy-button size or placement",
      "copy-button-geometry",
      { observed: { x: 1176, y: 32, width: 40, height: 32 } },
    ],
    ["wrong icon width", "spot-icon-width", { observed: "14px" }],
    ["wrong icon height", "spot-icon-height", { observed: "14px" }],
    ["wrong icon color", "spot-icon-color", { observed: "--semantic-text-secondary" }],
    ["wrong icon alignment", "spot-icon-alignment", { observed: "baseline" }],
    ["wrong icon flex shrink", "spot-icon-flex-shrink", { observed: "1" }],
    ["missing visible keyboard focus", "copy-button-focus", { observed: false }],
    ["invalid heading order", "heading-order", { observed: "1,3,2" }],
    ["missing accessible name", "copy-button-name", { observed: "" }],
    ["wrong click result", "copy-click", { observed: "idle" }],
    ["wrong keyboard result", "copy-keyboard", { observed: "idle" }],
  ])("rejects %s", (_label, assertionId, mutation) => {
    const invalidAssertions = assertions.map((assertion) =>
      assertion.id === assertionId ? { ...assertion, ...mutation } : assertion,
    );
    expect(() =>
      assertUiAssertionReport({
        report: report({ assertions: invalidAssertions }),
        packet: { id: reviewPacketId, headSha },
        target,
        stateContract,
        captureReceiptDigest,
        producerResultPath,
        producerResultDigest,
        producerResult,
        ...producerEvidenceInput,
      }),
    ).toThrow(/UI_ASSERTION_REPORT_INVALID/);
  });

  it("does not let a 93% page score waive a failed required assertion", () => {
    const failedAssertions = assertions.map((assertion) =>
      assertion.id === "spot-icon-flex-shrink"
        ? { ...assertion, observed: "1", status: "failed" }
        : assertion,
    );
    const aggregatePageScore = 0.93;

    expect(aggregatePageScore).toBeGreaterThan(0.92);
    expect(
      UiAssertionReportSchema.safeParse(report({ assertions: failedAssertions })).success,
    ).toBe(false);
    expect(() =>
      assertUiAssertionReport({
        report: report({ assertions: failedAssertions }),
        packet: { id: reviewPacketId, headSha },
        target,
        stateContract,
        captureReceiptDigest,
        producerResultPath,
        producerResultDigest,
        producerResult,
        ...producerEvidenceInput,
      }),
    ).toThrow(/UI_ASSERTION_REPORT_INVALID/);
  });
});
