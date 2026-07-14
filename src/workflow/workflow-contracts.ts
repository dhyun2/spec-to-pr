import { z } from "zod";

import { RunIdSchema } from "../runtime/ids.js";
import { WorkloadEstimateSchema, WorkloadSignalsSchema } from "./workload-policy.js";

export const WorkflowScopeSchema = z
  .object({
    code: z.boolean(),
    ui: z.boolean(),
    api: z.boolean(),
    specification: z.boolean(),
    hasVisualBaseline: z.boolean(),
    securitySensitive: z.boolean(),
    performanceSensitive: z.boolean(),
    observabilityRequested: z.boolean(),
  })
  .strict();

export const DeliveryModeSchema = z.enum(["auto", "brief", "legacy", "feature", "figma"]);
export const ChangeKindSchema = z.enum([
  "auto",
  "feature",
  "fix",
  "refactor",
  "migration",
  "design",
  "docs",
]);
export const PublicationIntentSchema = z.enum(["draft", "none"]);
export const FigmaFileUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return (
      (host === "figma.com" || host === "www.figma.com") &&
      /^\/(?:design|file|proto)\//i.test(parsed.pathname)
    );
  }, "Figma URL must be a figma.com design, file, or prototype URL");

export const ImplementationContextIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._:-]+$/i, "Implementation context ID contains unsupported characters");

export const DeliveryProfileSchema = z
  .object({
    mode: DeliveryModeSchema,
    changeKind: ChangeKindSchema,
    publication: PublicationIntentSchema,
    briefPath: z.string().trim().min(1).optional(),
    figmaUrl: FigmaFileUrlSchema.optional(),
    requirements: z
      .object({
        brief: z.boolean(),
        legacyBaseline: z.boolean(),
        targetedFeatureE2E: z.boolean(),
        featureVideo: z.boolean(),
        figmaBundle: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const ReviewVerdictSchema = z.enum(["approved", "changes-requested", "blocked"]);
export const ReviewFindingSeveritySchema = z.enum(["minor", "major", "blocker"]);
export const RequirementVerdictSchema = z.enum(["accepted", "rejected", "blocked"]);
export const WorkflowGateIdSchema = z.enum([
  "functional",
  "openspec",
  "architecture",
  "security",
  "visual",
  "accessibility",
  "performance",
  "observability",
  "release",
]);

const ReviewFindingSchema = z
  .object({
    severity: ReviewFindingSeveritySchema,
    title: z.string().trim().min(1).max(500),
    evidence: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

const ReviewRequirementSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    verdict: RequirementVerdictSchema,
  })
  .strict();

const ReviewGateResultSchema = z
  .object({
    id: WorkflowGateIdSchema,
    status: z.enum(["passed", "failed", "blocked"]),
    evidencePaths: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

export const ReviewSubmissionSchema = z
  .object({
    kind: z.enum(["functional-review", "design-review"]),
    verdict: ReviewVerdictSchema,
    summary: z.string().trim().min(1).max(4_000),
    findings: z.array(ReviewFindingSchema).default([]),
    requirements: z.array(ReviewRequirementSchema).default([]),
    artifactPaths: z.array(z.string().trim().min(1)).default([]),
    gateResults: z.array(ReviewGateResultSchema).default([]),
  })
  .strict()
  .superRefine((review, context) => {
    if (review.verdict !== "approved") {
      return;
    }

    if (review.artifactPaths.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["artifactPaths"],
        message: "Approved reviews require concrete evidence artifacts",
      });
    }

    if (review.requirements.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["requirements"],
        message: "Approved reviews require at least one reviewed requirement",
      });
    }

    if (review.gateResults.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["gateResults"],
        message: "Approved reviews require structured gate results",
      });
    }

    const seenGateIds = new Set<string>();
    review.gateResults.forEach((gate, index) => {
      if (seenGateIds.has(gate.id)) {
        context.addIssue({
          code: "custom",
          path: ["gateResults", index, "id"],
          message: `Duplicate gate result ${gate.id}`,
        });
      }
      seenGateIds.add(gate.id);

      if (gate.status !== "passed") {
        context.addIssue({
          code: "custom",
          path: ["gateResults", index, "status"],
          message: "Approved reviews require every reported gate to pass",
        });
      }

      gate.evidencePaths.forEach((evidencePath, evidenceIndex) => {
        if (!review.artifactPaths.includes(evidencePath)) {
          context.addIssue({
            code: "custom",
            path: ["gateResults", index, "evidencePaths", evidenceIndex],
            message: "Gate evidence must be included in artifactPaths",
          });
        }
      });
    });

    review.findings.forEach((finding, index) => {
      if (finding.severity === "major" || finding.severity === "blocker") {
        context.addIssue({
          code: "custom",
          path: ["findings", index, "severity"],
          message: "Approved reviews cannot contain major or blocker findings",
        });
      }
    });

    review.requirements.forEach((requirement, index) => {
      if (requirement.verdict !== "accepted") {
        context.addIssue({
          code: "custom",
          path: ["requirements", index, "verdict"],
          message: "Approved reviews require every reviewed requirement to be accepted",
        });
      }
    });
  });

