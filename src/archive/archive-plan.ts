import { access } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  OpenSpecChangeNameSchema,
  resolveOpenSpecChangePaths,
} from "../openspec/openspec-paths.js";
import type { RunManifest } from "../run/index.js";
import { ArtifactIdSchema, GapIdSchema, RunIdSchema } from "../runtime/ids.js";
import type { ArtifactRef } from "../runtime/index.js";
import type { MergeEvidence } from "./merge-evidence.js";

export const OpenSpecArchivePlanStatusSchema = z.enum(["needs-merge-evidence", "blocked", "ready"]);

export const OpenSpecArchivePlanSchema = z
  .object({
    runId: RunIdSchema,
    changeName: OpenSpecChangeNameSchema,
    status: OpenSpecArchivePlanStatusSchema,
    reviewRequestUrl: z.string().url().optional(),
    mergeEvidenceId: ArtifactIdSchema.optional(),
    archiveCommand: z.string().trim().min(1),
    executeAllowed: z.boolean(),
    polling: z.literal(false),
    blockingGapIds: z.array(GapIdSchema).default([]),
    blockingReasons: z.array(z.string().trim().min(1)).default([]),
    expectedChangeRoot: z.string().trim().min(1),
    expectedArchiveRoot: z.string().trim().min(1),
    followUpCommitRequired: z.boolean(),
  })
  .strict();

export type OpenSpecArchivePlanStatus = z.infer<typeof OpenSpecArchivePlanStatusSchema>;
export type OpenSpecArchivePlan = z.infer<typeof OpenSpecArchivePlanSchema>;

export async function createOpenSpecArchivePlan(input: {
  run: RunManifest;
  changeName: string;
  publishResultUrl?: string;
  mergeEvidence?: MergeEvidence;
  generatedAt: string;
}): Promise<OpenSpecArchivePlan> {
  const changeName = OpenSpecChangeNameSchema.parse(input.changeName);
  const paths = resolveOpenSpecChangePaths({
    projectRoot: input.run.projectRoot,
    changeName,
  });
  const expectedChangeRoot = repoRelative(input.run.projectRoot, paths.changeRoot);
  const expectedArchiveRoot = repoRelative(
    input.run.projectRoot,
    path.join(paths.changesRoot, "archive", `${input.generatedAt.slice(0, 10)}-${changeName}`),
  );
  const blockingReasons: string[] = [];
  const blockingGapIds = input.run.gaps
    .filter((gap) => gap.status === "open" && gap.severity === "blocker")
    .map((gap) => gap.id);

  if (input.publishResultUrl === undefined) {
    blockingReasons.push("No Task 31 publish result artifact with PR/MR URL found.");
  }

  if (input.mergeEvidence === undefined) {
    blockingReasons.push("No merge evidence found.");
  } else {
    if (input.mergeEvidence.status !== "merged") {
      blockingReasons.push(`Merge evidence status is ${input.mergeEvidence.status}.`);
    }

    if (
      input.publishResultUrl !== undefined &&
      input.mergeEvidence.reviewRequestUrl !== input.publishResultUrl
    ) {
      blockingReasons.push("Merge evidence URL does not match Task 31 publish result URL.");
    }
  }

  if (!(await exists(paths.changeRoot))) {
    blockingReasons.push(`OpenSpec change folder does not exist: ${expectedChangeRoot}.`);
  }

  if (!(await exists(paths.proposalPath))) {
    blockingReasons.push("OpenSpec proposal.md does not exist.");
  }

  if (!(await exists(paths.specsRoot))) {
    blockingReasons.push("OpenSpec delta specs directory does not exist.");
  }

  if (blockingGapIds.length > 0) {
    blockingReasons.push("Run still has open blocker gaps.");
  }

  const status =
    input.mergeEvidence === undefined
      ? "needs-merge-evidence"
      : blockingReasons.length === 0
        ? "ready"
        : "blocked";

  return OpenSpecArchivePlanSchema.parse({
    runId: input.run.id,
    changeName,
    status,
    ...(input.publishResultUrl === undefined ? {} : { reviewRequestUrl: input.publishResultUrl }),
    ...(input.mergeEvidence === undefined ? {} : { mergeEvidenceId: input.mergeEvidence.id }),
    archiveCommand: `openspec archive ${changeName} --yes`,
    executeAllowed: status === "ready",
    polling: false,
    blockingGapIds,
    blockingReasons,
    expectedChangeRoot,
    expectedArchiveRoot,
    followUpCommitRequired: true,
  });
}

export function latestArtifactByReportKind(
  artifacts: ArtifactRef[],
  kind: string,
  reportKind: string,
): ArtifactRef | undefined {
  return artifacts
    .filter((artifact) => artifact.kind === kind && artifact.metadata["reportKind"] === reportKind)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function repoRelative(projectRoot: string, filePath: string): string {
  return path.relative(projectRoot, filePath).split(path.sep).join("/");
}
