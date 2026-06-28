import type { RunManifest } from "../run/index.js";
import type { Gap } from "../runtime/gap.js";
import type { EvidenceRef } from "../runtime/source.js";
import type { OpenSpecChangeModel, OpenSpecRequirementModel } from "./openspec-model.js";

export type RenderedOpenSpecChange = {
  proposalMd: string;
  designMd: string;
  tasksMd: string;
  specs: Array<{
    area: string;
    content: string;
  }>;
  evidenceSummaryMd: string;
  traceabilityMatrixMd: string;
  gapSummaryMd: string;
  manifestJson: string;
};

export function renderOpenSpecChange(input: {
  model: OpenSpecChangeModel;
  run: RunManifest;
}): RenderedOpenSpecChange {
  const evidenceById = new Map(input.run.evidence.map((evidence) => [evidence.id, evidence]));
  const gapById = new Map(input.run.gaps.map((gap) => [gap.id, gap]));

  return {
    proposalMd: renderProposal(input.model, evidenceById, gapById),
    designMd: renderDesign(input.model, evidenceById, gapById),
    tasksMd: renderTasks(input.model),
    specs: input.model.specAreas.map((area) => ({
      area,
      content: renderSpec(
        area,
        input.model.requirements.filter((item) => item.area === area),
      ),
    })),
    evidenceSummaryMd: renderEvidenceSummary(input.model, evidenceById),
    traceabilityMatrixMd: renderTraceabilityMatrix(input.model),
    gapSummaryMd: renderGapSummary(input.model, gapById),
    manifestJson: `${JSON.stringify(input.model, null, 2)}\n`,
  };
}

function renderProposal(
  model: OpenSpecChangeModel,
  evidenceById: Map<string, EvidenceRef>,
  gapById: Map<string, Gap>,
): string {
  const readyCount = model.requirements.filter((item) => item.status === "ready").length;
  const partialCount = model.requirements.filter((item) => item.status === "partial").length;
  const blockedCount = model.requirements.filter((item) => item.status === "blocked").length;

  return markdown([
    `# ${model.title}`,
    "",
    "## Summary",
    "",
    model.summary,
    "",
    "## Change",
    "",
    `This change introduces ${model.requirements.length} evidence-backed requirement(s).`,
    "",
    "- Ready requirements: " + readyCount,
    "- Partial requirements: " + partialCount,
    "- Blocked requirements: " + blockedCount,
    "",
    "## Why",
    "",
    "This change is generated from collected product, Figma, and OpenAPI evidence. Each requirement below preserves links to its source Evidence IDs.",
    "",
    "## Scope",
    "",
    ...model.specAreas.map((area) => `- ${area}`),
    "",
    "## Requirement Evidence",
    "",
    ...model.requirements.flatMap((requirement) =>
      renderRequirementEvidenceBullets(requirement, evidenceById),
    ),
    "",
    "## Known Gaps",
    "",
    ...(model.gapIds.length === 0
      ? ["No known gaps were linked to this change."]
      : model.gapIds.map((gapId) => {
          const gap = gapById.get(gapId);
          return `- ${gapId}${gap === undefined ? "" : ` — ${gap.title} (${gap.severity})`}`;
        })),
    "",
  ]);
}

function renderDesign(
  model: OpenSpecChangeModel,
  evidenceById: Map<string, EvidenceRef>,
  gapById: Map<string, Gap>,
): string {
  return markdown([
    `# Design — ${model.title}`,
    "",
    "## Evidence Policy",
    "",
    "- Implementation must not add behavior that lacks product Evidence.",
    "- Missing API, Figma, or product details must remain as Gap entries.",
    "- UI work must use Figma Evidence when available.",
    "- API work must use OpenAPI Evidence when available.",
    "",
    "## Architecture Approach",
    "",
    "- Keep UI code inside the target project architecture boundaries.",
    "- API access should go through feature/entity wrappers instead of direct generated client imports from UI.",
    "- Generated or external contract code should not be manually edited.",
    "",
    "## Requirement Design Notes",
    "",
    ...model.requirements.flatMap((requirement) => [
      `### ${requirement.id} — ${requirement.title}`,
      "",
      `Status: ${requirement.status}`,
      "",
      requirement.summary,
      "",
      "Evidence:",
      ...renderEvidenceLines(requirement, evidenceById),
      "",
      "Gaps:",
      ...(requirement.gapIds.length === 0
        ? ["- None"]
        : requirement.gapIds.map((gapId) => {
            const gap = gapById.get(gapId);
            return `- ${gapId}${gap === undefined ? "" : ` — ${gap.title}`}`;
          })),
      "",
    ]),
  ]);
}

function renderTasks(model: OpenSpecChangeModel): string {
  return markdown([
    `# Tasks — ${model.title}`,
    "",
    "## 1. Specification",
    "",
    "- [ ] Review generated proposal/design/tasks/spec files.",
    "- [ ] Confirm all ready requirements have source evidence.",
    "- [ ] Confirm partial or blocked requirements have linked gaps.",
    "",
    "## 2. API",
    "",
    "- [ ] Use OpenAPI Evidence only for documented operations.",
    "- [ ] Do not invent missing endpoints.",
    "- [ ] Keep API gaps open until source documentation is updated.",
    "",
    "## 3. Design",
    "",
    "- [ ] Use Figma metadata/design context/screenshot/variables when available.",
    "- [ ] Do not invent unsupported Figma states without recording a design gap.",
    "",
    "## 4. Implementation",
    "",
    ...model.requirements.map(
      (requirement) => `- [ ] Implement ${requirement.id}: ${requirement.title}`,
    ),
    "",
    "## 5. Verification",
    "",
    "- [ ] Add or update unit/component/contract tests.",
    "- [ ] Run quality gates.",
    "- [ ] Record visual evidence where Figma screenshots exist.",
    "- [ ] Update gap statuses only with resolution artifacts.",
    "",
  ]);
}