export const ContractsSubmissionSchema = z
  .object({
    kind: z.literal("contracts"),
    status: z.enum(["passed", "failed", "blocked"]),
    summary: z.string().trim().min(1).max(4_000),
    artifactPaths: z.array(z.string().trim().min(1)).default([]),
    baselinePaths: z.array(z.string().trim().min(1)).default([]),
    workloadSignals: WorkloadSignalsSchema.optional(),
  })
  .strict()
  .superRefine((submission, context) => {
    if (submission.status === "passed" && submission.artifactPaths.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["artifactPaths"],
        message: "Passed contracts require generated contract artifacts",
      });
    }

    submission.baselinePaths.forEach((baselinePath, index) => {
      if (!submission.artifactPaths.includes(baselinePath)) {
        context.addIssue({
          code: "custom",
          path: ["baselinePaths", index],
          message: "Every baseline must be included in artifactPaths",
        });
      }
    });
  });

const ApiArtifactsSchema = z
  .object({
    types: z.array(z.string().trim().min(1)).min(1),
    schemas: z.array(z.string().trim().min(1)).min(1),
    wrappers: z.array(z.string().trim().min(1)).min(1),
    mocks: z.array(z.string().trim().min(1)).min(1),
    contractTests: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

export const ApiReadySubmissionSchema = z
  .object({
    kind: z.literal("api-ready"),
    status: z.literal("passed"),
    summary: z.string().trim().min(1).max(4_000),
    implementationContextId: ImplementationContextIdSchema,
    artifactPaths: z.array(z.string().trim().min(1)).min(1),
    apiArtifacts: ApiArtifactsSchema,
  })
  .strict()
  .superRefine((submission, context) => {
    const categorizedPaths = new Set<string>();
    for (const [group, paths] of Object.entries(submission.apiArtifacts)) {
      paths.forEach((artifactPath, index) => {
        if (!submission.artifactPaths.includes(artifactPath)) {
          context.addIssue({
            code: "custom",
            path: ["apiArtifacts", group, index],
            message: "Every API-ready artifact must be included in artifactPaths",
          });
        }
        if (categorizedPaths.has(artifactPath)) {
          context.addIssue({
            code: "custom",
            path: ["apiArtifacts", group, index],
            message: "API-ready artifact categories must use distinct evidence files",
          });
        }
        categorizedPaths.add(artifactPath);
      });
    }
  });

const FeatureEvidenceSchema = z
  .object({
    scope: z.literal("targeted-feature"),
    testSelector: z
      .string()
      .trim()
      .min(3)
      .max(500)
      .refine(
        (selector) =>
          /(?:^|[/\\])[^/\\]+\.(?:spec|test)\.[cm]?[jt]sx?$/i.test(selector) ||
          /^@[a-z0-9][a-z0-9._-]+$/i.test(selector) ||
          /^--project(?:=|\s+)[a-z0-9][a-z0-9._-]+$/i.test(selector),
        "Feature E2E selector must be a specific test file, @tag, or --project value",
      ),
    testCommand: z.string().trim().min(1).max(2_000),
    resultPath: z.string().trim().min(1),
    videoPath: z
      .string()
      .trim()
      .regex(/\.(?:webm|mp4)$/i, "Feature video must be .webm or .mp4"),
  })
  .strict();

export const ImplementationSubmissionSchema = z
  .object({
    kind: z.literal("implementation"),
    status: z.enum(["passed", "failed", "blocked"]),
    summary: z.string().trim().min(1).max(4_000),
    apiReady: z.boolean(),
    implementationContextId: ImplementationContextIdSchema.optional(),
    uiChanged: z.boolean(),
    changedFiles: z.array(z.string().trim().min(1)).default([]),
    artifactPaths: z.array(z.string().trim().min(1)).default([]),
    featureEvidence: FeatureEvidenceSchema.optional(),
  })
  .strict()
  .superRefine((submission, context) => {
    if (submission.status === "passed" && submission.artifactPaths.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["artifactPaths"],
        message: "Passed implementation requires executable evidence artifacts",
      });
    }

    if (submission.featureEvidence !== undefined) {
      const evidence = submission.featureEvidence;
      if (submission.implementationContextId === undefined) {
        context.addIssue({
          code: "custom",
          path: ["implementationContextId"],
          message: "Feature evidence requires an implementationContextId",
        });
      }
      if (!isTargetedPlaywrightCommand(evidence.testCommand, evidence.testSelector)) {
        context.addIssue({
          code: "custom",
          path: ["featureEvidence", "testCommand"],
          message:
            "Targeted E2E command must be one unchained Playwright invocation with the declared selector as an argument",
        });
      }
      for (const [key, evidencePath] of [
        ["resultPath", evidence.resultPath],
        ["videoPath", evidence.videoPath],
      ] as const) {
        if (!submission.artifactPaths.includes(evidencePath)) {
          context.addIssue({
            code: "custom",
            path: ["featureEvidence", key],
            message: `${key} must be included in artifactPaths`,
          });
        }
      }
      const videos = submission.artifactPaths.filter((artifactPath) =>
        /\.(?:webm|mp4)$/i.test(artifactPath),
      );
      if (videos.length !== 1 || videos[0] !== evidence.videoPath) {
        context.addIssue({
          code: "custom",
          path: ["artifactPaths"],
          message: "Feature evidence requires exactly one declared video",
        });
      }
    }
  });

