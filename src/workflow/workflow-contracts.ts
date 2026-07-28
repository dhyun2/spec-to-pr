import { z } from "zod";

import { RunStageNameSchema } from "../run/stages.js";
import { ArtifactIdSchema, RunIdSchema } from "../runtime/ids.js";
import { GitObjectIdSchema, IsoDateTimeSchema, Sha256DigestSchema } from "../runtime/scalars.js";
import { OpenSpecChangeNameSchema } from "../openspec/openspec-paths.js";
import { WorkloadEstimateSchema, WorkloadSignalsSchema } from "./workload-policy.js";
import {
  VisualCaptureSchema,
  VisualComparisonMetricsV2Schema,
  VisualRendererLineageBindingSchema,
  VisualTargetManifestSchema,
} from "../visual/visual-comparator.js";
import { WorkspaceBindingSchema } from "../workspace/workspace-binding.js";
import { DraftEvidenceBundleSchema } from "./draft-evidence-bundle.js";
import {
  CapturedFigmaComponentSchema,
  FigmaDesignMappingSchema,
  FigmaImplementationBindingSchema,
  FigmaStateContractSchema,
  assertCompleteDesignMapping,
  assertFigmaStateContracts,
} from "../figma/figma-capture-contract.js";
export { BaselineIsolationEvidenceSchema } from "../visual/baseline-isolation.js";

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

export const WorkflowSourceUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2_000)
  .superRefine((value, context) => {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") {
      context.addIssue({ code: "custom", message: "Source URL must use HTTPS" });
    }
    if (parsed.username !== "" || parsed.password !== "") {
      context.addIssue({
        code: "custom",
        message: "Source URL must not contain embedded credentials",
      });
    }
    for (const name of parsed.searchParams.keys()) {
      if (/token|secret|password|credential|api[_-]?key|authorization/i.test(name)) {
        context.addIssue({
          code: "custom",
          message: "Source URL must not contain secret-shaped query parameters",
        });
      }
    }
  });

export const ImplementationContextIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._:-]+$/i, "Implementation context ID contains unsupported characters");

export const WorkflowSourcePathSchema = z.string().trim().min(1).max(1_000);
export const SkillHintSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(
    /^[a-z0-9][a-z0-9._ -]*(?::[a-z0-9][a-z0-9._ -]*)?$/i,
    "Skill hint must be a skill name, not a filesystem path",
  );

function uniqueBoundedArray<T extends z.ZodTypeAny>(item: T, label: string, max = 20) {
  return z
    .array(item)
    .max(max)
    .superRefine((items, context) => {
      const seen = new Set<string>();
      items.forEach((item, index) => {
        const key = String(item);
        if (seen.has(key)) {
          context.addIssue({
            code: "custom",
            path: [index],
            message: `${label} entries must be unique`,
          });
        }
        seen.add(key);
      });
    });
}

const NormalizedSourcePathsSchema = uniqueBoundedArray(WorkflowSourcePathSchema, "Source path");
const NormalizedSourceUrlsSchema = uniqueBoundedArray(WorkflowSourceUrlSchema, "Source URL");
const NormalizedSkillHintsSchema = uniqueBoundedArray(SkillHintSchema, "Skill hint");
const HttpMethodSchema = z.enum([
  "GET",
  "PUT",
  "POST",
  "DELETE",
  "OPTIONS",
  "HEAD",
  "PATCH",
  "TRACE",
]);
export const OpenApiOperationContractSchema = z
  .object({
    operationKey: z.string().trim().min(3).max(1_000),
    method: HttpMethodSchema,
    path: z.string().trim().startsWith("/").max(1_000),
    operationId: z.string().trim().min(1).max(500).optional(),
    sourceLocator: z.string().trim().min(1).max(2_000),
    serverOrigins: z.array(z.string().url().max(2_000)).max(20).optional(),
  })
  .strict()
  .superRefine((operation, context) => {
    if (operation.operationKey !== `${operation.method} ${operation.path}`) {
      context.addIssue({
        code: "custom",
        path: ["operationKey"],
        message: "OpenAPI operationKey must equal '<METHOD> <path>'",
      });
    }
  });

export const BlockerKindSchema = z.enum([
  "missing-input",
  "missing-tool",
  "policy",
  "verification",
  "publish-precondition",
  "budget-split",
  "unexpected",
]);

