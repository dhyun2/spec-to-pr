import { z } from "zod";

import {
  FigmaStateContractSchema,
  RepositoryPathSchema,
  UiAssertionDefinitionSchema,
  UiAssertionGeometrySnapshotSchema,
  type FigmaStateContract,
  type UiAssertionDefinition,
} from "../figma/figma-capture-contract.js";
import { GitObjectIdSchema, Sha256DigestSchema } from "../runtime/scalars.js";
import { ReviewPacketIdSchema } from "../workflow/workflow-contracts.js";
import { VisualTargetManifestSchema, type VisualTargetManifest } from "./visual-comparator.js";

const UiAssertionBaseFields = {
  id: z.string().trim().min(1),
  selector: z.string().trim().min(1),
  subject: z.string().trim().min(1),
  status: z.literal("passed"),
} as const;

export const GeometryAssertionSchema = z
  .object({
    ...UiAssertionBaseFields,
    kind: z.literal("geometry"),
    expected: UiAssertionGeometrySnapshotSchema,
    observed: UiAssertionGeometrySnapshotSchema,
    maxTolerance: z.number().min(0).max(0.5),
  })
  .strict()
  .superRefine((assertion, context) => {
    for (const coordinate of ["x", "y", "width", "height"] as const) {
      if (
        Math.abs(assertion.expected[coordinate] - assertion.observed[coordinate]) >
        assertion.maxTolerance
      ) {
        context.addIssue({
          code: "custom",
          path: ["observed", coordinate],
          message: `${coordinate} differs from the expected geometry`,
        });
      }
    }
  });

export const ComputedStyleAssertionSchema = z
  .object({
    ...UiAssertionBaseFields,
    kind: z.literal("computed-style"),
    property: z.string().trim().min(1),
    expected: z.string(),
    observed: z.string(),
  })
  .strict()
  .superRefine((assertion, context) => {
    if (assertion.expected !== assertion.observed) {
      context.addIssue({
        code: "custom",
        path: ["observed"],
        message: `${assertion.property} differs from the expected computed style`,
      });
    }
  });

const AssertionScalarSchema = z.union([z.string(), z.number(), z.boolean()]);

export const AccessibilityAssertionSchema = z
  .object({
    ...UiAssertionBaseFields,
    kind: z.literal("accessibility"),
    check: z.enum(["focus-visible", "keyboard-focus", "heading-order", "accessible-name"]),
    expected: AssertionScalarSchema,
    observed: AssertionScalarSchema,
  })
  .strict()
  .superRefine((assertion, context) => {
    if (
      typeof assertion.expected !== typeof assertion.observed ||
      assertion.expected !== assertion.observed
    ) {
      context.addIssue({
        code: "custom",
        path: ["observed"],
        message: `${assertion.check} differs from the expected accessibility result`,
      });
    }
  });

export const InteractionAssertionSchema = z
  .object({
    ...UiAssertionBaseFields,
    kind: z.literal("interaction"),
    action: z.enum(["click", "keyboard"]),
    expected: AssertionScalarSchema,
    observed: AssertionScalarSchema,
  })
  .strict()
  .superRefine((assertion, context) => {
    if (
      typeof assertion.expected !== typeof assertion.observed ||
      assertion.expected !== assertion.observed
    ) {
      context.addIssue({
        code: "custom",
        path: ["observed"],
        message: `${assertion.action} differs from the expected interaction result`,
      });
    }
  });

export const UiAssertionSchema = z.discriminatedUnion("kind", [
  GeometryAssertionSchema,
  ComputedStyleAssertionSchema,
  AccessibilityAssertionSchema,
  InteractionAssertionSchema,
]);

export const PlaywrightCliResultSchema = z
  .object({
    config: z.record(z.string(), z.unknown()),
    suites: z.array(z.unknown()).min(1),
    errors: z.array(z.unknown()).max(0),
    stats: z
      .object({
        expected: z.number().int().positive(),
        unexpected: z.literal(0),
        flaky: z.literal(0),
        skipped: z.number().int().nonnegative(),
      })
      .passthrough(),
  })
  .passthrough();

export const UiAssertionProducerSchema = z
  .object({
    kind: z.literal("playwright-test-cli"),
    testId: z.string().trim().min(1),
    resultPath: RepositoryPathSchema,
    resultDigest: Sha256DigestSchema,
  })
  .strict();

export const UiAssertionReportSchema = z
  .object({
    schemaVersion: z.literal("ui-assertions-v1"),
    reviewPacketId: ReviewPacketIdSchema,
    headSha: GitObjectIdSchema,
    targetId: VisualTargetManifestSchema.shape.targetId,
    fixtureId: z.string().trim().min(1),
    stateContractDigest: Sha256DigestSchema,
    captureReceiptDigest: Sha256DigestSchema,
    producer: UiAssertionProducerSchema,
    assertions: z.array(UiAssertionSchema).min(1).max(1_000),
    status: z.literal("passed"),
  })
  .strict();

