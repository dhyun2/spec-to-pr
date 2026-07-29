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

const PlaywrightBindingAnnotationSchema = z
  .object({
    type: z.literal("spec-to-pr-ui-binding"),
    description: z.string().trim().min(1),
  })
  .passthrough();

const PlaywrightAttachmentSchema = z
  .object({
    name: z.string().trim().min(1),
    contentType: z.string().trim().min(1),
    path: z.string().trim().min(1).optional(),
    body: z
      .string()
      .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
      .optional(),
  })
  .strict()
  .refine((attachment) => attachment.path !== undefined || attachment.body !== undefined, {
    message: "Playwright attachment must carry a path or base64 body",
  });

const PlaywrightResultEntrySchema = z
  .object({
    status: z.literal("passed"),
    errors: z.array(z.unknown()).max(0),
    annotations: z.array(PlaywrightBindingAnnotationSchema.or(z.unknown())),
    attachments: z.array(PlaywrightAttachmentSchema),
  })
  .passthrough();

const PlaywrightTestEntrySchema = z
  .object({
    expectedStatus: z.literal("passed"),
    projectId: z.string(),
    projectName: z.string().trim().min(1),
    results: z.array(PlaywrightResultEntrySchema).min(1),
    status: z.literal("expected"),
    annotations: z.array(PlaywrightBindingAnnotationSchema.or(z.unknown())),
  })
  .passthrough();

const PlaywrightSpecSchema = z
  .object({
    title: z.string().trim().min(1),
    ok: z.literal(true),
    tests: z.array(PlaywrightTestEntrySchema).min(1),
  })
  .passthrough();

type PlaywrightSuite = {
  title: string;
  specs: Array<z.infer<typeof PlaywrightSpecSchema>>;
  suites: PlaywrightSuite[];
  [key: string]: unknown;
};

const PlaywrightSuiteSchema: z.ZodType<PlaywrightSuite> = z.lazy(() =>
  z
    .object({
      title: z.string(),
      specs: z.array(PlaywrightSpecSchema).default([]),
      suites: z.array(PlaywrightSuiteSchema).default([]),
    })
    .passthrough(),
);

