import { z } from "zod";

import {
  FigmaStateContractSchema,
  type FigmaStateContract,
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

const GeometrySnapshotSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
  })
  .strict();

export const GeometryAssertionSchema = z
  .object({
    ...UiAssertionBaseFields,
    kind: z.literal("geometry"),
    expected: GeometrySnapshotSchema,
    observed: GeometrySnapshotSchema,
    tolerance: z.number().min(0).max(0.5).default(0),
  })
  .strict()
  .superRefine((assertion, context) => {
    for (const coordinate of ["x", "y", "width", "height"] as const) {
      if (
        Math.abs(assertion.expected[coordinate] - assertion.observed[coordinate]) >
        assertion.tolerance
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

export const UiAssertionReportSchema = z
  .object({
    schemaVersion: z.literal("ui-assertions-v1"),
    reviewPacketId: ReviewPacketIdSchema,
    headSha: GitObjectIdSchema,
    targetId: VisualTargetManifestSchema.shape.targetId,
    fixtureId: z.string().trim().min(1),
    captureReceiptDigest: Sha256DigestSchema,
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
}): UiAssertionReport {
  const packet = {
    id: ReviewPacketIdSchema.parse(rawInput.packet.id),
    headSha: GitObjectIdSchema.parse(rawInput.packet.headSha),
  };
  const target = VisualTargetManifestSchema.parse(rawInput.target);
  const stateContract = FigmaStateContractSchema.parse(rawInput.stateContract);
  const captureReceiptDigest = Sha256DigestSchema.parse(rawInput.captureReceiptDigest);
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
    report.captureReceiptDigest !== captureReceiptDigest ||
    stateContract.targetId !== target.targetId ||
    stateContract.state !== target.state ||
    stateContract.fixtureId !== target.fixture
  ) {
    throw uiAssertionError(
      "packet, head, target, fixture, state contract, or capture receipt binding does not match",
    );
  }

  const expectedIds = [...stateContract.requiredAssertionIds].sort();
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
  return report;
}

function uiAssertionError(message: string): Error {
  return new Error(`UI_ASSERTION_REPORT_INVALID: ${message}`);
}