export const FigmaBundleSubmissionSchema = z
  .object({
    kind: z.literal("figma-bundle"),
    provider: z.literal("host-connected-figma"),
    capturedAt: z.string().datetime({ offset: true }),
    fileUrl: FigmaFileUrlSchema,
    nodeIds: z.array(z.string().trim().min(1)).min(1),
    manifestPath: z
      .string()
      .trim()
      .regex(/\.json$/i, "Figma manifest must be a JSON file"),
    artifactPaths: z.array(z.string().trim().min(1)).min(1),
  })
  .strict()
  .superRefine((submission, context) => {
    if (!submission.artifactPaths.includes(submission.manifestPath)) {
      context.addIssue({
        code: "custom",
        path: ["manifestPath"],
        message: "Figma manifest must be included in artifactPaths",
      });
    }
    if (new Set(submission.artifactPaths).size !== submission.artifactPaths.length) {
      context.addIssue({
        code: "custom",
        path: ["artifactPaths"],
        message: "Figma bundle artifact paths must be unique",
      });
    }
    const visualPaths = submission.artifactPaths.filter(
      (artifactPath) => artifactPath !== submission.manifestPath,
    );
    if (
      visualPaths.length === 0 ||
      visualPaths.some((artifactPath) => !/\.png$/i.test(artifactPath))
    ) {
      context.addIssue({
        code: "custom",
        path: ["artifactPaths"],
        message: "Figma bundle requires one JSON manifest and one or more PNG visuals",
      });
    }
  });

export const WorkflowSubmissionSchema = z.union([
  ContractsSubmissionSchema,
  ApiReadySubmissionSchema,
  ImplementationSubmissionSchema,
  ReviewSubmissionSchema,
  FigmaBundleSubmissionSchema,
]);

export const WorkflowActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("prepare-contracts"), runId: RunIdSchema }).strict(),
  z
    .object({
      kind: z.literal("implement"),
      runId: RunIdSchema,
      requireApiReady: z.boolean(),
    })
    .strict(),
  z.object({ kind: z.literal("review-functional"), runId: RunIdSchema }).strict(),
  z.object({ kind: z.literal("review-design"), runId: RunIdSchema }).strict(),
  z.object({ kind: z.literal("publish-draft"), runId: RunIdSchema }).strict(),
  z.object({ kind: z.literal("archive-after-merge"), runId: RunIdSchema }).strict(),
]);

export const WorkflowStageSummarySchema = z
  .object({
    name: z.string().trim().min(1),
    status: z.enum(["pending", "running", "passed", "failed", "blocked", "skipped", "waived"]),
    checkpoint: z.string().trim().min(1).optional(),
  })
  .strict();

export const WorkflowResumeContextSchema = z
  .object({
    goal: z.string().trim().min(1).max(4_000),
    evidencePaths: z.array(z.string().trim().min(1).max(1_000)).max(200),
    submissions: z
      .array(
        z
          .object({
            kind: z.string().trim().min(1),
            summary: z.string().trim().min(1).max(500),
            outcome: z.string().trim().min(1),
          })
          .strict(),
      )
      .max(16),
  })
  .strict();

