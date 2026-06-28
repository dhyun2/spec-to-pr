import path from "node:path";

import { z } from "zod";

export const OpenSpecChangeNameSchema = z
  .string()
  .trim()
  .min(3)
  .max(120)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Expected kebab-case change name such as deliver-reservation-management",
  );

export const OpenSpecSpecAreaSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Expected kebab-case spec area such as reservation-management",
  );

export type OpenSpecChangeName = z.infer<typeof OpenSpecChangeNameSchema>;
export type OpenSpecSpecArea = z.infer<typeof OpenSpecSpecAreaSchema>;

export type OpenSpecChangePaths = {
  openspecRoot: string;
  changesRoot: string;
  changeRoot: string;
  proposalPath: string;
  designPath: string;
  tasksPath: string;
  specsRoot: string;
  artifactsRoot: string;
  evidenceSummaryPath: string;
  traceabilityMatrixPath: string;
  gapSummaryPath: string;
  manifestPath: string;
};

export function toOpenSpecChangeName(input: string): OpenSpecChangeName {
  const normalized = input
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return OpenSpecChangeNameSchema.parse(normalized);
}

export function resolveOpenSpecChangePaths(input: {
  projectRoot: string;
  changeName: OpenSpecChangeName;
}): OpenSpecChangePaths {
  const openspecRoot = path.join(input.projectRoot, "openspec");
  const changesRoot = path.join(openspecRoot, "changes");
  const changeRoot = path.join(changesRoot, input.changeName);
  const specsRoot = path.join(changeRoot, "specs");
  const artifactsRoot = path.join(changeRoot, "artifacts");

  return {
    openspecRoot,
    changesRoot,
    changeRoot,
    proposalPath: path.join(changeRoot, "proposal.md"),
    designPath: path.join(changeRoot, "design.md"),
    tasksPath: path.join(changeRoot, "tasks.md"),
    specsRoot,
    artifactsRoot,
    evidenceSummaryPath: path.join(artifactsRoot, "evidence-summary.md"),
    traceabilityMatrixPath: path.join(artifactsRoot, "traceability-matrix.md"),
    gapSummaryPath: path.join(artifactsRoot, "gap-summary.md"),
    manifestPath: path.join(artifactsRoot, "change-manifest.json"),
  };
}

export function specFilePath(input: { specsRoot: string; area: OpenSpecSpecArea }): string {
  return path.join(input.specsRoot, input.area, "spec.md");
}

export function toRepoRelativePath(projectRoot: string, absolutePath: string): string {
  return path.relative(projectRoot, absolutePath).split(path.sep).join("/");
}
