import { z } from "zod";

import { RunManifestSchema } from "../run/index.js";
import type { RunManifest } from "../run/index.js";
import type { Gap } from "../runtime/gap.js";
import type { EvidenceRef } from "../runtime/source.js";
import { OpenSpecChangeModelSchema } from "./openspec-model.js";
import type { OpenSpecChangeModel, OpenSpecRequirementStatus } from "./openspec-model.js";
import {
  OpenSpecChangeNameSchema,
  OpenSpecSpecAreaSchema,
  toOpenSpecChangeName,
} from "./openspec-paths.js";

export const TraceabilityMatrixRowLikeSchema = z
  .object({
    requirementId: z.string().trim().min(1),
    title: z.string().trim().min(1).optional(),
    summary: z.string().trim().min(1),
    briefEvidenceIds: z.array(z.string()).default([]),
    figmaEvidenceIds: z.array(z.string()).default([]),
    openApiEvidenceIds: z.array(z.string()).default([]),
    gapIds: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
  })
  .strict();

export const TraceabilityMatrixLikeSchema = z
  .object({
    rows: z.array(TraceabilityMatrixRowLikeSchema),
    artifactIds: z.array(z.string()).default([]),
  })
  .strict();

export const EvidenceGraphMatrixRowSchema = z
  .object({
    requirementNodeId: z.string().trim().min(1),
    requirementLabel: z.string().trim().min(1),
    briefEvidenceIds: z.array(z.string()).default([]),
    apiNodeIds: z.array(z.string()).default([]),
    figmaNodeIds: z.array(z.string()).default([]),
    gapIds: z.array(z.string()).default([]),
    status: z.string().trim().min(1),
  })
  .strict();

export const EvidenceGraphMatrixSchema = z.array(EvidenceGraphMatrixRowSchema);

export type TraceabilityMatrixLike = z.infer<typeof TraceabilityMatrixLikeSchema>;

export function parseTraceabilityMatrixLike(rawMatrix: unknown): TraceabilityMatrixLike {
  const direct = TraceabilityMatrixLikeSchema.safeParse(rawMatrix);

  if (direct.success) {
    return direct.data;
  }

  const graphMatrix = EvidenceGraphMatrixSchema.parse(rawMatrix);

  return TraceabilityMatrixLikeSchema.parse({
    rows: graphMatrix.map((row, index) => ({
      requirementId: `REQ-${String(index + 1).padStart(3, "0")}`,
      title: row.requirementLabel,
      summary: row.requirementLabel,
      briefEvidenceIds: row.briefEvidenceIds,
      figmaEvidenceIds: [],
      openApiEvidenceIds: [],
      gapIds: row.gapIds,
      tags: [row.status],
    })),
    artifactIds: [],
  });
}

export function buildOpenSpecChangeModel(input: {
  run: RunManifest;
  matrix: unknown;
  changeName?: string;
  title?: string;
  summary?: string;
  generatedAt: string;
}): OpenSpecChangeModel {
  const run = RunManifestSchema.parse(input.run);
  const matrix = parseTraceabilityMatrixLike(input.matrix);

  const changeName = OpenSpecChangeNameSchema.parse(
    input.changeName === undefined
      ? inferChangeName(matrix)
      : toOpenSpecChangeName(input.changeName),
  );

  const requirements = matrix.rows
    .map((row) => {
      const briefEvidence = resolveEvidence(run.evidence, row.briefEvidenceIds);
      const figmaEvidence = resolveEvidence(run.evidence, row.figmaEvidenceIds);
      const openApiEvidence = resolveEvidence(run.evidence, row.openApiEvidenceIds);
      const gaps = resolveGaps(run.gaps, row.gapIds);

      const status = computeRequirementStatus({
        briefEvidence,
        figmaEvidence,
        openApiEvidence,
        gaps,
      });

      if (briefEvidence.length === 0) {
        return undefined;
      }

      const area = inferSpecArea(row, briefEvidence);

      return {
        id: row.requirementId,
        area,
        title: row.title ?? row.summary,
        summary: row.summary,
        status,
        briefEvidenceIds: briefEvidence.map((evidence) => evidence.id),
        figmaEvidenceIds: figmaEvidence.map((evidence) => evidence.id),
        openApiEvidenceIds: openApiEvidence.map((evidence) => evidence.id),
        gapIds: gaps.map((gap) => gap.id),
        tags: row.tags,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== undefined);

  const specAreas = [...new Set(requirements.map((requirement) => requirement.area))];

  return OpenSpecChangeModelSchema.parse({
    runId: run.id,
    changeName,
    title: input.title ?? titleFromChangeName(changeName),
    summary:
      input.summary ??
      `Evidence-backed OpenSpec change generated from ${requirements.length} requirement rows.`,
    generatedAt: input.generatedAt,
    sourceArtifactIds: matrix.artifactIds,
    requirements,
    gapIds: [...new Set(requirements.flatMap((requirement) => requirement.gapIds))],
    specAreas,
  });
}

function computeRequirementStatus(input: {
  briefEvidence: EvidenceRef[];
  figmaEvidence: EvidenceRef[];
  openApiEvidence: EvidenceRef[];
  gaps: Gap[];
}): OpenSpecRequirementStatus {
  if (input.gaps.some((gap) => gap.severity === "blocker")) {
    return "blocked";
  }

  if (input.gaps.length > 0) {
    return "partial";
  }

  if (input.briefEvidence.length === 0) {
    return "gap-only";
  }

  return "ready";
}

function resolveEvidence(evidence: EvidenceRef[], ids: string[]): EvidenceRef[] {
  const idSet = new Set(ids);

  return evidence.filter((item) => idSet.has(item.id));
}

function resolveGaps(gaps: Gap[], ids: string[]): Gap[] {
  const idSet = new Set(ids);

  return gaps.filter((item) => idSet.has(item.id));
}

function inferSpecArea(
  row: z.infer<typeof TraceabilityMatrixRowLikeSchema>,
  evidence: EvidenceRef[],
) {
  const text = `${row.title ?? ""} ${row.summary} ${evidence.map((item) => item.summary).join(" ")}`;

  if (/schedule|스케줄|일간|주간|slot|슬롯/i.test(text)) {
    return OpenSpecSpecAreaSchema.parse("reservation-schedule-management");
  }

  if (/reservation|예약/i.test(text)) {
    return OpenSpecSpecAreaSchema.parse("reservation-management");
  }

  return OpenSpecSpecAreaSchema.parse("product-change");
}

function inferChangeName(matrix: TraceabilityMatrixLike): string {
  const text = matrix.rows
    .slice(0, 5)
    .map((row) => `${row.title ?? ""} ${row.summary}`)
    .join(" ");

  if (/schedule|스케줄/i.test(text) && /reservation|예약/i.test(text)) {
    return "deliver-reservation-schedule-management";
  }

  if (/reservation|예약/i.test(text)) {
    return "deliver-reservation-management";
  }

  return "deliver-product-change";
}

function titleFromChangeName(changeName: string): string {
  return changeName
    .split("-")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}