export const WorkflowStatusSchema = z
  .object({
    runId: RunIdSchema,
    status: z.enum(["running", "needs-external-action", "blocked", "publish-ready", "completed"]),
    currentStage: z.string().trim().min(1).optional(),
    scope: WorkflowScopeSchema,
    deliveryProfile: DeliveryProfileSchema,
    workload: WorkloadEstimateSchema,
    requiredValidations: z.array(z.string().trim().min(1)).superRefine((items, context) => {
      if (new Set(items).size !== items.length) {
        context.addIssue({ code: "custom", message: "Required validations must be unique" });
      }
    }),
    stages: z.array(WorkflowStageSummarySchema),
    nextActions: z.array(WorkflowActionSchema),
    blockers: z.array(z.string().trim().min(1)),
    resumeContext: WorkflowResumeContextSchema,
  })
  .strict();

export type WorkflowScope = z.infer<typeof WorkflowScopeSchema>;
export type DeliveryMode = z.infer<typeof DeliveryModeSchema>;
export type ChangeKind = z.infer<typeof ChangeKindSchema>;
export type DeliveryProfile = z.infer<typeof DeliveryProfileSchema>;
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;
export type WorkflowSubmission = z.infer<typeof WorkflowSubmissionSchema>;
export type WorkflowAction = z.infer<typeof WorkflowActionSchema>;
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

function isTargetedPlaywrightCommand(command: string, selector: string): boolean {
  if (/(?:&&|\|\||[;&|`\n\r]|\$\()/.test(command)) return false;
  const tokens = tokenizeCommand(command);
  if (tokens === undefined) return false;

  let index = 0;
  if (["npx", "bunx", "yarn"].includes(tokens[index] ?? "")) index += 1;
  if (tokens[index] === "pnpm") {
    index += 1;
    if (tokens[index] === "exec") index += 1;
  }
  if (!["playwright", "./node_modules/.bin/playwright"].includes(tokens[index] ?? "")) {
    return false;
  }
  if (tokens[index + 1] !== "test") return false;

  const args = tokens.slice(index + 2);
  const parsed = parsePlaywrightArguments(args);
  if (parsed === undefined) return false;
  if (/^@/.test(selector)) {
    return (
      parsed.positionals.length === 0 && parsed.grep.length === 1 && parsed.grep[0] === selector
    );
  }
  if (/^--project(?:=|\s+)/.test(selector)) {
    const project = selector.replace(/^--project(?:=|\s+)/, "");
    return (
      parsed.positionals.length === 0 &&
      parsed.projects.length === 1 &&
      parsed.projects[0] === project
    );
  }
  return parsed.positionals.length === 1 && parsed.positionals[0] === selector;
}

function tokenizeCommand(command: string): string[] | undefined {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;
  for (const character of command.trim()) {
    if (escaped) {
      token += character;
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote !== undefined) {
      if (character === quote) quote = undefined;
      else token += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      if (token.length > 0) {
        tokens.push(token);
        token = "";
      }
    } else {
      token += character;
    }
  }
  if (escaped || quote !== undefined) return undefined;
  if (token.length > 0) tokens.push(token);
  return tokens;
}

function parsePlaywrightArguments(
  args: string[],
): { positionals: string[]; grep: string[]; projects: string[] } | undefined {
  const positionals: string[] = [];
  const grep: string[] = [];
  const projects: string[] = [];
  const forbiddenOptions = new Set(["--list", "--pass-with-no-tests"]);
  const optionsWithValues = new Set([
    "--config",
    "--grep-invert",
    "--output",
    "--reporter",
    "--repeat-each",
    "--retries",
    "--shard",
    "--timeout",
    "--trace",
    "--workers",
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--" || /^-[^-]/.test(argument)) return undefined;
    if (forbiddenOptions.has(argument)) return undefined;
    if (argument.startsWith("--grep=")) {
      grep.push(argument.slice("--grep=".length));
    } else if (argument === "--grep") {
      const value = args[++index];
      if (value === undefined || value.startsWith("-")) return undefined;
      grep.push(value);
    } else if (argument.startsWith("--project=")) {
      projects.push(argument.slice("--project=".length));
    } else if (argument === "--project") {
      const value = args[++index];
      if (value === undefined || value.startsWith("-")) return undefined;
      projects.push(value);
    } else if (optionsWithValues.has(argument)) {
      const value = args[++index];
      if (value === undefined || value.startsWith("-")) return undefined;
    } else if (argument.startsWith("--")) {
      continue;
    } else {
      positionals.push(argument);
    }
  }
  return { positionals, grep, projects };
}