const BlockerTextSchema = z.string().trim().min(1).max(500);
const SECRET_SHAPED_EVIDENCE_PATH_PATTERNS = [
  /(?:^|[/?#&;])(?:token|access[_-]?token|refresh[_-]?token|id[_-]?token|github[_-]?token|gitlab[_-]?token|api[_-]?key|authorization|credential|password|passwd|secret|client[_-]?secret|private[_-]?key|aws[_-]?secret[_-]?access[_-]?key)\s*(?:=|:)\s*[^/?#&;\s]+/i,
  /(?:^|[/])[^/@:\s]+:[^/@\s]+@[^/\s]+/i,
  /(?:^|[/_.-])(?:gh[pousr]_[a-z0-9]{12,}|github_pat_[a-z0-9_]{12,}|glpat-[a-z0-9_-]{12,}|sk-(?:proj-)?[a-z0-9_-]{12,}|xox[baprs]-[a-z0-9-]{12,}|akia[a-z0-9]{16})(?:$|[./_-])/i,
  /-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----/i,
] as const;
const SAFE_EVIDENCE_PATH_GRAMMAR = /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/;
const BENIGN_SENSITIVE_EVIDENCE_SEGMENTS = new Set([
  "token-validation.json",
  "credential-rotation-guide.md",
  "authorization-errors.json",
]);
const SENSITIVE_EVIDENCE_SEGMENT_PATTERN =
  /(?:^|[._-])(?:tokens?|passwords?|passwd|secrets?|credentials?|auth|authentication|authorization|api[._-]?keys?|private[._-]?keys?)(?:$|[._-])/i;

function decodeAsciiPercentEscapesToFixedPoint(value: string): string {
  let current = value;
  for (let iteration = 0; iteration <= value.length; iteration += 1) {
    let changed = false;
    const next = current.replace(/%([0-9a-f]{2})/gi, (encoded, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      if (codePoint > 0x7f) return encoded;
      changed = true;
      return String.fromCharCode(codePoint);
    });
    if (!changed || next === current) return current;
    current = next;
  }
  return current;
}

export function isSafeDurableEvidencePath(rawValue: string): boolean {
  const value = rawValue.trim();
  if (value.length === 0 || value.length > 1_000) return false;
  const decoded = decodeAsciiPercentEscapesToFixedPoint(value);
  const candidates = new Set([value, decoded]);

  return [...candidates].every((candidate) => {
    const segments = candidate.split("/");
    return (
      SAFE_EVIDENCE_PATH_GRAMMAR.test(candidate) &&
      segments.every((segment) => segment !== "." && segment !== "..") &&
      segments.every((segment, index) => {
        if (!SENSITIVE_EVIDENCE_SEGMENT_PATTERN.test(segment)) return true;
        return (
          index === segments.length - 1 &&
          BENIGN_SENSITIVE_EVIDENCE_SEGMENTS.has(segment.toLowerCase())
        );
      }) &&
      !SECRET_SHAPED_EVIDENCE_PATH_PATTERNS.some((pattern) => pattern.test(candidate))
    );
  });
}

const BlockerEvidencePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_000)
  .refine(isSafeDurableEvidencePath, "Blocker evidence paths must be safe project-relative paths");

export const WorkflowBlockerSchema = z
  .object({
    stage: RunStageNameSchema,
    code: z.string().trim().min(1).max(100),
    kind: BlockerKindSchema,
    summary: BlockerTextSchema,
    retryable: z.boolean(),
    resumable: z.boolean(),
    completedWork: z.array(BlockerTextSchema).max(20),
    evidencePaths: z.array(BlockerEvidencePathSchema).max(50),
    attemptedRecovery: z.array(BlockerTextSchema).max(20),
    unrunValidations: z.array(z.string().trim().min(1).max(200)).max(20),
    exactUnblockAction: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const DelegationPolicySchema = z
  .object({
    singleWriter: z.literal(true),
    allowNested: z.literal(false),
    maxReadOnlyScouts: z.number().int().min(0).max(2),
    parallelReviewers: z.boolean(),
  })
  .strict();

export const GuidanceTraceSchema = z
  .object({
    explicit: NormalizedSourcePathsSchema.default([]),
    discovered: NormalizedSourcePathsSchema.default([]),
    skillHints: NormalizedSkillHintsSchema.default([]),
    appliedSkills: NormalizedSkillHintsSchema.default([]),
  })
  .strict()
  .superRefine((trace, context) => {
    if (trace.explicit.length + trace.discovered.length > 20) {
      context.addIssue({
        code: "custom",
        path: ["discovered"],
        message: "Combined explicit and discovered guidance cannot exceed 20 files",
      });
    }
  });

export const DeliveryProfileSchema = z
  .object({
    mode: DeliveryModeSchema,
    changeKind: ChangeKindSchema,
    publication: PublicationIntentSchema,
    legacyProjectRoot: z.string().trim().min(1).max(1_000).optional(),
    draftEvidenceBundle: DraftEvidenceBundleSchema.optional(),
    legacyNetworkEvidencePath: WorkflowSourcePathSchema.optional(),
    briefPath: WorkflowSourcePathSchema.optional(),
    figmaUrl: FigmaFileUrlSchema.optional(),
    figmaUrls: z.array(FigmaFileUrlSchema).max(20).default([]),
    docsPaths: NormalizedSourcePathsSchema.default([]),
    openApiPaths: NormalizedSourcePathsSchema.default([]),
    openApiUrls: NormalizedSourceUrlsSchema.default([]),
    openApiOperations: z.array(OpenApiOperationContractSchema).max(1_000).default([]),
    guidancePaths: NormalizedSourcePathsSchema.default([]),
    discoveredGuidancePaths: NormalizedSourcePathsSchema.default([]),
    sourceProvenance: z
      .array(
        z
          .object({
            kind: z.enum(["brief", "docs", "openapi", "guidance", "legacy-network"]),
            locator: z.string().trim().min(1).max(2_000),
            resolvedLocator: z.string().trim().min(1).max(2_000),
            digest: Sha256DigestSchema,
            capturedAt: z.string().datetime({ offset: true }),
          })
          .strict(),
      )
      .max(100)
      .default([]),
    skillHints: NormalizedSkillHintsSchema.default([]),
    recommendedSkills: NormalizedSkillHintsSchema.default([]),
    requirements: z
      .object({
        brief: z.boolean(),
        legacyBaseline: z.boolean(),
        legacyInventory: z.boolean().default(false),
        targetedFeatureE2E: z.boolean(),
        featureVideo: z.boolean(),
        figmaBundle: z.boolean(),
        visualComparison: z.boolean().default(false),
        apiCoverage: z.boolean().default(false),
        performanceEvidence: z.boolean().default(false),
        mockData: z.boolean().default(false),
      })
      .strict(),
  })
  .strict()
  .superRefine((profile, context) => {
    if (new Set(profile.figmaUrls).size !== profile.figmaUrls.length) {
      context.addIssue({
        code: "custom",
        path: ["figmaUrls"],
        message: "Figma URLs must be unique",
      });
    }
    if (
      profile.figmaUrl !== undefined &&
      profile.figmaUrls.length > 0 &&
      profile.figmaUrls[0] !== profile.figmaUrl
    ) {
      context.addIssue({
        code: "custom",
        path: ["figmaUrl"],
        message: "Compatibility figmaUrl must match the first figmaUrls entry",
      });
    }
    const classifiedSources = new Map<string, "docsPaths" | "openApiPaths">();
    for (const field of ["docsPaths", "openApiPaths"] as const) {
      profile[field].forEach((sourcePath, index) => {
        const previous = classifiedSources.get(sourcePath);
        if (previous !== undefined && previous !== field) {
          context.addIssue({
            code: "custom",
            path: [field, index],
            message: `Source path conflicts with ${previous}: ${sourcePath}`,
          });
        }
        classifiedSources.set(sourcePath, field);
      });
    }

    const explicitGuidance = new Set(profile.guidancePaths);
    for (const field of ["guidancePaths", "discoveredGuidancePaths"] as const) {
      profile[field].forEach((sourcePath, index) => {
        const previous = classifiedSources.get(sourcePath);
        if (previous !== undefined) {
          context.addIssue({
            code: "custom",
            path: [field, index],
            message: `Guidance path conflicts with ${previous}: ${sourcePath}`,
          });
        }
      });
    }
    profile.discoveredGuidancePaths.forEach((sourcePath, index) => {
      if (explicitGuidance.has(sourcePath)) {
        context.addIssue({
          code: "custom",
          path: ["discoveredGuidancePaths", index],
          message: `Discovered guidance duplicates explicit guidance: ${sourcePath}`,
        });
      }
    });
    if (profile.guidancePaths.length + profile.discoveredGuidancePaths.length > 20) {
      context.addIssue({
        code: "custom",
        path: ["discoveredGuidancePaths"],
        message: "Combined explicit and discovered guidance cannot exceed 20 files",
      });
    }
    const operationKeys = new Set<string>();
    profile.openApiOperations.forEach((operation, index) => {
      if (operationKeys.has(operation.operationKey)) {
        context.addIssue({
          code: "custom",
          path: ["openApiOperations", index, "operationKey"],
          message: `Duplicate authoritative OpenAPI operation ${operation.operationKey}`,
        });
      }
      operationKeys.add(operation.operationKey);
    });
  });

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

export const ReviewPacketIdSchema = z
  .string()
  .regex(/^packet_[a-f0-9]{64}$/, "Expected packet_<64 lowercase hex characters>");

export const ImplementationReviewPacketSchema = z
  .object({
    id: ReviewPacketIdSchema,
    runId: RunIdSchema,
    revision: z.number().int().positive(),
    baseSha: GitObjectIdSchema,
    headSha: GitObjectIdSchema,
    evidenceDigest: Sha256DigestSchema,
    diffDigest: Sha256DigestSchema,
    changedFiles: z.array(z.string().trim().min(1)).max(10_000),
    visualLineageId: ReviewPacketIdSchema.optional(),
  })
  .strict();

const RequirementContractSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(500),
    acceptanceCriteria: z.array(z.string().trim().min(1).max(2_000)).min(1).max(50),
  })
  .strict();

const LegacyBaselineSchema = z
  .object({
    scope: z.string().trim().min(1).max(2_000),
    evidencePaths: z.array(z.string().trim().min(1)).min(1),
    checks: z
      .array(
        z
          .object({
            command: z.string().trim().min(1).max(2_000),
            resultPath: z.string().trim().min(1),
            status: z.enum(["passed", "failed"]),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

const DraftBundleSubmissionSchema = z
  .object({
    manifestPath: z.string().trim().min(1).max(1_000),
    changeName: OpenSpecChangeNameSchema,
    proposalPath: z.string().trim().min(1).max(1_000),
    specPaths: z.array(z.string().trim().min(1).max(1_000)).min(1).max(50),
    tasksPath: z.string().trim().min(1).max(1_000),
  })
  .strict()
  .superRefine((bundle, context) => {
    const paths = [bundle.manifestPath, bundle.proposalPath, ...bundle.specPaths, bundle.tasksPath];
    paths.forEach((artifactPath, index) => {
      if (!isSafeDurableEvidencePath(artifactPath)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "Draft bundle paths must be safe project-relative evidence paths",
        });
      }
    });
    if (!/^\.spec-to-pr\/[a-z0-9]+(?:-[a-z0-9]+)*\/manifest\.json$/.test(bundle.manifestPath)) {
      context.addIssue({
        code: "custom",
        path: ["manifestPath"],
        message: "Draft bundle manifest must be stored under .spec-to-pr/<feature>/manifest.json",
      });
    }
    const openSpecPrefix = `openspec/changes/${bundle.changeName}/`;
    [bundle.proposalPath, ...bundle.specPaths, bundle.tasksPath].forEach((artifactPath, index) => {
      if (!artifactPath.startsWith(openSpecPrefix)) {
        context.addIssue({
          code: "custom",
          path: [index + 1],
          message: "Draft bundle OpenSpec artifacts must belong to the declared change",
        });
      }
    });
    if (new Set(bundle.specPaths).size !== bundle.specPaths.length) {
      context.addIssue({
        code: "custom",
        path: ["specPaths"],
        message: "Draft bundle OpenSpec spec paths must be unique",
      });
    }
  });

function draftBundleArtifactPaths(bundle: z.infer<typeof DraftBundleSubmissionSchema>): string[] {
  return [bundle.manifestPath, bundle.proposalPath, ...bundle.specPaths, bundle.tasksPath];
}

const LegacyCoverageSchema = z
  .object({
    featureKey: z.string().regex(/^legacy_[a-f0-9]{24}$/),
    requirementIds: z.array(z.string().trim().min(1).max(200)).min(1).max(50),
    status: z.enum(["planned", "migrated", "intentionally-out-of-scope", "gap", "blocked"]),
    targetFiles: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
    executableEvidencePaths: z.array(z.string().trim().min(1).max(1_000)).max(50).default([]),
    rationale: z.string().trim().min(1).max(2_000),
  })
  .strict()
  .superRefine((coverage, context) => {
    if (
      coverage.status === "migrated" &&
      (coverage.targetFiles.length === 0 || coverage.executableEvidencePaths.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Migrated legacy coverage requires target files and executable evidence",
      });
    }
    if (
      coverage.status === "planned" &&
      (coverage.targetFiles.length > 0 || coverage.executableEvidencePaths.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Planned legacy coverage cannot claim implementation files or evidence",
      });
    }
  });

const VisualTargetsSchema = z
  .array(VisualTargetManifestSchema)
  .max(50)
  .superRefine((targets, context) => {
    const ids = new Set<string>();
    targets.forEach((target, index) => {
      if (ids.has(target.targetId)) {
        context.addIssue({
          code: "custom",
          path: [index, "targetId"],
          message: `Duplicate visual target ${target.targetId}`,
        });
      }
      ids.add(target.targetId);
    });
  });

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
    reviewPacketId: ReviewPacketIdSchema,
    verdict: ReviewVerdictSchema,
    summary: z.string().trim().min(1).max(4_000),
    findings: z.array(ReviewFindingSchema).default([]),
    requirements: z.array(ReviewRequirementSchema).default([]),
    artifactPaths: z.array(z.string().trim().min(1)).default([]),
    gateResults: z.array(ReviewGateResultSchema).default([]),
    blocker: WorkflowBlockerSchema.optional(),
  })
  .strict()
  .superRefine((review, context) => {
    if (review.verdict === "approved" && review.blocker !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["blocker"],
        message: "Approved reviews cannot report a blocker",
      });
    }
    if (review.blocker !== undefined && review.blocker.stage !== review.kind) {
      context.addIssue({
        code: "custom",
        path: ["blocker", "stage"],
        message: "Review blockers must identify the submitted review stage",
      });
    }
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
    requirementManifest: z.array(RequirementContractSchema).default([]),
    legacyBaseline: LegacyBaselineSchema.optional(),
    legacyScopeKeys: z
      .array(z.string().regex(/^legacy_[a-f0-9]{24}$/))
      .max(500)
      .default([]),
    legacyCoverage: z.array(LegacyCoverageSchema).max(500).default([]),
    visualTargets: VisualTargetsSchema.default([]),
    draftBundle: DraftBundleSubmissionSchema.optional(),
    workloadSignals: WorkloadSignalsSchema.optional(),
    guidanceTrace: GuidanceTraceSchema.default({
      explicit: [],
      discovered: [],
      skillHints: [],
      appliedSkills: [],
    }),
    blocker: WorkflowBlockerSchema.optional(),
  })
  .strict()
  .superRefine((submission, context) => {
    if (submission.status === "passed" && submission.blocker !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["blocker"],
        message: "Passed contracts cannot report a blocker",
      });
    }
    if (submission.blocker !== undefined && submission.blocker.stage !== "contracts") {
      context.addIssue({
        code: "custom",
        path: ["blocker", "stage"],
        message: "Contract blockers must identify the contracts stage",
      });
    }
    if (submission.status === "passed" && submission.artifactPaths.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["artifactPaths"],
        message: "Passed contracts require generated contract artifacts",
      });
    }

    if (submission.status === "passed" && submission.requirementManifest.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["requirementManifest"],
        message: "Passed contracts require structured requirements and acceptance criteria",
      });
    }

    const requirementIds = new Set<string>();
    submission.requirementManifest.forEach((requirement, index) => {
      if (requirementIds.has(requirement.id)) {
        context.addIssue({
          code: "custom",
          path: ["requirementManifest", index, "id"],
          message: `Duplicate requirement ${requirement.id}`,
        });
      }
      requirementIds.add(requirement.id);
    });

    submission.baselinePaths.forEach((baselinePath, index) => {
      if (!submission.artifactPaths.includes(baselinePath)) {
        context.addIssue({
          code: "custom",
          path: ["baselinePaths", index],
          message: "Every baseline must be included in artifactPaths",
        });
      }
    });

    submission.legacyBaseline?.evidencePaths.forEach((baselinePath, index) => {
      if (!submission.artifactPaths.includes(baselinePath)) {
        context.addIssue({
          code: "custom",
          path: ["legacyBaseline", "evidencePaths", index],
          message: "Every focused legacy baseline must be included in artifactPaths",
        });
      }
    });
    submission.legacyBaseline?.checks.forEach((check, index) => {
      if (!submission.legacyBaseline?.evidencePaths.includes(check.resultPath)) {
        context.addIssue({
          code: "custom",
          path: ["legacyBaseline", "checks", index, "resultPath"],
          message: "Legacy baseline check results must be declared as baseline evidence",
        });
      }
      if (submission.status === "passed" && check.status !== "passed") {
        context.addIssue({
          code: "custom",
          path: ["legacyBaseline", "checks", index, "status"],
          message: "Passed contracts require every focused legacy baseline check to pass",
        });
      }
    });
    submission.visualTargets.forEach((target, index) => {
      if (!submission.artifactPaths.includes(target.baselinePath)) {
        context.addIssue({
          code: "custom",
          path: ["visualTargets", index, "baselinePath"],
          message: "Every visual baseline must be included in artifactPaths",
        });
      }
    });
    if (submission.draftBundle !== undefined) {
      draftBundleArtifactPaths(submission.draftBundle).forEach((artifactPath, index) => {
        if (!submission.artifactPaths.includes(artifactPath)) {
          context.addIssue({
            code: "custom",
            path: ["draftBundle", index],
            message: "Every Draft bundle artifact must be included in artifactPaths",
          });
        }
      });
    }
    const scopedKeys = new Set(submission.legacyScopeKeys);
    if (scopedKeys.size !== submission.legacyScopeKeys.length) {
      context.addIssue({
        code: "custom",
        path: ["legacyScopeKeys"],
        message: "Legacy scope keys must be unique",
      });
    }
    const coverageKeys = new Set<string>();
    submission.legacyCoverage.forEach((coverage, index) => {
      if (coverageKeys.has(coverage.featureKey)) {
        context.addIssue({
          code: "custom",
          path: ["legacyCoverage", index, "featureKey"],
          message: `Duplicate legacy coverage ${coverage.featureKey}`,
        });
      }
      if (!scopedKeys.has(coverage.featureKey)) {
        context.addIssue({
          code: "custom",
          path: ["legacyCoverage", index, "featureKey"],
          message: "Legacy coverage must reference an explicitly scoped feature key",
        });
      }
      if (submission.status === "passed" && coverage.status !== "planned") {
        context.addIssue({
          code: "custom",
          path: ["legacyCoverage", index, "status"],
          message: "Passed contracts may only mark selected legacy scope as planned",
        });
      }
      coverageKeys.add(coverage.featureKey);
    });
    submission.legacyScopeKeys.forEach((featureKey, index) => {
      if (!coverageKeys.has(featureKey)) {
        context.addIssue({
          code: "custom",
          path: ["legacyScopeKeys", index],
          message: `Missing legacy coverage for ${featureKey}`,
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

const ApiOperationReadySchema = z
  .object({
    operationKey: z.string().trim().min(3).max(1_000),
    method: HttpMethodSchema,
    path: z.string().trim().startsWith("/").max(1_000),
    operationId: z.string().trim().min(1).max(500).optional(),
    requestTypes: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
    responseTypes: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
    schemaRefs: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
    clientSymbols: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
    mockHandlers: z.array(z.string().trim().min(1).max(1_000)).max(50).default([]),
    contractEvidencePaths: z.array(z.string().trim().min(1).max(1_000)).max(50).default([]),
    readiness: z.enum(["generated", "contract-tested", "intentionally-out-of-scope", "gap"]),
    blocking: z.boolean().default(false),
    notes: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict()
  .superRefine((operation, context) => {
    if (operation.operationKey !== `${operation.method} ${operation.path}`) {
      context.addIssue({
        code: "custom",
        path: ["operationKey"],
        message: "API operationKey must equal '<METHOD> <path>'",
      });
    }
    if (
      (operation.readiness === "generated" || operation.readiness === "contract-tested") &&
      (operation.clientSymbols.length === 0 || operation.mockHandlers.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Generated API operations require client symbols and mock handlers",
      });
    }
    if (operation.readiness === "contract-tested" && operation.contractEvidencePaths.length === 0) {
      context.addIssue({ code: "custom", message: "Contract-tested operations require evidence" });
    }
    if (operation.readiness === "gap" && operation.notes === undefined) {
      context.addIssue({ code: "custom", path: ["notes"], message: "API gaps require notes" });
    }
  });

export const ApiReadySubmissionSchema = z
  .object({
    kind: z.literal("api-ready"),
    status: z.literal("passed"),
    summary: z.string().trim().min(1).max(4_000),
    implementationContextId: ImplementationContextIdSchema,
    artifactPaths: z.array(z.string().trim().min(1)).min(1),
    apiArtifacts: ApiArtifactsSchema,
    operations: z.array(ApiOperationReadySchema).max(1_000).default([]),
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
    const operationKeys = new Set<string>();
    submission.operations.forEach((operation, index) => {
      if (operationKeys.has(operation.operationKey)) {
        context.addIssue({
          code: "custom",
          path: ["operations", index, "operationKey"],
          message: `Duplicate API operation ${operation.operationKey}`,
        });
      }
      operation.contractEvidencePaths.forEach((evidencePath, evidenceIndex) => {
        if (!submission.artifactPaths.includes(evidencePath)) {
          context.addIssue({
            code: "custom",
            path: ["operations", index, "contractEvidencePaths", evidenceIndex],
            message: "API operation evidence must be included in artifactPaths",
          });
        }
      });
      if (operation.readiness === "gap" && operation.blocking) {
        context.addIssue({
          code: "custom",
          path: ["operations", index, "blocking"],
          message: "A passed API-ready checkpoint cannot retain a blocking gap",
        });
      }
      operationKeys.add(operation.operationKey);
    });
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

const ApiOperationCoverageSchema = z
  .object({
    operationKey: z.string().trim().min(3).max(1_000),
    method: HttpMethodSchema,
    path: z.string().trim().startsWith("/").max(1_000),
    operationId: z.string().trim().min(1).max(500).optional(),
    status: z.enum(["exercised", "intentionally-out-of-scope", "gap"]),
    productionCallSites: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
    mockHandlers: z.array(z.string().trim().min(1).max(1_000)).max(50).default([]),
    executableEvidencePaths: z.array(z.string().trim().min(1).max(1_000)).max(50).default([]),
    blocking: z.boolean().default(false),
    notes: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict()
  .superRefine((operation, context) => {
    if (operation.operationKey !== `${operation.method} ${operation.path}`) {
      context.addIssue({
        code: "custom",
        path: ["operationKey"],
        message: "API operationKey must equal '<METHOD> <path>'",
      });
    }
    if (
      operation.status === "exercised" &&
      (operation.productionCallSites.length === 0 ||
        operation.mockHandlers.length === 0 ||
        operation.executableEvidencePaths.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Exercised API operations require production, mock, and executable evidence",
      });
    }
    if (operation.status !== "exercised" && operation.notes === undefined) {
      context.addIssue({
        code: "custom",
        path: ["notes"],
        message: "API exclusions and gaps require notes",
      });
    }
  });

const LabPerformanceEvidenceSchema = z
  .object({
    route: z.string().trim().min(1).max(2_000),
    tool: z.string().trim().min(1).max(200),
    command: z.string().trim().min(1).max(2_000),
    deviceProfile: z.string().trim().min(1).max(500),
    throttling: z.string().trim().min(1).max(500),
    sampleCount: z.number().int().positive().max(100),
    resultPath: z.string().trim().min(1).max(1_000),
    metrics: z
      .object({
        lcpMs: z.number().nonnegative(),
        cls: z.number().nonnegative(),
        tbtMs: z.number().nonnegative().optional(),
        interactionLatencyMs: z.number().nonnegative().optional(),
      })
      .strict()
      .refine(
        (metrics) => metrics.tbtMs !== undefined || metrics.interactionLatencyMs !== undefined,
        "Lab evidence requires TBT or measured interaction latency",
      ),
  })
  .strict();

const FieldPerformanceEvidenceSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("available"),
      source: z.enum(["crux", "rum"]),
      sampleWindow: z.string().trim().min(1).max(500),
      metrics: z
        .object({
          lcpMs: z.number().nonnegative(),
          inpMs: z.number().nonnegative(),
          cls: z.number().nonnegative(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      status: z.literal("unavailable"),
      reason: z.string().trim().min(1).max(1_000),
    })
    .strict(),
]);

const PerformanceEvidenceSchema = z
  .object({
    lab: LabPerformanceEvidenceSchema,
    field: FieldPerformanceEvidenceSchema,
  })
  .strict();

const MockDataEvidenceSchema = z
  .object({
    manifestPath: z
      .string()
      .trim()
      .regex(/\.json$/i, "Mock data manifest must be JSON"),
    fixturePaths: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(1_000)
          .regex(/\.json$/i, "Mock fixtures must be JSON"),
      )
      .min(1)
      .max(100)
      .optional(),
    fixtures: z
      .array(
        z
          .object({
            id: z
              .string()
              .trim()
              .min(1)
              .max(300)
              .regex(/^[a-z0-9][a-z0-9._:-]*$/i),
            path: z
              .string()
              .trim()
              .min(1)
              .max(1_000)
              .regex(/\.json$/i, "Mock fixtures must be JSON"),
            stateContractDigest: Sha256DigestSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .optional(),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.fixturePaths === undefined && evidence.fixtures === undefined) {
      context.addIssue({
        code: "custom",
        path: ["fixtures"],
        message: "Mock evidence requires fixtures",
      });
      return;
    }
    if (evidence.fixturePaths !== undefined && evidence.fixtures !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["fixtures"],
        message: "Use named fixtures or compatibility fixturePaths, not both",
      });
      return;
    }
    const fixturePaths =
      evidence.fixtures?.map((fixture) => fixture.path) ?? evidence.fixturePaths ?? [];
    const unique = new Set(fixturePaths);
    if (unique.size !== fixturePaths.length) {
      context.addIssue({
        code: "custom",
        path: [evidence.fixtures === undefined ? "fixturePaths" : "fixtures"],
        message: "Mock fixture paths must be unique",
      });
    }
    if (unique.has(evidence.manifestPath)) {
      context.addIssue({
        code: "custom",
        path: [evidence.fixtures === undefined ? "fixturePaths" : "fixtures"],
        message: "Mock manifest cannot also be a fixture",
      });
    }
    if (evidence.fixtures !== undefined) {
      const fixtureIds = new Set(evidence.fixtures.map((fixture) => fixture.id));
      if (fixtureIds.size !== evidence.fixtures.length) {
        context.addIssue({
          code: "custom",
          path: ["fixtures"],
          message: "Mock fixture IDs must be unique",
        });
      }
    }
  });

const DesignSystemUsageSchema = FigmaImplementationBindingSchema;

const DesignSystemEvidenceSchema = z
  .object({
    usages: z.array(DesignSystemUsageSchema).max(1_000),
  })
  .strict()
  .superRefine((evidence, context) => {
    const mappingIds = new Set<string>();
    evidence.usages.forEach((usage, index) => {
      if (mappingIds.has(usage.mappingId)) {
        context.addIssue({
          code: "custom",
          path: ["usages", index, "mappingId"],
          message: `Duplicate design-system usage ${usage.mappingId}`,
        });
      }
      mappingIds.add(usage.mappingId);
    });
  });

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
    apiCoverage: z.array(ApiOperationCoverageSchema).max(1_000).default([]),
    legacyCoverage: z.array(LegacyCoverageSchema).max(500).default([]),
    performanceEvidence: PerformanceEvidenceSchema.optional(),
    mockDataEvidence: MockDataEvidenceSchema.optional(),
    designSystemEvidence: DesignSystemEvidenceSchema.optional(),
    blocker: WorkflowBlockerSchema.optional(),
  })
  .strict()
  .superRefine((submission, context) => {
    if (submission.status === "passed" && submission.blocker !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["blocker"],
        message: "Passed implementations cannot report a blocker",
      });
    }
    if (submission.blocker !== undefined && submission.blocker.stage !== "implementation") {
      context.addIssue({
        code: "custom",
        path: ["blocker", "stage"],
        message: "Implementation blockers must identify the implementation stage",
      });
    }
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
    const coverageKeys = new Set<string>();
    submission.apiCoverage.forEach((operation, index) => {
      if (coverageKeys.has(operation.operationKey)) {
        context.addIssue({
          code: "custom",
          path: ["apiCoverage", index, "operationKey"],
          message: `Duplicate API coverage ${operation.operationKey}`,
        });
      }
      operation.executableEvidencePaths.forEach((evidencePath, evidenceIndex) => {
        if (!submission.artifactPaths.includes(evidencePath)) {
          context.addIssue({
            code: "custom",
            path: ["apiCoverage", index, "executableEvidencePaths", evidenceIndex],
            message: "API executable evidence must be included in artifactPaths",
          });
        }
      });
      if (submission.status === "passed" && operation.status === "gap" && operation.blocking) {
        context.addIssue({
          code: "custom",
          path: ["apiCoverage", index, "blocking"],
          message: "Passed implementation cannot retain a blocking API gap",
        });
      }
      coverageKeys.add(operation.operationKey);
    });
    const legacyCoverageKeys = new Set<string>();
    submission.legacyCoverage.forEach((coverage, index) => {
      if (legacyCoverageKeys.has(coverage.featureKey)) {
        context.addIssue({
          code: "custom",
          path: ["legacyCoverage", index, "featureKey"],
          message: `Duplicate implemented legacy coverage ${coverage.featureKey}`,
        });
      }
      coverage.targetFiles.forEach((targetFile, targetIndex) => {
        if (!submission.changedFiles.includes(targetFile)) {
          context.addIssue({
            code: "custom",
            path: ["legacyCoverage", index, "targetFiles", targetIndex],
            message: "Legacy target files must be included in changedFiles",
          });
        }
      });
      coverage.executableEvidencePaths.forEach((evidencePath, evidenceIndex) => {
        if (!submission.artifactPaths.includes(evidencePath)) {
          context.addIssue({
            code: "custom",
            path: ["legacyCoverage", index, "executableEvidencePaths", evidenceIndex],
            message: "Legacy executable evidence must be included in artifactPaths",
          });
        }
      });
      if (submission.status === "passed" && coverage.status !== "migrated") {
        context.addIssue({
          code: "custom",
          path: ["legacyCoverage", index, "status"],
          message: "Passed implementation requires every selected legacy feature to be migrated",
        });
      }
      legacyCoverageKeys.add(coverage.featureKey);
    });
    if (submission.mockDataEvidence !== undefined) {
      for (const evidencePath of [
        submission.mockDataEvidence.manifestPath,
        ...(submission.mockDataEvidence.fixtures?.map((fixture) => fixture.path) ??
          submission.mockDataEvidence.fixturePaths ??
          []),
      ]) {
        if (!submission.artifactPaths.includes(evidencePath)) {
          context.addIssue({
            code: "custom",
            path: ["mockDataEvidence"],
            message: "Mock manifest and fixtures must be included in artifactPaths",
          });
        }
      }
    }
    if (submission.designSystemEvidence !== undefined) {
      submission.designSystemEvidence.usages.forEach((usage, index) => {
        if (!submission.changedFiles.includes(usage.sourceFile)) {
          context.addIssue({
            code: "custom",
            path: ["designSystemEvidence", "usages", index, "sourceFile"],
            message: "Design-system usage source files must be included in changedFiles",
          });
        }
      });
    }
    if (
      submission.performanceEvidence !== undefined &&
      !submission.artifactPaths.includes(submission.performanceEvidence.lab.resultPath)
    ) {
      context.addIssue({
        code: "custom",
        path: ["performanceEvidence", "lab", "resultPath"],
        message: "Lab performance result must be included in artifactPaths",
      });
    }
  });

export const FigmaBundleSubmissionSchema = z
  .object({
    kind: z.literal("figma-bundle"),
    provider: z.literal("host-connected-figma"),
    capturedAt: z.string().datetime({ offset: true }),
    fileUrl: FigmaFileUrlSchema,
    fileUrls: z.array(FigmaFileUrlSchema).min(1).max(20).optional(),
    nodeIds: z.array(z.string().trim().min(1)).min(1),
    capturedComponents: z.array(CapturedFigmaComponentSchema).max(1_000),
    designMapping: FigmaDesignMappingSchema,
    manifestPath: z
      .string()
      .trim()
      .regex(/\.json$/i, "Figma manifest must be a JSON file"),
    stateContracts: z.array(FigmaStateContractSchema).min(1).max(50),
    visualTargets: VisualTargetsSchema.min(1),
    artifactPaths: z.array(z.string().trim().min(1)).min(1),
  })
  .strict()
  .superRefine((submission, context) => {
    const fileUrls = submission.fileUrls ?? [submission.fileUrl];
    if (fileUrls[0] !== submission.fileUrl || new Set(fileUrls).size !== fileUrls.length) {
      context.addIssue({
        code: "custom",
        path: ["fileUrls"],
        message: "Figma fileUrls must be unique and begin with fileUrl",
      });
    }
    try {
      assertCompleteDesignMapping({
        capturedComponents: submission.capturedComponents,
        mapping: submission.designMapping,
      });
    } catch (error: unknown) {
      context.addIssue({
        code: "custom",
        path: ["designMapping"],
        message: error instanceof Error ? error.message : "Figma design mapping is incomplete",
      });
    }
    try {
      assertFigmaStateContracts({
        nodeIds: submission.nodeIds,
        targets: submission.visualTargets,
        stateContracts: submission.stateContracts,
      });
    } catch (error: unknown) {
      context.addIssue({
        code: "custom",
        path: ["stateContracts"],
        message: error instanceof Error ? error.message : "Figma state contracts are invalid",
      });
    }
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
    submission.visualTargets.forEach((target, index) => {
      if (target.baselineKind !== "figma") {
        context.addIssue({
          code: "custom",
          path: ["visualTargets", index, "baselineKind"],
          message: "Figma bundle targets must use the Figma baseline kind",
        });
      }
      if (target.figmaCapture === undefined) {
        context.addIssue({
          code: "custom",
          path: ["visualTargets", index, "figmaCapture"],
          message: "Figma bundle targets require native capture geometry",
        });
      } else if (!("schemaVersion" in target.figmaCapture)) {
        context.addIssue({
          code: "custom",
          path: ["visualTargets", index, "figmaCapture"],
          message:
            "FIGMA_CAPTURE_GEOMETRY_REACQUISITION_REQUIRED: historical v1 geometry cannot be used for a new Figma bundle",
        });
      }
      if (!submission.artifactPaths.includes(target.baselinePath)) {
        context.addIssue({
          code: "custom",
          path: ["visualTargets", index, "baselinePath"],
          message: "Every Figma target baseline must be included in artifactPaths",
        });
      }
    });
  });

export const VisualComparisonSubmissionSchema = z
  .object({
    kind: z.literal("visual-comparison"),
    reviewPacketId: ReviewPacketIdSchema,
    captures: z.array(VisualCaptureSchema).min(1).max(50),
    baselineIsolationPath: z
      .string()
      .trim()
      .regex(/\.json$/i, "Baseline-isolation evidence must be a JSON file"),
    baselineIsolationDigest: Sha256DigestSchema,
    artifactPaths: z.array(z.string().trim().min(1)).min(1).max(100),
  })
  .strict()
  .superRefine((submission, context) => {
    const targetIds = new Set<string>();
    const actualPaths = new Set<string>();
    const expectedArtifactPaths = new Set<string>([submission.baselineIsolationPath]);
    const expectedDirectory = `visual/actual/${submission.reviewPacketId}/`;
    const isolationFileName = submission.baselineIsolationPath.slice(expectedDirectory.length);
    if (
      !submission.baselineIsolationPath.startsWith(expectedDirectory) ||
      isolationFileName.includes("/") ||
      !/^[a-z0-9][a-z0-9._:-]*\.json$/i.test(isolationFileName)
    ) {
      context.addIssue({
        code: "custom",
        path: ["baselineIsolationPath"],
        message: `Baseline-isolation evidence must use a distinct file in ${expectedDirectory}`,
      });
    }
    submission.captures.forEach((capture, index) => {
      if (targetIds.has(capture.targetId)) {
        context.addIssue({
          code: "custom",
          path: ["captures", index, "targetId"],
          message: `Duplicate visual capture ${capture.targetId}`,
        });
      }
      if (actualPaths.has(capture.actualPath)) {
        context.addIssue({
          code: "custom",
          path: ["captures", index, "actualPath"],
          message: "Each visual target requires a distinct actual PNG",
        });
      }
      const fileName = capture.actualPath.slice(expectedDirectory.length);
      if (
        !capture.actualPath.startsWith(expectedDirectory) ||
        fileName.includes("/") ||
        !/^[a-z0-9][a-z0-9._:-]*\.png$/i.test(fileName)
      ) {
        context.addIssue({
          code: "custom",
          path: ["captures", index, "actualPath"],
          message: `Visual actual must use the packet-specific directory: ${expectedDirectory}`,
        });
      }
      targetIds.add(capture.targetId);
      actualPaths.add(capture.actualPath);
      expectedArtifactPaths.add(capture.actualPath);
      const assertionReportFileName = capture.assertionReportPath.slice(expectedDirectory.length);
      if (
        !capture.assertionReportPath.startsWith(expectedDirectory) ||
        assertionReportFileName.includes("/") ||
        !/^[a-z0-9][a-z0-9._:-]*\.json$/i.test(assertionReportFileName) ||
        expectedArtifactPaths.has(capture.assertionReportPath)
      ) {
        context.addIssue({
          code: "custom",
          path: ["captures", index, "assertionReportPath"],
          message: `UI assertion report must use a distinct file in ${expectedDirectory}`,
        });
      }
      expectedArtifactPaths.add(capture.assertionReportPath);
      if (capture.receiptPath !== undefined) {
        const receiptFileName = capture.receiptPath.slice(expectedDirectory.length);
        if (
          !capture.receiptPath.startsWith(expectedDirectory) ||
          receiptFileName.includes("/") ||
          !/^[a-z0-9][a-z0-9._:-]*\.json$/i.test(receiptFileName) ||
          expectedArtifactPaths.has(capture.receiptPath)
        ) {
          context.addIssue({
            code: "custom",
            path: ["captures", index, "receiptPath"],
            message: `Visual receipt must use a distinct file in ${expectedDirectory}`,
          });
        }
        expectedArtifactPaths.add(capture.receiptPath);
      }
    });
    if (
      submission.artifactPaths.length !== expectedArtifactPaths.size ||
      submission.artifactPaths.some((artifactPath) => !expectedArtifactPaths.has(artifactPath))
    ) {
      context.addIssue({
        code: "custom",
        path: ["artifactPaths"],
        message:
          "Visual comparison artifactPaths must exactly match submitted actual PNGs, receipts, UI assertion reports, and baseline-isolation evidence",
      });
    }
  });

export const WorkflowSubmissionSchema = z.union([
  z
    .object({
      kind: z.literal("legacy-network-evidence"),
      evidencePath: WorkflowSourcePathSchema,
    })
    .strict(),
  ContractsSubmissionSchema,
  ApiReadySubmissionSchema,
  ImplementationSubmissionSchema,
  ReviewSubmissionSchema,
  FigmaBundleSubmissionSchema,
  VisualComparisonSubmissionSchema,
]);

export const CompactFailedVisualTargetsSchema = z
  .array(
    z
      .object({
        targetId: VisualTargetManifestSchema.shape.targetId,
        reviewMatchRatio: z.number().min(0).max(1),
      })
      .strict(),
  )
  .min(1)
  .max(50);

export const VisualRepairEvidenceV2Schema = z
  .object({
    schemaVersion: z.literal("visual-repair-evidence-v2"),
    runId: RunIdSchema,
    lineageId: ReviewPacketIdSchema,
    reviewPacketId: ReviewPacketIdSchema,
    headSha: GitObjectIdSchema,
    rendererLineageId: VisualRendererLineageBindingSchema.shape.rendererLineageId.optional(),
    attempt: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    generatedAt: IsoDateTimeSchema,
    failedTargets: z
      .array(
        z
          .object({
            targetId: VisualTargetManifestSchema.shape.targetId,
            name: z.string(),
            route: z.string(),
            state: z.string(),
            fixture: z.string(),
            viewport: VisualTargetManifestSchema.shape.viewport,
            deviceScaleFactor: z.number(),
            metrics: VisualComparisonMetricsV2Schema,
            diffArtifactId: ArtifactIdSchema,
            overlayArtifactId: ArtifactIdSchema,
            captureSummary: z
              .object({
                provider: z.string(),
                browser: z.string(),
                fontsReady: z.boolean(),
                assetsReady: z.boolean(),
              })
              .strict(),
            causeHints: z.array(
              z.enum([
                "implementation",
                "acquisition",
                "fixture",
                "design-mapping",
                "baseline-isolation",
              ]),
            ),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

export const VisualLineageOutcomeV2Schema = z
  .object({
    schemaVersion: z.literal("visual-repair-lineage-v2"),
    runId: RunIdSchema,
    lineageId: ReviewPacketIdSchema,
    reviewPacketId: ReviewPacketIdSchema,
    headSha: GitObjectIdSchema,
    rendererLineageId: VisualRendererLineageBindingSchema.shape.rendererLineageId.optional(),
    attempt: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    generatedAt: IsoDateTimeSchema,
    status: z.literal("closed"),
  })
  .strict();

export const CurrentImplementationRepairActionSchema = z
  .object({
    kind: z.literal("implementation-repair"),
    repairEvidenceVersion: z.literal("v2"),
    runId: RunIdSchema,
    reviewPacketId: ReviewPacketIdSchema,
    lineageId: ReviewPacketIdSchema,
    nextAttempt: z.union([z.literal(2), z.literal(3)]),
    failedTargets: CompactFailedVisualTargetsSchema,
    repairEvidenceArtifactId: ArtifactIdSchema,
  })
  .strict();

export const LegacyImplementationRepairActionSchema = z
  .object({
    kind: z.literal("implementation-repair"),
    repairEvidenceVersion: z.literal("legacy-v1"),
    runId: RunIdSchema,
    reviewPacketId: ReviewPacketIdSchema,
    lineageId: ReviewPacketIdSchema,
    nextAttempt: z.union([z.literal(2), z.literal(3)]),
    failedTargets: CompactFailedVisualTargetsSchema,
  })
  .strict();

const ImplementationRepairActionSchema = z.discriminatedUnion("repairEvidenceVersion", [
  CurrentImplementationRepairActionSchema,
  LegacyImplementationRepairActionSchema,
]);

export const WorkflowActionSchema = z.union([
  z
    .object({
      kind: z.literal("collect-legacy-network-evidence"),
      runId: RunIdSchema,
      maxBytes: z.literal(1024 * 1024),
      maxRequests: z.literal(1_000),
    })
    .strict(),
  z.object({ kind: z.literal("prepare-contracts"), runId: RunIdSchema }).strict(),
  z
    .object({
      kind: z.literal("implement"),
      runId: RunIdSchema,
      requireApiReady: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("compare-visuals"),
      runId: RunIdSchema,
      reviewPacketId: ReviewPacketIdSchema,
      attempt: z.number().int().min(1).max(3),
    })
    .strict(),
  ImplementationRepairActionSchema,
  z
    .object({
      kind: z.literal("review-functional"),
      runId: RunIdSchema,
      reviewPacketId: ReviewPacketIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("review-design"),
      runId: RunIdSchema,
      reviewPacketId: ReviewPacketIdSchema,
    })
    .strict(),
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

export const DiagnosticPublicationSchema = z
  .object({
    host: z.enum(["github", "gitlab"]),
    url: z.string().url(),
    number: z.string().trim().min(1).max(100),
    created: z.boolean(),
    updated: z.boolean(),
    publishResultArtifactId: ArtifactIdSchema,
  })
  .strict()
  .refine((publication) => publication.created || publication.updated, {
    message: "Diagnostic publication evidence must record a created or updated request",
  });

export const WorkflowStatusSchema = z
  .object({
    runId: RunIdSchema,
    revision: z.number().int().nonnegative(),
    status: z.enum(["running", "needs-external-action", "blocked", "publish-ready", "completed"]),
    currentStage: z.string().trim().min(1).optional(),
    scope: WorkflowScopeSchema,
    deliveryProfile: DeliveryProfileSchema,
    workspaceBinding: WorkspaceBindingSchema.optional(),
    workload: WorkloadEstimateSchema,
    delegationPolicy: DelegationPolicySchema,
    requiredValidations: z.array(z.string().trim().min(1)).superRefine((items, context) => {
      if (new Set(items).size !== items.length) {
        context.addIssue({ code: "custom", message: "Required validations must be unique" });
      }
    }),
    stages: z.array(WorkflowStageSummarySchema),
    nextActions: z.array(WorkflowActionSchema),
    blockers: z.array(z.string().trim().min(1)),
    blockerDetails: z.array(WorkflowBlockerSchema),
    diagnosticPublication: DiagnosticPublicationSchema.optional(),
    legacyInventory: z
      .object({
        artifactId: ArtifactIdSchema,
        version: z.union([z.literal(2), z.literal(3)]),
        rootDigest: Sha256DigestSchema,
        truncated: z.boolean(),
        apiState: z.enum(["not-detected", "detected", "truncated"]),
        apiDiscoveryAdapters: z.array(z.string().trim().min(1).max(100)).max(20),
        entries: z
          .array(
            z
              .object({
                featureKey: z.string(),
                category: z.string(),
                normalizedKey: z.string(),
                sourcePath: z.string(),
                symbol: z.string(),
              })
              .strict(),
          )
          .max(500),
        apiCandidates: z
          .array(
            z
              .object({
                operationKey: z.string(),
                originRef: z.string().optional(),
                origins: z.array(z.string()).max(20).optional(),
                sourcePaths: z.array(z.string()).max(100),
                transportRefs: z.array(z.string()).max(100),
              })
              .strict(),
          )
          .max(500),
        supportingDependencies: z.array(z.string()).max(500),
      })
      .strict()
      .optional(),
    resumeContext: WorkflowResumeContextSchema,
  })
  .strict();

export type WorkflowScope = z.infer<typeof WorkflowScopeSchema>;
export type DeliveryMode = z.infer<typeof DeliveryModeSchema>;
export type ChangeKind = z.infer<typeof ChangeKindSchema>;
export type DeliveryProfile = z.infer<typeof DeliveryProfileSchema>;
export type GuidanceTrace = z.infer<typeof GuidanceTraceSchema>;
export type WorkflowBlocker = z.infer<typeof WorkflowBlockerSchema>;
export type DiagnosticPublication = z.infer<typeof DiagnosticPublicationSchema>;
export type DelegationPolicy = z.infer<typeof DelegationPolicySchema>;
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;
export type ImplementationReviewPacket = z.infer<typeof ImplementationReviewPacketSchema>;
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