function renderSpec(area: string, requirements: OpenSpecRequirementModel[]): string {
  return markdown([
    `# ${area}`,
    "",
    "## ADDED Requirements",
    "",
    ...(requirements.length === 0
      ? ["No requirements generated for this area."]
      : requirements.flatMap((requirement) => [
          `### Requirement: ${requirement.title}`,
          "",
          `The system SHALL ${toShallStatement(requirement.summary)}`,
          "",
          "#### Scenario: Evidence-backed behavior",
          "",
          `- **GIVEN** the relevant source evidence for ${requirement.id}`,
          "- **WHEN** the user performs the described workflow",
          "- **THEN** the system behavior must satisfy the requirement",
          "",
          `Traceability: ${requirement.id}`,
          "",
          `Evidence: ${
            [
              ...requirement.briefEvidenceIds,
              ...requirement.figmaEvidenceIds,
              ...requirement.openApiEvidenceIds,
            ].join(", ") || "none"
          }`,
          "",
          `Gaps: ${requirement.gapIds.join(", ") || "none"}`,
          "",
        ])),
  ]);
}

function renderEvidenceSummary(
  model: OpenSpecChangeModel,
  evidenceById: Map<string, EvidenceRef>,
): string {
  return markdown([
    `# Evidence Summary — ${model.title}`,
    "",
    "| Requirement | Brief Evidence | Figma Evidence | OpenAPI Evidence |",
    "|---|---|---|---|",
    ...model.requirements.map((requirement) =>
      [
        requirement.id,
        renderEvidenceCell(requirement.briefEvidenceIds, evidenceById),
        renderEvidenceCell(requirement.figmaEvidenceIds, evidenceById),
        renderEvidenceCell(requirement.openApiEvidenceIds, evidenceById),
      ].join(" | "),
    ),
    "",
  ]);
}

function renderTraceabilityMatrix(model: OpenSpecChangeModel): string {
  return markdown([
    `# Traceability Matrix — ${model.title}`,
    "",
    "| Requirement | Area | Status | Brief | Figma | OpenAPI | Gaps |",
    "|---|---|---|---|---|---|---|",
    ...model.requirements.map((requirement) =>
      [
        requirement.id,
        requirement.area,
        requirement.status,
        requirement.briefEvidenceIds.join("<br>") || "-",
        requirement.figmaEvidenceIds.join("<br>") || "-",
        requirement.openApiEvidenceIds.join("<br>") || "-",
        requirement.gapIds.join("<br>") || "-",
      ].join(" | "),
    ),
    "",
  ]);
}

function renderGapSummary(model: OpenSpecChangeModel, gapById: Map<string, Gap>): string {
  return markdown([
    `# Gap Summary — ${model.title}`,
    "",
    ...(model.gapIds.length === 0
      ? ["No gaps linked to this OpenSpec change.", ""]
      : [
          "| Gap | Category | Severity | Status | Title |",
          "|---|---|---|---|---|",
          ...model.gapIds.map((gapId) => {
            const gap = gapById.get(gapId);

            if (gap === undefined) {
              return `| ${gapId} | - | - | - | Missing gap object |`;
            }

            return `| ${gap.id} | ${gap.category} | ${gap.severity} | ${gap.status} | ${escapeTableCell(gap.title)} |`;
          }),
          "",
        ]),
  ]);
}

function renderRequirementEvidenceBullets(
  requirement: OpenSpecRequirementModel,
  evidenceById: Map<string, EvidenceRef>,
): string[] {
  return [
    `- ${requirement.id}: ${requirement.title}`,
    ...renderEvidenceLines(requirement, evidenceById).map((line) => `  ${line}`),
  ];
}

function renderEvidenceLines(
  requirement: OpenSpecRequirementModel,
  evidenceById: Map<string, EvidenceRef>,
): string[] {
  const ids = [
    ...requirement.briefEvidenceIds,
    ...requirement.figmaEvidenceIds,
    ...requirement.openApiEvidenceIds,
  ];

  if (ids.length === 0) {
    return ["- No evidence linked"];
  }

  return ids.map((id) => {
    const evidence = evidenceById.get(id);

    if (evidence === undefined) {
      return `- ${id}`;
    }

    return `- ${id}: ${evidence.summary}`;
  });
}

function renderEvidenceCell(ids: string[], evidenceById: Map<string, EvidenceRef>): string {
  if (ids.length === 0) {
    return "-";
  }

  return ids
    .map((id) => {
      const evidence = evidenceById.get(id);
      return evidence === undefined ? id : `${id}<br>${escapeTableCell(evidence.summary)}`;
    })
    .join("<br>");
}

function toShallStatement(summary: string): string {
  const normalized = summary.trim();

  if (
    /^(allow|provide|show|display|support|enable|validate|persist|fetch|update)\b/i.test(normalized)
  ) {
    return normalized;
  }

  return normalized.charAt(0).toLowerCase() + normalized.slice(1);
}

function markdown(lines: string[]): string {
  return `${lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}
