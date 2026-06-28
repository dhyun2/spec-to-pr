import { z } from "zod";

import { GapSchema } from "../runtime/gap.js";
import type { Gap } from "../runtime/gap.js";
import { createGapId } from "../runtime/id-factory.js";
import type { EvidenceRef } from "../runtime/source.js";
import {
  AssetMappingSchema,
  ComponentMappingSchema,
  FigmaDesignContractSchema,
  TokenMappingSchema,
  TypographyMappingSchema,
} from "./design-contract-model.js";
import type {
  AssetMapping,
  ComponentMapping,
  FigmaDesignContract,
  TokenMapping,
  TypographyMapping,
} from "./design-contract-model.js";
import type { ProjectDesignSystemInventory } from "./project-design-system-scanner.js";

export const FigmaInventoryLikeSchema = z
  .object({
    components: z.array(z.record(z.string(), z.unknown())).default([]),
    variables: z.array(z.record(z.string(), z.unknown())).default([]),
    tokens: z.array(z.record(z.string(), z.unknown())).default([]),
    textStyles: z.array(z.record(z.string(), z.unknown())).default([]),
    assets: z.array(z.record(z.string(), z.unknown())).default([]),
    artifactIds: z.array(z.string()).default([]),
    sourceArtifactIds: z.array(z.string()).default([]),
  })
  .passthrough();

export type FigmaInventoryLike = z.infer<typeof FigmaInventoryLikeSchema>;

export function buildFigmaDesignContract(input: {
  runId: string;
  changeName: string;
  generatedAt: string;
  figmaInventory: unknown;
  projectDesignSystem: ProjectDesignSystemInventory;
  evidence: EvidenceRef[];
}): {
  contract: FigmaDesignContract;
  gaps: Gap[];
} {
  const inventory = FigmaInventoryLikeSchema.parse(input.figmaInventory);
  const gaps: Gap[] = [];
  const variables = [...inventory.variables, ...inventory.tokens];

  const componentMappings = inventory.components.map((component) =>
    mapComponent({
      component,
      projectDesignSystem: input.projectDesignSystem,
      evidence: input.evidence,
      gaps,
      generatedAt: input.generatedAt,
    }),
  );

  const tokenMappings = variables.map((variable) =>
    mapToken({
      variable,
      projectDesignSystem: input.projectDesignSystem,
      evidence: input.evidence,
      gaps,
      generatedAt: input.generatedAt,
    }),
  );

  const typographyMappings = inventory.textStyles.map((textStyle) =>
    mapTypography({
      textStyle,
      projectDesignSystem: input.projectDesignSystem,
      evidence: input.evidence,
      gaps,
      generatedAt: input.generatedAt,
    }),
  );

  const assetMappings = inventory.assets.map((asset) =>
    mapAsset({
      asset,
      projectDesignSystem: input.projectDesignSystem,
      evidence: input.evidence,
      gaps,
      generatedAt: input.generatedAt,
    }),
  );

  const blockerGaps = gaps.filter((gap) => gap.severity === "blocker").length;
  const majorGaps = gaps.filter((gap) => gap.severity === "major").length;
  const sourceArtifactIds =
    inventory.sourceArtifactIds.length === 0 ? inventory.artifactIds : inventory.sourceArtifactIds;

  const contract = FigmaDesignContractSchema.parse({
    schemaVersion: "figma-design-contract-v1",
    runId: input.runId,
    changeName: input.changeName,
    generatedAt: input.generatedAt,
    sourceArtifactIds,
    componentMappings,
    tokenMappings,
    typographyMappings,
    assetMappings,
    gapIds: gaps.map((gap) => gap.id),
    gapSummary: {
      unmappedComponents: componentMappings.filter((mapping) => mapping.confidence === "missing")
        .length,
      unmappedTokens: tokenMappings.filter((mapping) => mapping.confidence === "missing").length,
      unmappedTypography: typographyMappings.filter((mapping) => mapping.confidence === "missing")
        .length,
      unmappedAssets: assetMappings.filter((mapping) => mapping.confidence === "missing").length,
      blockerGaps,
      majorGaps,
    },
  });

  return { contract, gaps };
}