export const PlaywrightCliResultSchema = z
  .object({
    config: z.record(z.string(), z.unknown()),
    suites: z.array(PlaywrightSuiteSchema).min(1),
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

export const UiAssertionProducerBindingSchema = z
  .object({
    targetId: VisualTargetManifestSchema.shape.targetId,
    state: z.string().trim().min(1),
    fixtureId: z.string().trim().min(1),
    observation: z
      .object({
        path: RepositoryPathSchema,
        digest: Sha256DigestSchema,
      })
      .strict(),
    screenshot: z
      .object({
        path: RepositoryPathSchema,
        digest: Sha256DigestSchema,
      })
      .strict(),
  })
  .strict();

export const UiAssertionObservationSchema = z
  .object({
    schemaVersion: z.literal("ui-assertion-observation-v1"),
    targetId: VisualTargetManifestSchema.shape.targetId,
    state: z.string().trim().min(1),
    fixtureId: z.string().trim().min(1),
    screenshot: z
      .object({
        path: RepositoryPathSchema,
        digest: Sha256DigestSchema,
      })
      .strict(),
    observations: z.record(
      z.string().trim().min(1),
      z.union([UiAssertionGeometrySnapshotSchema, AssertionScalarSchema]),
    ),
    diagnostics: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const UiAssertionProducerSchema = z
  .object({
    kind: z.literal("playwright-test-cli"),
    testId: z.string().trim().min(1),
    projectName: z.string().trim().min(1),
    resultPath: RepositoryPathSchema,
    resultDigest: Sha256DigestSchema,
    binding: UiAssertionProducerBindingSchema,
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
  producerObservationPath: string;
  producerObservationDigest: string;
  producerObservation: unknown;
  screenshotPath: string;
  screenshotDigest: string;
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
  const producerObservationPath = RepositoryPathSchema.parse(rawInput.producerObservationPath);
  const producerObservationDigest = Sha256DigestSchema.parse(rawInput.producerObservationDigest);
  const screenshotPath = RepositoryPathSchema.parse(rawInput.screenshotPath);
  const screenshotDigest = Sha256DigestSchema.parse(rawInput.screenshotDigest);
  const parsedObservation = UiAssertionObservationSchema.safeParse(rawInput.producerObservation);
  if (!parsedObservation.success) {
    throw uiAssertionError(
      `observation is invalid: ${parsedObservation.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
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
    report.producer.binding.targetId !== target.targetId ||
    report.producer.binding.state !== target.state ||
    report.producer.binding.fixtureId !== target.fixture ||
    report.producer.binding.observation.path !== producerObservationPath ||
    report.producer.binding.observation.digest !== producerObservationDigest ||
    report.producer.binding.screenshot.path !== screenshotPath ||
    report.producer.binding.screenshot.digest !== screenshotDigest ||
    parsedObservation.data.targetId !== target.targetId ||
    parsedObservation.data.state !== target.state ||
    parsedObservation.data.fixtureId !== target.fixture ||
    parsedObservation.data.screenshot.path !== screenshotPath ||
    parsedObservation.data.screenshot.digest !== screenshotDigest ||
    stateContract.targetId !== target.targetId ||
    stateContract.state !== target.state ||
    stateContract.fixtureId !== target.fixture
  ) {
    throw uiAssertionError(
      "packet, head, target, fixture, state contract, or capture receipt binding does not match",
    );
  }

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
  const observationIds = Object.keys(parsedObservation.data.observations).sort();
  if (
    observationIds.length !== uniqueObservedIds.length ||
    observationIds.some((id, index) => id !== uniqueObservedIds[index])
  ) {
    throw uiAssertionError(
      `observation artifact IDs must exactly equal report assertion IDs; expected: ${uniqueObservedIds.join(", ")}; observed: ${observationIds.join(", ")}`,
    );
  }
  const observationSubstitutions = report.assertions.filter(
    (assertion) =>
      JSON.stringify(assertion.observed) !==
      JSON.stringify(parsedObservation.data.observations[assertion.id]),
  );
  if (observationSubstitutions.length > 0) {
    throw uiAssertionError(
      `report observations must derive exactly from the observation artifact; substituted: ${observationSubstitutions.map((assertion) => assertion.id).join(", ")}`,
    );
  }
  assertPlaywrightCliResult(rawInput.producerResult, report.producer, parsedObservation.data);
  return report;
}

export function assertPlaywrightCliResult(
  rawResult: unknown,
  producer: z.infer<typeof UiAssertionProducerSchema>,
  observation: z.infer<typeof UiAssertionObservationSchema>,
): void {
  const parsed = PlaywrightCliResultSchema.safeParse(rawResult);
  if (!parsed.success) {
    throw uiAssertionError(
      `Playwright CLI result is invalid: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
  const matchingSpecs = findPlaywrightSpecs(parsed.data.suites, producer.testId);
  if (matchingSpecs.length !== 1) {
    throw uiAssertionError(
      `Playwright CLI result must have exactly one passing spec titled ${producer.testId}`,
    );
  }
  const matchingTests = matchingSpecs[0]!.tests.filter(
    (test) => test.projectName === producer.projectName,
  );
  if (matchingTests.length !== 1) {
    throw uiAssertionError(
      `Playwright CLI result must have exactly one expected pass in project ${producer.projectName}`,
    );
  }
  const annotations = [
    ...matchingTests[0]!.annotations,
    ...matchingTests[0]!.results.flatMap((result) => result.annotations),
  ].filter(
    (annotation): annotation is z.infer<typeof PlaywrightBindingAnnotationSchema> =>
      PlaywrightBindingAnnotationSchema.safeParse(annotation).success,
  );
  const expectedBinding = JSON.stringify(producer.binding);
  const matchingBindings = annotations.filter((annotation) => {
    try {
      return (
        JSON.stringify(
          UiAssertionProducerBindingSchema.parse(JSON.parse(annotation.description)),
        ) === expectedBinding
      );
    } catch {
      return false;
    }
  });
  if (matchingBindings.length === 0) {
    throw uiAssertionError(
      "Playwright CLI result has no digest-bound target/state/fixture/observation/screenshot metadata",
    );
  }
  const observationAttachments = matchingTests[0]!.results
    .flatMap((result) => result.attachments)
    .filter(
      (attachment) =>
        attachment.name === "spec-to-pr-ui-observation" &&
        attachment.contentType === "application/vnd.spec-to-pr.ui-observation+json" &&
        attachment.path === undefined &&
        attachment.body !== undefined,
    );
  const expectedObservation = JSON.stringify(observation);
  const exactAttachments = observationAttachments.filter((attachment) => {
    try {
      const decoded = Buffer.from(attachment.body!, "base64").toString("utf8");
      return (
        JSON.stringify(UiAssertionObservationSchema.parse(JSON.parse(decoded))) ===
        expectedObservation
      );
    } catch {
      return false;
    }
  });
  if (exactAttachments.length !== 1) {
    throw uiAssertionError(
      "Playwright CLI result must contain exactly one canonical UI observation attachment",
    );
  }
}

function uiAssertionDefinitionFromReport(assertion: UiAssertion): UiAssertionDefinition {
  const { observed: _observed, status: _status, ...definition } = assertion;
  return UiAssertionDefinitionSchema.parse(definition);
}

function canonicalDefinition(definition: UiAssertionDefinition): string {
  return JSON.stringify(definition);
}

function findPlaywrightSpecs(
  suites: Array<z.infer<typeof PlaywrightSuiteSchema>>,
  testId: string,
): Array<z.infer<typeof PlaywrightSpecSchema>> {
  return suites.flatMap((suite) => [
    ...suite.specs.filter((spec) => spec.title === testId),
    ...findPlaywrightSpecs(suite.suites, testId),
  ]);
}

function uiAssertionError(message: string): Error {
  return new Error(`UI_ASSERTION_REPORT_INVALID: ${message}`);
}
