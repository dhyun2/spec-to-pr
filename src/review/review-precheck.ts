import { randomUUID } from "node:crypto";

import type { RunManifest } from "../run/index.js";
import type { Gap } from "../runtime/gap.js";
import type { ReviewFinding } from "./review-model.js";
import { ReviewFindingSchema } from "./review-model.js";

export function runReviewPrechecks(input: {
  run: RunManifest;
  generatedAt: string;
}): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  findings.push(...findOpenBlockerGaps(input));
  findings.push(...findPassedAgentResultsWithOpenGaps(input));
  findings.push(...findImplementationResultsWithoutArtifacts(input));
  findings.push(...findApiClaimsWithoutOpenApiEvidence(input));
  findings.push(...findDesignClaimsWithoutFigmaEvidence(input));

  return findings;
}

function findOpenBlockerGaps(input: { run: RunManifest; generatedAt: string }): ReviewFinding[] {
  return input.run.gaps
    .filter((gap) => gap.status === "open" && gap.severity === "blocker")
    .map((gap) =>
      ReviewFindingSchema.parse({
        id: createReviewFindingId(),
        category: "gap-policy",
        severity: "blocker",
        status: "open",
        title: `Open blocker gap: ${gap.title}`,
        expected: "No open blocker gaps should remain before implementation is accepted.",
        observed: gap.observed,
        recommendation: "Resolve the blocker with resolution artifacts or keep the requirement blocked.",
        gapIds: [gap.id],
        evidenceIds: gap.sourceEvidenceIds,
        createdAt: input.generatedAt,
      }),
    );
}

function findPassedAgentResultsWithOpenGaps(input: {
  run: RunManifest;
  generatedAt: string;
}): ReviewFinding[] {
  return input.run.agentResults.flatMap((result) => {
    if (result.status !== "passed") {
      return [];
    }

    const openGaps = result.gapIds
      .map((gapId) => input.run.gaps.find((gap) => gap.id === gapId))
      .filter((gap): gap is Gap => gap !== undefined && gap.status === "open");

    if (openGaps.length === 0) {
      return [];
    }

    return [
      ReviewFindingSchema.parse({
        id: createReviewFindingId(),
        category: "implementation-claim",
        severity: "major",
        status: "open",
        title: "Passed AgentResult references open gaps",
        expected: "A passed agent result should not cite unresolved gaps as if work is complete.",
        observed: `Agent ${result.agent} passed while referencing ${openGaps.length} open gap(s).`,
        recommendation: "Change result to partial/blocked or resolve gaps with evidence.",
        agentResultIds: [result.id],
        gapIds: openGaps.map((gap) => gap.id),
        createdAt: input.generatedAt,
      }),
    ];
  });
}

function findImplementationResultsWithoutArtifacts(input: {
  run: RunManifest;
  generatedAt: string;
}): ReviewFinding[] {
  return input.run.agentResults.flatMap((result) => {
    if (result.kind !== "implementation" || result.status !== "passed") {
      return [];
    }

    if (result.artifactIds.length > 0 || result.checks.length > 0) {
      return [];
    }

    return [
      ReviewFindingSchema.parse({
        id: createReviewFindingId(),
        category: "implementation-claim",
        severity: "major",
        status: "open",
        title: "Implementation result has no artifacts or checks",
        expected: "Passed implementation results should cite artifacts or checks.",
        observed: `Agent ${result.agent} passed without artifacts or checks.`,
        recommendation: "Attach test report, source artifact, or check result evidence.",
        agentResultIds: [result.id],
        createdAt: input.generatedAt,
      }),
    ];
  });
}

function findApiClaimsWithoutOpenApiEvidence(input: {
  run: RunManifest;
  generatedAt: string;
}): ReviewFinding[] {
  return input.run.agentResults.flatMap((result) => {
    if (result.agent !== "api-contract" || result.status !== "passed") {
      return [];
    }

    const hasOpenApiEvidence = result.evidenceIds.some((evidenceId) => {
      const evidence = input.run.evidence.find((item) => item.id === evidenceId);
      return evidence?.metadata["openapiEvidenceKind"] !== undefined;
    });

    if (hasOpenApiEvidence) {
      return [];
    }

    return [
      ReviewFindingSchema.parse({
        id: createReviewFindingId(),
        category: "api-contract",
        severity: "major",
        status: "open",
        title: "API Contract result lacks OpenAPI evidence",
        expected: "API Contract Agent results should cite OpenAPI operation/schema/security evidence.",
        observed: "No OpenAPI evidence IDs were attached to the passed API Contract result.",
        recommendation: "Attach OpenAPI intake evidence or keep undocumented work as API gap.",
        agentResultIds: [result.id],
        evidenceIds: result.evidenceIds,
        artifactIds: result.artifactIds,
        createdAt: input.generatedAt,
      }),
    ];
  });
}

function findDesignClaimsWithoutFigmaEvidence(input: {
  run: RunManifest;
  generatedAt: string;
}): ReviewFinding[] {
  return input.run.agentResults.flatMap((result) => {
    if (result.agent !== "design-ui" || result.status !== "passed") {
      return [];
    }

    const hasFigmaEvidence = result.evidenceIds.some((evidenceId) => {
      const evidence = input.run.evidence.find((item) => item.id === evidenceId);
      return evidence?.location.type === "figma-node";
    });

    if (hasFigmaEvidence) {
      return [];
    }

    return [
      ReviewFindingSchema.parse({
        id: createReviewFindingId(),
        category: "design-contract",
        severity: "major",
        status: "open",
        title: "Design/UI result lacks Figma evidence",
        expected: "Design/UI Agent results should cite Figma node evidence or design contract artifacts.",
        observed: "No Figma evidence IDs were attached to the passed Design/UI result.",
        recommendation: "Attach Figma evidence or keep unsupported UI states as design gaps.",
        agentResultIds: [result.id],
        evidenceIds: result.evidenceIds,
        artifactIds: result.artifactIds,
        createdAt: input.generatedAt,
      }),
    ];
  });
}

export function createReviewFindingId(): string {
  return `rf_${randomUUID().replaceAll("-", "")}`;
}