export type UiAssertion = z.infer<typeof UiAssertionSchema>;
export type UiAssertionReport = z.infer<typeof UiAssertionReportSchema>;

export function assertUiAssertionReport(rawInput: {
  report: unknown;
  packet: { id: string; headSha: string };
  target: VisualTargetManifest;
  stateContract: FigmaStateContract;
  captureReceiptDigest: string;
  producerResultPath: string;
  producerResultDigest: string;
  producerResult: unknown;
}): UiAssertionReport {
  const packet = {
    id: ReviewPacketIdSchema.parse(rawInput.packet.id),
    headSha: GitObjectIdSchema.parse(rawInput.packet.headSha),
  };
  const target = VisualTargetManifestSchema.parse(rawInput.target);
  const stateContract = FigmaStateContractSchema.parse(rawInput.stateContract);
  const captureReceiptDigest = Sha256DigestSchema.parse(rawInput.captureReceiptDigest);
  const producerResultPath = RepositoryPathSchema.parse(rawInput.producerResultPath);
  const producerResultDigest = Sha256DigestSchema.parse(rawInput.producerResultDigest);
  const parsed = UiAssertionReportSchema.safeParse(rawInput.report);
  if (!parsed.success) {
    throw uiAssertionError(parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  const report = parsed.data;
  if (
    report.reviewPacketId !== packet.id ||
    report.headSha !== packet.headSha ||
    report.targetId !== target.targetId ||
    report.fixtureId !== target.fixture ||
    report.stateContractDigest !== stateContract.digest ||
    report.captureReceiptDigest !== captureReceiptDigest ||
    report.producer.resultPath !== producerResultPath ||
    report.producer.resultDigest !== producerResultDigest ||
    stateContract.targetId !== target.targetId ||
    stateContract.state !== target.state ||
    stateContract.fixtureId !== target.fixture
  ) {
    throw uiAssertionError(
      "packet, head, target, fixture, state contract, or capture receipt binding does not match",
    );
  }

  assertPlaywrightCliResult(rawInput.producerResult, report.producer.testId);

  const expectedIds = stateContract.requiredAssertions.map((assertion) => assertion.id).sort();
  const observedIds = report.assertions.map((assertion) => assertion.id);
  const uniqueObservedIds = [...new Set(observedIds)].sort();
  if (
    observedIds.length !== uniqueObservedIds.length ||
    expectedIds.length !== uniqueObservedIds.length ||
    expectedIds.some((id, index) => id !== uniqueObservedIds[index])
  ) {
    throw uiAssertionError(
      `assertion IDs must exactly equal the state contract's required assertion IDs; expected: ${expectedIds.join(", ")}; observed: ${uniqueObservedIds.join(", ")}`,
    );
  }
  const definitionsById = new Map(
    stateContract.requiredAssertions.map((definition) => [definition.id, definition]),
  );
  const substituted = report.assertions.filter((assertion) => {
    const expected = definitionsById.get(assertion.id);
    return (
      expected === undefined ||
      canonicalDefinition(uiAssertionDefinitionFromReport(assertion)) !==
        canonicalDefinition(expected)
    );
  });
  if (substituted.length > 0) {
    throw uiAssertionError(
      `assertion definitions must exact-match immutable state-contract definitions; substituted: ${substituted.map((assertion) => assertion.id).join(", ")}`,
    );
  }
  return report;
}

export function assertPlaywrightCliResult(rawResult: unknown, testId: string): void {
  const parsed = PlaywrightCliResultSchema.safeParse(rawResult);
  if (!parsed.success) {
    throw uiAssertionError(
      `Playwright CLI result is invalid: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
  if (!containsPassingPlaywrightSpec(parsed.data.suites, testId)) {
    throw uiAssertionError(`Playwright CLI result has no passing spec titled ${testId}`);
  }
}

function uiAssertionDefinitionFromReport(assertion: UiAssertion): UiAssertionDefinition {
  const { observed: _observed, status: _status, ...definition } = assertion;
  return UiAssertionDefinitionSchema.parse(definition);
}

function canonicalDefinition(definition: UiAssertionDefinition): string {
  return JSON.stringify(definition);
}

function containsPassingPlaywrightSpec(value: unknown, testId: string): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsPassingPlaywrightSpec(item, testId));
  }
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record["title"] === testId && record["ok"] === true) return true;
  return Object.values(record).some((item) => containsPassingPlaywrightSpec(item, testId));
}

function uiAssertionError(message: string): Error {
  return new Error(`UI_ASSERTION_REPORT_INVALID: ${message}`);
}
