import { createHash } from "node:crypto";

import { z } from "zod";

import { RunIdSchema } from "../runtime/ids.js";
import { GitObjectIdSchema, RelativePathSchema, Sha256DigestSchema } from "../runtime/scalars.js";
import { CaptureEnvironmentV2Schema } from "../visual/capture-receipt.js";

const CaptureSessionIdSchema = z
  .string()
  .regex(/^capture_[a-f0-9]{64}$/, "Expected capture_<64 lowercase hex characters>");

const ImplementationContextIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._:-]+$/i, "Implementation context ID contains unsupported characters");

const CaptureSessionTargetSchema = z
  .object({
    targetId: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[a-z0-9][a-z0-9._:-]*$/i),
    testId: z.string().trim().min(1).max(500),
    actualPath: RelativePathSchema,
    actualDigest: Sha256DigestSchema,
    observationPath: RelativePathSchema,
    observationDigest: Sha256DigestSchema,
  })
  .strict();

const CaptureSessionDraftV1Schema = z
  .object({
    schemaVersion: z.literal("capture-session-v1"),
    runId: RunIdSchema,
    implementationContextId: ImplementationContextIdSchema,
    candidate: z
      .object({
        baseSha: GitObjectIdSchema,
        headSha: GitObjectIdSchema,
        diffDigest: Sha256DigestSchema,
      })
      .strict(),
    invocation: z
      .object({
        runner: z.literal("playwright-test-cli"),
        command: z.string().trim().min(1).max(4_000),
        selector: z.string().trim().min(1).max(1_000),
        invocationCount: z.union([z.literal(0), z.literal(1)]),
        reporterResultPath: RelativePathSchema,
        reporterResultDigest: Sha256DigestSchema,
      })
      .strict(),
    environment: CaptureEnvironmentV2Schema,
    inputs: z
      .object({
        capturePlanDigest: Sha256DigestSchema,
        scenarioDigest: Sha256DigestSchema,
        fixtureDigest: Sha256DigestSchema,
        uiBundleDigest: Sha256DigestSchema,
        rendererLineageId: Sha256DigestSchema,
      })
      .strict(),
    outputs: z
      .object({
        featureResult: z
          .object({
            path: RelativePathSchema,
            digest: Sha256DigestSchema,
            testId: z.string().trim().min(1).max(500),
          })
          .strict()
          .optional(),
        video: z
          .object({
            path: RelativePathSchema,
            digest: Sha256DigestSchema,
            durationMs: z.number().finite().positive(),
          })
          .strict()
          .optional(),
        performance: z
          .object({
            path: RelativePathSchema,
            digest: Sha256DigestSchema,
          })
          .strict()
          .optional(),
        targets: z.array(CaptureSessionTargetSchema).min(1).max(50),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const targetIds = new Set<string>();
    const actualPaths = new Set<string>();
    const observationPaths = new Set<string>();
    for (const [index, target] of value.outputs.targets.entries()) {
      if (targetIds.has(target.targetId)) {
        context.addIssue({
          code: "custom",
          path: ["outputs", "targets", index, "targetId"],
          message: "Capture-session target IDs must be unique",
        });
      }
      if (actualPaths.has(target.actualPath)) {
        context.addIssue({
          code: "custom",
          path: ["outputs", "targets", index, "actualPath"],
          message: "Capture-session actual PNG paths must be unique",
        });
      }
      if (observationPaths.has(target.observationPath)) {
        context.addIssue({
          code: "custom",
          path: ["outputs", "targets", index, "observationPath"],
          message: "Capture-session observation paths must be unique",
        });
      }
      targetIds.add(target.targetId);
      actualPaths.add(target.actualPath);
      observationPaths.add(target.observationPath);
    }
  });

export type CaptureSessionDraftV1 = z.infer<typeof CaptureSessionDraftV1Schema>;

export function captureSessionIdentity(input: unknown): `capture_${string}` {
  const draftInput =
    typeof input === "object" && input !== null && !Array.isArray(input)
      ? (() => {
          const { captureSessionId: _captureSessionId, ...draft } = input as Record<
            string,
            unknown
          >;
          return draft;
        })()
      : input;
  const session = CaptureSessionDraftV1Schema.parse(draftInput);
  const canonical = {
    ...session,
    outputs: {
      ...session.outputs,
      targets: [...session.outputs.targets].sort((left, right) =>
        left.targetId.localeCompare(right.targetId),
      ),
    },
  };
  return `capture_${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
}

export const CaptureSessionReceiptV1Schema = CaptureSessionDraftV1Schema.extend({
  captureSessionId: CaptureSessionIdSchema,
}).superRefine((value, context) => {
  const { captureSessionId, ...draft } = value;
  if (captureSessionId !== captureSessionIdentity(draft)) {
    context.addIssue({
      code: "custom",
      path: ["captureSessionId"],
      message: "Capture-session ID does not match its candidate-bound identity",
    });
  }
});

export type CaptureSessionReceiptV1 = z.infer<typeof CaptureSessionReceiptV1Schema>;
