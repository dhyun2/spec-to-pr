import { GherkinBundleSchema } from "./gherkin-model.js";
import type {
  GherkinBundle,
  GherkinFeature,
  GherkinRule,
  GherkinScenario,
} from "./gherkin-model.js";
import { inferAutomationStatus, inferTestLayer, TestMatrixSchema } from "./test-matrix.js";
import type { TestAutomationStatus, TestLayer, TestMatrix, TestMatrixRow } from "./test-matrix.js";
import type { OpenSpecChangeModel, OpenSpecRequirementModel } from "../openspec/openspec-model.js";
import type { Gap } from "../runtime/gap.js";

export type GeneratedGherkinAndMatrix = {
  bundle: GherkinBundle;
  matrix: TestMatrix;
};

export function generateGherkinAndTestMatrix(input: {
  model: OpenSpecChangeModel;
  gaps: Gap[];
}): GeneratedGherkinAndMatrix {
  const gapById = new Map(input.gaps.map((gap) => [gap.id, gap]));

  const featureMap = new Map<string, GherkinFeature>();
  const matrixRows: TestMatrixRow[] = [];

  for (const requirement of input.model.requirements) {
    const requirementGaps = requirement.gapIds
      .map((gapId) => gapById.get(gapId))
      .filter((gap): gap is Gap => gap !== undefined);

    const hasBlockerGap = requirementGaps.some((gap) => gap.severity === "blocker");
    const hasGaps = requirementGaps.length > 0;

    const automation = inferAutomationStatus({
      requirementStatus: requirement.status,
      hasGaps,
      hasBlockerGap,
    });

    const layer = inferTestLayer({
      hasFigma: requirement.figmaEvidenceIds.length > 0,
      hasOpenApi: requirement.openApiEvidenceIds.length > 0,
      hasGaps,
      requirementText: `${requirement.title} ${requirement.summary}`,
    });

    const scenario = createScenario({
      requirement,
      automation,
      layer,
    });

    const feature = getOrCreateFeature(featureMap, requirement.area);
    const rule = getOrCreateRule(feature, requirement.title);

    if (automation !== "blocked") {
      rule.scenarios.push(scenario);
    }

    matrixRows.push({
      requirementId: requirement.id,
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      featureFile: featureFileName(requirement.area),
      area: requirement.area,
      layer,
      automation,
      status: requirement.status,
      reason: reasonFor(requirement, automation, layer, requirementGaps),
      briefEvidenceIds: requirement.briefEvidenceIds,
      figmaEvidenceIds: requirement.figmaEvidenceIds,
      openApiEvidenceIds: requirement.openApiEvidenceIds,
      gapIds: requirement.gapIds,
      sourceArtifactIds: input.model.sourceArtifactIds,
    });
  }

  const features = [...featureMap.values()].sort((left, right) =>
    left.area.localeCompare(right.area),
  );

  const bundle = GherkinBundleSchema.parse({
    changeName: input.model.changeName,
    generatedAt: input.model.generatedAt,
    features,
  });

  const matrix = TestMatrixSchema.parse({
    changeName: input.model.changeName,
    generatedAt: input.model.generatedAt,
    requirementCount: input.model.requirements.length,
    scenarioCount: matrixRows.length,
    automatedCandidateCount: matrixRows.filter((row) => row.automation === "automated-candidate")
      .length,
    blockedCount: matrixRows.filter((row) => row.automation === "blocked").length,
    reviewNeededCount: matrixRows.filter((row) => row.automation === "review-needed").length,
    rows: matrixRows,
  });

  return {
    bundle,
    matrix,
  };
}

function createScenario(input: {
  requirement: OpenSpecRequirementModel;
  automation: TestAutomationStatus;
  layer: TestLayer;
}): GherkinScenario {
  const { requirement } = input;

  const tags = [
    `@REQ:${sanitizeTagValue(requirement.id)}`,
    `@AREA:${sanitizeTagValue(requirement.area)}`,
    `@LAYER:${input.layer}`,
    `@AUTO:${input.automation}`,
    ...requirement.briefEvidenceIds.map((id) => `@BRIEF:${id}`),
    ...requirement.figmaEvidenceIds.map((id) => `@FIGMA:${id}`),
    ...requirement.openApiEvidenceIds.map((id) => `@API:${id}`),
    ...requirement.gapIds.map((id) => `@GAP:${id}`),
  ];

  const scenarioId = scenarioIdFor(requirement.id);

  return {
    id: scenarioId,
    name: `${requirement.id} ${requirement.title}`,
    requirementId: requirement.id,
    status: input.automation,
    tags,
    briefEvidenceIds: requirement.briefEvidenceIds,
    figmaEvidenceIds: requirement.figmaEvidenceIds,
    openApiEvidenceIds: requirement.openApiEvidenceIds,
    gapIds: requirement.gapIds,
    steps: [
      {
        keyword: "Given",
        text: `the "${requirement.area}" capability is available`,
      },
      {
        keyword: "And",
        text: `requirement evidence "${requirement.id}" is available`,
      },
      {
        keyword: "When",
        text: `the user performs the "${humanizeRequirement(requirement.title)}" workflow`,
      },
      {
        keyword: "Then",
        text: `the system satisfies "${requirement.id}"`,
      },
      {
        keyword: "And",
        text: "verification evidence must be recorded",
      },
    ],
  };
}

function getOrCreateFeature(featureMap: Map<string, GherkinFeature>, area: string): GherkinFeature {
  const existing = featureMap.get(area);

  if (existing !== undefined) {
    return existing;
  }

  const feature: GherkinFeature = {
    area,
    name: titleFromArea(area),
    description: `Generated feature scenarios for ${area}.`,
    tags: [`@AREA:${sanitizeTagValue(area)}`],
    rules: [],
  };

  featureMap.set(area, feature);

  return feature;
}

function getOrCreateRule(feature: GherkinFeature, ruleName: string): GherkinRule {
  const existing = feature.rules.find((rule) => rule.name === ruleName);

  if (existing !== undefined) {
    return existing;
  }

  const rule: GherkinRule = {
    name: ruleName,
    scenarios: [],
  };

  feature.rules.push(rule);

  return rule;
}

function scenarioIdFor(requirementId: string): string {
  return `SCN-${requirementId.replace(/[^A-Za-z0-9]+/g, "-")}-001`;
}

function featureFileName(area: string): string {
  return `${area}.feature`;
}

function titleFromArea(area: string): string {
  return area
    .split("-")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function humanizeRequirement(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function reasonFor(
  requirement: OpenSpecRequirementModel,
  automation: TestAutomationStatus,
  layer: TestLayer,
  gaps: Gap[],
): string {
  if (automation === "blocked") {
    return `Blocked by ${gaps.length} gap(s).`;
  }

  if (automation === "review-needed") {
    return `Review needed because requirement status is ${requirement.status} or linked gaps exist.`;
  }

  return `Assigned to ${layer} layer from available Figma/OpenAPI evidence.`;
}

function sanitizeTagValue(value: string): string {
  return value.replace(/[^A-Za-z0-9_:.~-]/g, "-");
}