function mapComponent(input: {
  component: Record<string, unknown>;
  projectDesignSystem: ProjectDesignSystemInventory;
  evidence: EvidenceRef[];
  gaps: Gap[];
  generatedAt: string;
}): ComponentMapping {
  const figmaName = readName(input.component);
  const figmaNodeId = readNodeId(input.component);
  const figmaType = readString(input.component, "type");
  const codeConnect = readRecord(input.component, "codeConnect");
  const codeConnectComponent =
    readString(codeConnect, "component") ?? readString(input.component, "codeConnectComponent");
  const codeConnectImportPath =
    readString(codeConnect, "importPath") ?? readString(input.component, "codeConnectSource");

  if (codeConnectComponent !== undefined) {
    return ComponentMappingSchema.parse({
      figmaNodeId,
      figmaName,
      ...(figmaType === undefined ? {} : { figmaType }),
      codeComponent: codeConnectComponent,
      ...(codeConnectImportPath === undefined ? {} : { importPath: codeConnectImportPath }),
      propsHint: readRecord(codeConnect, "props"),
      source: "code-connect",
      confidence: "high",
      evidenceIds: evidenceForNode(input.evidence, figmaNodeId),
      gapIds: [],
    });
  }

  const normalizedFigmaName = normalizeName(figmaName);
  const candidate = input.projectDesignSystem.components.find((component) => {
    const normalizedComponent = normalizeName(component.name);

    return (
      normalizedComponent === normalizedFigmaName ||
      normalizedFigmaName.includes(normalizedComponent) ||
      normalizedComponent.includes(normalizedFigmaName)
    );
  });

  if (candidate !== undefined) {
    return ComponentMappingSchema.parse({
      figmaNodeId,
      figmaName,
      ...(figmaType === undefined ? {} : { figmaType }),
      codeComponent: candidate.name,
      importPath: candidate.importPath,
      propsHint: {},
      source: "name-match",
      confidence: "medium",
      evidenceIds: evidenceForNode(input.evidence, figmaNodeId),
      gapIds: [],
    });
  }

  const gap = createDesignGap({
    title: `Unmapped Figma component: ${figmaName}`,
    expected:
      "Every reusable Figma component should map to an existing code component or an approved new component plan.",
    observed: `No code component mapping was found for Figma node ${figmaNodeId} (${figmaName}).`,
    impact:
      "UI Agent may create duplicate UI or hard-code layout instead of using the design system.",
    evidenceIds: evidenceForNode(input.evidence, figmaNodeId),
    severity: "major",
    generatedAt: input.generatedAt,
  });

  input.gaps.push(gap);

  return ComponentMappingSchema.parse({
    figmaNodeId,
    figmaName,
    ...(figmaType === undefined ? {} : { figmaType }),
    source: "missing",
    confidence: "missing",
    evidenceIds: evidenceForNode(input.evidence, figmaNodeId),
    gapIds: [gap.id],
  });
}

