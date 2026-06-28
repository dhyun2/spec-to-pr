import { access } from "node:fs/promises";
import path from "node:path";

import {
  OpenSpecChangeNameSchema,
  resolveOpenSpecChangePaths,
  toRepoRelativePath,
} from "../openspec/openspec-paths.js";
import type { RunManifest } from "../run/index.js";
import type { CheckResult, Gap } from "../runtime/index.js";
import {
  ArchivePreconditionSchema,
  OpenSpecArchivePlanSchema,
  type OpenSpecArchivePlan,
  type ReviewRequestMergeStatus,
} from "./archive-contracts.js";

const MANDATORY_GATE_KINDS = new Set([
  "lint",
  "typecheck",
  "unit",
  "contract",
  "acceptance",
  "e2e",
  "visual",
  "accessibility",
  "performance",
  "security",
  "architecture",
  "build",
  "openspec",
]);

export async function createOpenSpecArchivePlan(input: {
  run: RunManifest;
  changeName: string;
  review: ReviewRequestMergeStatus;
  generatedAt: string;
}): Promise<OpenSpecArchivePlan> {
  const changeName = OpenSpecChangeNameSchema.parse(input.changeName);
  const paths = resolveOpenSpecChangePaths({
    projectRoot: input.run.projectRoot,
    changeName,
  });
  const openBlockerGaps = input.run.gaps.filter(isOpenBlockerGap);
  const failedGateChecks = input.run.agentResults.flatMap((result) =>
    result.checks.filter(
      (check) => MANDATORY_GATE_KINDS.has(check.kind) && check.status === "failed",
    ),
  );
  const knownGateChecks = input.run.agentResults.flatMap((result) =>
    result.checks.filter((check) => MANDATORY_GATE_KINDS.has(check.kind)),
  );
  const preconditions = [
    ArchivePreconditionSchema.parse({
      id: "review-request-merged",
      status: input.review.merged ? "passed" : "failed",
      summary: input.review.merged
        ? `Review request is merged at ${input.review.mergedAt}.`
        : "Review request is not merged.",
      blocking: true,
    }),
    ArchivePreconditionSchema.parse({
      id: "merged-commit-present",
      status: input.review.mergedCommitSha === undefined ? "failed" : "passed",
      summary:
        input.review.mergedCommitSha === undefined
          ? "Merged commit SHA is missing."
          : `Merged commit SHA: ${input.review.mergedCommitSha}.`,
      blocking: true,
    }),
    ArchivePreconditionSchema.parse({
      id: "change-folder-exists",
      status: (await exists(paths.changeRoot)) ? "passed" : "failed",
      summary: `OpenSpec change folder: ${toRepoRelativePath(input.run.projectRoot, paths.changeRoot)}`,
      blocking: true,
    }),
    ArchivePreconditionSchema.parse({
      id: "proposal-exists",
      status: (await exists(paths.proposalPath)) ? "passed" : "failed",
      summary: "proposal.md should exist.",
      blocking: true,
    }),
    ArchivePreconditionSchema.parse({
      id: "design-exists",
      status: (await exists(paths.designPath)) ? "passed" : "warning",
      summary: "design.md is recommended.",
      blocking: false,
    }),
    ArchivePreconditionSchema.parse({
      id: "tasks-exists",
      status: (await exists(paths.tasksPath)) ? "passed" : "warning",
      summary: "tasks.md is recommended and should show completion state.",
      blocking: false,
    }),
    ArchivePreconditionSchema.parse({
      id: "specs-exist",
      status: (await exists(paths.specsRoot)) ? "passed" : "failed",
      summary: "OpenSpec delta specs directory should exist.",
      blocking: true,
    }),
    ArchivePreconditionSchema.parse({
      id: "no-open-blocker-gaps",
      status: openBlockerGaps.length === 0 ? "passed" : "failed",
      summary:
        openBlockerGaps.length === 0
          ? "No open blocker gaps detected."
          : "Run still has open blocker gaps.",
      blocking: true,
      gapIds: openBlockerGaps.map((gap) => gap.id),
    }),
    ArchivePreconditionSchema.parse({
      id: "no-failed-mandatory-gates",
      status:
        failedGateChecks.length > 0
          ? "failed"
          : knownGateChecks.length === 0
            ? "warning"
            : "passed",
      summary:
        failedGateChecks.length > 0
          ? `Failed mandatory checks: ${failedGateChecks.map((check) => check.name).join(", ")}.`
          : knownGateChecks.length === 0
            ? "No mandatory gate check evidence was found in the Run."
            : "No failed mandatory gate checks detected.",
      blocking: failedGateChecks.length > 0,
    }),
  ];
  const canExecute = preconditions.every(
    (condition) => !(condition.blocking && condition.status === "failed"),
  );
  const expectedArchiveRoot = path.join(
    paths.changesRoot,
    "archive",
    `${input.generatedAt.slice(0, 10)}-${changeName}`,
  );

  return OpenSpecArchivePlanSchema.parse({
    runId: input.run.id,
    changeName,
    generatedAt: input.generatedAt,
    review: input.review,
    canExecute,
    preconditions,
    expectedChangeRoot: toRepoRelativePath(input.run.projectRoot, paths.changeRoot),
    expectedArchiveRoot: toRepoRelativePath(input.run.projectRoot, expectedArchiveRoot),
    command: ["openspec", "archive", changeName, "--yes"],
    requiresFollowUpCommit: true,
    notes: [
      "Archive should run only after PR/MR merge.",
      "If OpenSpec CLI is unavailable, record a failed archive result instead of manually moving files.",
      "Archive may create spec updates and move the change folder into archive.",
    ],
  });
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isOpenBlockerGap(gap: Gap): boolean {
  return gap.status === "open" && gap.severity === "blocker";
}

export function failedMandatoryChecks(run: RunManifest): CheckResult[] {
  return run.agentResults.flatMap((result) =>
    result.checks.filter(
      (check) => MANDATORY_GATE_KINDS.has(check.kind) && check.status === "failed",
    ),
  );
}