function mapToken(input: {
  variable: Record<string, unknown>;
  projectDesignSystem: ProjectDesignSystemInventory;
  evidence: EvidenceRef[];
  gaps: Gap[];
  generatedAt: string;
}): TokenMapping {
  const figmaVariable = readName(input.variable);
  const figmaValue = readString(input.variable, "value");
  const category = inferTokenCategory(figmaVariable, readString(input.variable, "kind"));
  const normalizedVariable = normalizeName(figmaVariable);

  const candidate = input.projectDesignSystem.tokens.find((token) => {
    const normalizedToken = normalizeName(token.name);

    return (
      normalizedToken === normalizedVariable ||
      normalizedToken.includes(normalizedVariable) ||
      normalizedVariable.includes(normalizedToken)
    );
  });

  if (candidate !== undefined) {
    return TokenMappingSchema.parse({
      figmaVariable,
      ...(figmaValue === undefined ? {} : { figmaValue }),
      ...(candidate.kind === "token-export" ? { tokenName: candidate.name } : {}),
      ...(candidate.kind === "css-variable" ? { cssVariable: candidate.name } : {}),
      ...(candidate.kind === "class-name" ? { className: candidate.name } : {}),
      category,
      source: "token-match",
      confidence: "medium",
      evidenceIds: [],
      gapIds: [],
    });
  }

  const gap = createDesignGap({
    title: `Unmapped Figma variable: ${figmaVariable}`,
    expected: "Figma variables should map to existing code tokens or classes.",
    observed: `No token mapping was found for ${figmaVariable}.`,
    impact: "UI Agent may hard-code visual values instead of using semantic tokens.",
    evidenceIds: [],
    severity: "major",
    generatedAt: input.generatedAt,
  });

  input.gaps.push(gap);

  return TokenMappingSchema.parse({
    figmaVariable,
    ...(figmaValue === undefined ? {} : { figmaValue }),
    category,
    source: "missing",
    confidence: "missing",
    evidenceIds: [],
    gapIds: [gap.id],
  });
}

function mapTypography(input: {
  textStyle: Record<string, unknown>;
  projectDesignSystem: ProjectDesignSystemInventory;
  evidence: EvidenceRef[];
  gaps: Gap[];
  generatedAt: string;
}): TypographyMapping {
  const figmaTextStyle = readName(input.textStyle);

  const candidate = input.projectDesignSystem.tokens.find((token) => {
    const normalized = normalizeName(token.name);
    const style = normalizeName(figmaTextStyle);

    return normalized.includes(style) || style.includes(normalized);
  });

  if (candidate !== undefined) {
    return TypographyMappingSchema.parse({
      figmaTextStyle,
      ...(candidate.kind === "class-name" ? { codeClassName: candidate.name } : {}),
      ...(candidate.kind === "token-export" ? { tokenName: candidate.name } : {}),
      ...optionalString(input.textStyle, "fontFamily"),
      ...optionalString(input.textStyle, "fontSize"),
      ...optionalString(input.textStyle, "lineHeight"),
      source: "token-match",
      confidence: "medium",
      evidenceIds: [],
      gapIds: [],
    });
  }

  const gap = createDesignGap({
    title: `Unmapped Figma text style: ${figmaTextStyle}`,
    expected: "Figma text styles should map to existing typography classes or tokens.",
    observed: `No typography mapping was found for ${figmaTextStyle}.`,
    impact: "UI Agent may use arbitrary font sizes or line heights.",
    evidenceIds: [],
    severity: "minor",
    generatedAt: input.generatedAt,
  });

  input.gaps.push(gap);

  return TypographyMappingSchema.parse({
    figmaTextStyle,
    ...optionalString(input.textStyle, "fontFamily"),
    ...optionalString(input.textStyle, "fontSize"),
    ...optionalString(input.textStyle, "lineHeight"),
    source: "missing",
    confidence: "missing",
    evidenceIds: [],
    gapIds: [gap.id],
  });
}

function mapAsset(input: {
  asset: Record<string, unknown>;
  projectDesignSystem: ProjectDesignSystemInventory;
  evidence: EvidenceRef[];
  gaps: Gap[];
  generatedAt: string;
}): AssetMapping {
  const figmaName = readName(input.asset);
  const figmaNodeId = readNodeId(input.asset);
  const assetType = inferAssetType(figmaName, readString(input.asset, "type"));

  const componentCandidate = input.projectDesignSystem.components.find((component) => {
    const normalizedComponent = normalizeName(component.name);
    const normalizedAsset = normalizeName(figmaName);

    return normalizedComponent.includes(normalizedAsset) || normalizedAsset.includes(normalizedComponent);
  });

  if (componentCandidate !== undefined) {
    return AssetMappingSchema.parse({
      figmaNodeId,
      figmaName,
      assetType,
      codeComponent: componentCandidate.name,
      exportRequired: false,
      source: "name-match",
      confidence: "medium",
      evidenceIds: evidenceForNode(input.evidence, figmaNodeId),
      gapIds: [],
    });
  }

  const gap = createDesignGap({
    title: `Unmapped Figma asset: ${figmaName}`,
    expected: "Figma vector/image assets should map to existing icon components or exported asset files.",
    observed: `No asset mapping was found for Figma node ${figmaNodeId} (${figmaName}).`,
    impact: "UI Agent may recreate the asset incorrectly or omit it.",
    evidenceIds: evidenceForNode(input.evidence, figmaNodeId),
    severity: "minor",
    generatedAt: input.generatedAt,
  });

  input.gaps.push(gap);

  return AssetMappingSchema.parse({
    figmaNodeId,
    figmaName,
    assetType,
    exportRequired: true,
    source: "missing",
    confidence: "missing",
    evidenceIds: evidenceForNode(input.evidence, figmaNodeId),
    gapIds: [gap.id],
  });
}

function createDesignGap(input: {
  title: string;
  expected: string;
  observed: string;
  impact: string;
  evidenceIds: string[];
  severity: "blocker" | "major" | "minor" | "info";
  generatedAt: string;
}): Gap {
  return GapSchema.parse({
    id: createGapId(),
    category: "design",
    severity: input.severity,
    status: "open",
    title: input.title,
    expected: input.expected,
    observed: input.observed,
    impact: input.impact,
    sourceEvidenceIds: input.evidenceIds,
    owner: "design-ui",
    createdAt: input.generatedAt,
    updatedAt: input.generatedAt,
    metadata: {
      adapter: "figma-design-contract-v1",
    },
  });
}

function evidenceForNode(evidence: EvidenceRef[], nodeId: string): string[] {
  return evidence
    .filter((item) => item.location.type === "figma-node" && item.location.nodeId === nodeId)
    .map((item) => item.id);
}

function readName(value: Record<string, unknown>): string {
  return readString(value, "name") ?? readString(value, "figmaName") ?? "Unnamed";
}

function readNodeId(value: Record<string, unknown>): string {
  return readString(value, "nodeId") ?? readString(value, "figmaNodeId") ?? "0:0";
}

function readString(value: Record<string, unknown>, key: string): string | undefined {
  const raw = value[key];

  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw;
  }

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return String(raw);
  }

  return undefined;
}

function readRecord(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const raw = value[key];

  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function optionalString(value: Record<string, unknown>, key: string): Record<string, string> {
  const parsed = readString(value, key);

  return parsed === undefined ? {} : { [key]: parsed };
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "")
    .trim();
}

function inferTokenCategory(
  value: string,
  rawKind?: string,
): "color" | "spacing" | "radius" | "shadow" | "typography" | "unknown" {
  const lower = `${value} ${rawKind ?? ""}`.toLowerCase();

  if (/color|fill|paint|색/.test(lower)) {
    return "color";
  }

  if (/space|spacing|gap|padding|margin/.test(lower)) {
    return "spacing";
  }

  if (/radius|corner/.test(lower)) {
    return "radius";
  }

  if (/shadow|effect/.test(lower)) {
    return "shadow";
  }

  if (/font|type|text|typography|타이포/.test(lower)) {
    return "typography";
  }

  return "unknown";
}

function inferAssetType(
  name: string,
  type?: string,
): "icon" | "image" | "vector" | "illustration" | "unknown" {
  const lower = `${name} ${type ?? ""}`.toLowerCase();

  if (/icon|ico|아이콘/.test(lower)) {
    return "icon";
  }

  if (/image|img|png|jpg|jpeg/.test(lower)) {
    return "image";
  }

  if (/vector|svg/.test(lower)) {
    return "vector";
  }

  if (/illustration|일러스트/.test(lower)) {
    return "illustration";
  }

  return "unknown";
}
