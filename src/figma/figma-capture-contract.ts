import { createHash } from "node:crypto";

import { z } from "zod";

import { Sha256DigestSchema } from "../runtime/scalars.js";

export const VisualSizeSchema = z
  .object({
    width: z.number().int().positive().max(10_000),
    height: z.number().int().positive().max(10_000),
  })
  .strict();

export const FigmaCaptureGeometryV1Schema = z
  .object({
    nodeId: z.string().trim().min(1).max(500),
    captureKind: z.enum(["viewport", "full-frame"]),
    logicalSize: VisualSizeSchema,
    exportScale: z.number().positive().max(8),
    bitmapSize: VisualSizeSchema,
    colorSpace: z.literal("srgb"),
  })
  .strict();

export const FigmaCaptureGeometryV2Schema = z
  .object({
    schemaVersion: z.literal("figma-capture-geometry-v2"),
    provider: z.literal("host-connected-figma-native-export"),
    nodeId: z.string().trim().min(1).max(500),
    state: z.string().trim().min(1).max(200),
    captureKind: z.enum(["viewport", "full-frame"]),
    logicalSize: VisualSizeSchema,
    exportScale: z.number().min(1).max(8),
    bitmapSize: VisualSizeSchema,
    colorSpace: z.literal("srgb"),
  })
  .strict();

export const FigmaCaptureGeometrySchema = z.union([
  FigmaCaptureGeometryV2Schema,
  FigmaCaptureGeometryV1Schema,
]);

export type VisualSize = z.infer<typeof VisualSizeSchema>;
export type FigmaCaptureGeometry = z.infer<typeof FigmaCaptureGeometrySchema>;
export type FigmaCaptureGeometryV2 = z.infer<typeof FigmaCaptureGeometryV2Schema>;

export type ValidatedFigmaGeometry = {
  scaleX: number;
  scaleY: number;
  aspectRatioDelta: number;
};

export const FigmaStateFactSchema = z
  .object({
    id: z.string().trim().min(1),
    kind: z.enum([
      "text",
      "visibility",
      "variant",
      "geometry",
      "component",
      "icon",
      "token",
      "interaction",
    ]),
    subject: z.string().trim().min(1),
    value: z.union([z.string(), z.number(), z.boolean()]),
  })
  .strict();

const FigmaStateContractFieldsSchema = z
  .object({
    targetId: z.string().trim().min(1),
    nodeId: z.string().trim().min(1),
    state: z.string().trim().min(1),
    fixtureId: z.string().trim().min(1),
    facts: z.array(FigmaStateFactSchema).min(1).max(2_000),
    requiredAssertionIds: z.array(z.string().trim().min(1)).min(1).max(500),
  })
  .strict();

export type FigmaStateContractFields = z.infer<typeof FigmaStateContractFieldsSchema>;

export function figmaStateFactsDigest(rawFields: FigmaStateContractFields): `sha256:${string}` {
  const fields = FigmaStateContractFieldsSchema.parse(rawFields);
  const canonical = {
    targetId: fields.targetId,
    nodeId: fields.nodeId,
    state: fields.state,
    fixtureId: fields.fixtureId,
    facts: [...fields.facts]
      .sort((left, right) => compareCanonicalStrings(left.id, right.id))
      .map((fact) => ({
        id: fact.id,
        kind: fact.kind,
        subject: fact.subject,
        value: fact.value,
      })),
    requiredAssertionIds: [...fields.requiredAssertionIds].sort(),
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
}

export const FigmaStateContractSchema = FigmaStateContractFieldsSchema.extend({
  digest: Sha256DigestSchema,
})
  .strict()
  .superRefine((contract, context) => {
    const duplicateFactIds = duplicates(contract.facts.map((fact) => fact.id));
    if (duplicateFactIds.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["facts"],
        message: `Duplicate Figma state fact IDs: ${duplicateFactIds.join(", ")}`,
      });
    }
    const duplicateAssertionIds = duplicates(contract.requiredAssertionIds);
    if (duplicateAssertionIds.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["requiredAssertionIds"],
        message: `Duplicate required assertion IDs: ${duplicateAssertionIds.join(", ")}`,
      });
    }
    const { digest: _digest, ...fields } = contract;
    if (contract.digest !== figmaStateFactsDigest(fields)) {
      context.addIssue({
        code: "custom",
        path: ["digest"],
        message: "Figma state contract digest does not match its canonical facts",
      });
    }
  });

export type FigmaStateContract = z.infer<typeof FigmaStateContractSchema>;

type FigmaStateTarget = {
  targetId: string;
  state: string;
  fixture: string;
  figmaCapture?: FigmaCaptureGeometry | undefined;
};

export function assertFigmaStateContracts(rawInput: {
  nodeIds: string[];
  targets: FigmaStateTarget[];
  stateContracts: FigmaStateContract[];
}): void {
  const targets = rawInput.targets;
  const parsedContracts = z
    .array(FigmaStateContractSchema)
    .min(1)
    .max(50)
    .safeParse(rawInput.stateContracts);
  if (!parsedContracts.success) {
    throw stateContractError(parsedContracts.error.issues.map((issue) => issue.message).join("; "));
  }
  const contracts = parsedContracts.data;
  const targetNodeIds = targets.flatMap((target) =>
    target.figmaCapture === undefined ? [] : [target.figmaCapture.nodeId],
  );
  const duplicateSubmittedNodeIds = duplicates(rawInput.nodeIds);
  const missingNodeIds = targetNodeIds.filter((nodeId) => !rawInput.nodeIds.includes(nodeId));
  const extraNodeIds = rawInput.nodeIds.filter((nodeId) => !targetNodeIds.includes(nodeId));
  if (
    rawInput.nodeIds.length !== targetNodeIds.length ||
    duplicateSubmittedNodeIds.length > 0 ||
    missingNodeIds.length > 0 ||
    extraNodeIds.length > 0
  ) {
    throw stateContractError(
      `nodeIds must provide unique exact coverage of visual target geometry; missing nodeIds: ${missingNodeIds.join(", ") || "none"}; extra nodeIds: ${extraNodeIds.join(", ") || "none"}; duplicate nodeIds: ${duplicateSubmittedNodeIds.join(", ") || "none"}`,
    );
  }
  const targetBindings = targets.map((target) => {
    const capture = target.figmaCapture;
    if (capture === undefined) {
      throw stateContractError(`target ${target.targetId} requires capture geometry`);
    }
    return stateBindingKey({
      targetId: target.targetId,
      nodeId: capture.nodeId,
      state: target.state,
      fixtureId: target.fixture,
    });
  });
  const contractBindings = contracts.map(stateBindingKey);
  const missing = targetBindings.filter((binding) => !contractBindings.includes(binding));
  const unbound = contractBindings.filter((binding) => !targetBindings.includes(binding));
  const duplicateTargets = duplicates(targetBindings);
  const duplicateContracts = duplicates(contractBindings);
  const duplicateTargetIds = duplicates(contracts.map((contract) => contract.targetId));
  const duplicateNodeIds = duplicates(contracts.map((contract) => contract.nodeId));
  const duplicateFixtureIds = duplicates(contracts.map((contract) => contract.fixtureId));
  if (
    targets.length !== contracts.length ||
    missing.length > 0 ||
    unbound.length > 0 ||
    duplicateTargets.length > 0 ||
    duplicateContracts.length > 0 ||
    duplicateTargetIds.length > 0 ||
    duplicateNodeIds.length > 0 ||
    duplicateFixtureIds.length > 0
  ) {
    throw stateContractError(
      `state contracts must bind exact 1:1 target/node/state/fixture coverage; missing: ${missing.join(", ") || "none"}; unbound: ${unbound.join(", ") || "none"}; duplicate targets: ${duplicateTargetIds.join(", ") || "none"}; duplicate nodes: ${duplicateNodeIds.join(", ") || "none"}; duplicate fixtures: ${duplicateFixtureIds.join(", ") || "none"}`,
    );
  }

  for (let leftIndex = 0; leftIndex < contracts.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < contracts.length; rightIndex += 1) {
      const left = contracts[leftIndex]!;
      const right = contracts[rightIndex]!;
      if (left.state === right.state) continue;
      if (canonicalFacts(left.facts) === canonicalFacts(right.facts)) {
        throw stateContractError(
          `different states ${left.state} and ${right.state} must contain at least one captured fact difference`,
        );
      }
    }
  }
}

const RepositoryPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_000)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.startsWith("\\") &&
      !/^[a-z]:[\\/]/i.test(value) &&
      !value.split(/[\\/]/).some((segment) => segment === ".."),
    "Path must be repository-relative",
  );

export const CapturedFigmaComponentSchema = z
  .object({
    name: z.string().trim().min(1).max(500),
    nodeId: z.string().trim().min(1).max(500),
  })
  .strict();

const ComponentResolutionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("component"),
      module: z.string().trim().min(1).max(500),
      exportName: z
        .string()
        .trim()
        .min(1)
        .max(300)
        .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal("asset"),
      path: RepositoryPathSchema,
      digest: Sha256DigestSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("exception"),
      reason: z.string().trim().min(1).max(1_000),
    })
    .strict(),
]);

export const FigmaDesignMappingSchema = z
  .object({
    designSystem: z
      .object({
        packageName: z
          .string()
          .trim()
          .min(1)
          .max(214)
          .regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i),
        packageVersion: z
          .string()
          .trim()
          .regex(
            /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
            "Design-system package version must be an exact semantic version",
          ),
        guidanceSkill: z.string().trim().min(1).max(500).optional(),
      })
      .strict(),
    components: z
      .array(
        z
          .object({
            figmaComponent: z.string().trim().min(1).max(500),
            nodeId: z.string().trim().min(1).max(500),
            resolution: ComponentResolutionSchema,
          })
          .strict(),
      )
      .max(1_000),
    fonts: z
      .array(
        z
          .object({
            family: z.string().trim().min(1).max(300),
            source: z.string().trim().min(1).max(1_000),
            digest: Sha256DigestSchema.optional(),
          })
          .strict(),
      )
      .max(200),
    tokens: z
      .array(
        z
          .object({
            figmaVariable: z.string().trim().min(1).max(500),
            codeToken: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .max(2_000),
  })
  .strict();

export type CapturedFigmaComponent = z.infer<typeof CapturedFigmaComponentSchema>;
export type FigmaDesignMapping = z.infer<typeof FigmaDesignMappingSchema>;

export function assertCompleteDesignMapping(rawInput: {
  capturedComponents: CapturedFigmaComponent[];
  mapping: FigmaDesignMapping;
}): void {
  const parsed = z
    .object({
      capturedComponents: z.array(CapturedFigmaComponentSchema).max(1_000),
      mapping: FigmaDesignMappingSchema,
    })
    .strict()
    .safeParse(rawInput);
  if (!parsed.success) {
    throw designMappingError(parsed.error.issues.map((issue) => issue.message).join("; "));
  }

  const capturedKeys = parsed.data.capturedComponents.map(componentKey);
  const mappedKeys = parsed.data.mapping.components.map((component) =>
    componentKey({ name: component.figmaComponent, nodeId: component.nodeId }),
  );
  const duplicateCaptured = duplicates(capturedKeys);
  const duplicateMapped = duplicates(mappedKeys);
  const captured = new Set(capturedKeys);
  const mapped = new Set(mappedKeys);
  const missing = [...captured].filter((key) => !mapped.has(key));
  const unbound = [...mapped].filter((key) => !captured.has(key));
  if (
    duplicateCaptured.length > 0 ||
    duplicateMapped.length > 0 ||
    missing.length > 0 ||
    unbound.length > 0
  ) {
    throw designMappingError(
      `missing: ${missing.join(", ") || "none"}; unbound: ${unbound.join(", ") || "none"}; duplicate captured: ${duplicateCaptured.join(", ") || "none"}; duplicate mappings: ${duplicateMapped.join(", ") || "none"}`,
    );
  }

  assertUniqueMappingValues(
    parsed.data.mapping.fonts.map((font) => font.family),
    "font families",
  );
  assertUniqueMappingValues(
    parsed.data.mapping.tokens.map((token) => token.figmaVariable),
    "Figma variables",
  );
}

export function assertFigmaCaptureGeometry(rawInput: {
  geometry: FigmaCaptureGeometry;
  target: { nodeId: string; state: string };
  viewport: VisualSize;
  decodedSize: VisualSize;
}): ValidatedFigmaGeometry {
  const compatible = FigmaCaptureGeometrySchema.safeParse(rawInput.geometry);
  if (!compatible.success) {
    throw geometryError(
      `native geometry is invalid: ${compatible.error.issues
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  }
  if (!("schemaVersion" in compatible.data)) {
    throw new Error(
      "FIGMA_CAPTURE_GEOMETRY_REACQUISITION_REQUIRED: historical v1 geometry is display-only; reacquire a native v2 export",
    );
  }
  const geometry = compatible.data;
  const viewport = VisualSizeSchema.parse(rawInput.viewport);
  const decodedSize = VisualSizeSchema.parse(rawInput.decodedSize);

  if (geometry.nodeId !== rawInput.target.nodeId) {
    throw geometryError(
      `capture node ${geometry.nodeId} does not match target node ${rawInput.target.nodeId}`,
    );
  }
  if (geometry.state !== rawInput.target.state) {
    throw geometryError(
      `capture state ${geometry.state} does not match target state ${rawInput.target.state}`,
    );
  }

  if (
    decodedSize.width !== geometry.bitmapSize.width ||
    decodedSize.height !== geometry.bitmapSize.height
  ) {
    throw geometryError(
      `decoded PNG is ${decodedSize.width}x${decodedSize.height}, manifest bitmap is ${geometry.bitmapSize.width}x${geometry.bitmapSize.height}`,
    );
  }
  if (
    viewport.width !== geometry.logicalSize.width ||
    viewport.height !== geometry.logicalSize.height
  ) {
    throw geometryError(
      `browser viewport ${viewport.width}x${viewport.height} must use logical ${geometry.logicalSize.width}x${geometry.logicalSize.height}, not the exported bitmap`,
    );
  }

  const scaleX = geometry.bitmapSize.width / geometry.logicalSize.width;
  const scaleY = geometry.bitmapSize.height / geometry.logicalSize.height;
  const aspectRatioDelta = Math.abs(
    geometry.logicalSize.width / geometry.logicalSize.height -
      geometry.bitmapSize.width / geometry.bitmapSize.height,
  );
  if (scaleX < 1 || scaleY < 1) {
    throw geometryError(
      `native export cannot downscale logical geometry; measured ${scaleX}x${scaleY}`,
    );
  }

  if (
    Math.abs(geometry.bitmapSize.width - geometry.logicalSize.width * scaleY) > 1 ||
    Math.abs(geometry.bitmapSize.height - geometry.logicalSize.height * scaleX) > 1
  ) {
    throw geometryError(`native export must use a uniform X/Y scale; measured ${scaleX}x${scaleY}`);
  }
  const expectedWidth = geometry.logicalSize.width * geometry.exportScale;
  const expectedHeight = geometry.logicalSize.height * geometry.exportScale;
  if (
    Math.abs(geometry.bitmapSize.width - expectedWidth) > 1 ||
    Math.abs(geometry.bitmapSize.height - expectedHeight) > 1
  ) {
    throw geometryError(
      `bitmap ${geometry.bitmapSize.width}x${geometry.bitmapSize.height} does not match export scale ${geometry.exportScale} from logical ${geometry.logicalSize.width}x${geometry.logicalSize.height}`,
    );
  }
  if (aspectRatioDelta > Number.EPSILON) {
    throw geometryError(`native export aspect ratio drift ${aspectRatioDelta} must be zero`);
  }

  return { scaleX, scaleY, aspectRatioDelta };
}

function geometryError(message: string): Error {
  return new Error(`FIGMA_CAPTURE_GEOMETRY_INVALID: ${message}`);
}

function componentKey(component: CapturedFigmaComponent): string {
  return `${component.name}\u0000${component.nodeId}`;
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function assertUniqueMappingValues(values: string[], label: string): void {
  const duplicateValues = duplicates(values);
  if (duplicateValues.length > 0) {
    throw designMappingError(`duplicate ${label}: ${duplicateValues.join(", ")}`);
  }
}

function designMappingError(message: string): Error {
  return new Error(`FIGMA_DESIGN_MAPPING_INCOMPLETE: ${message}`);
}

function stateContractError(message: string): Error {
  return new Error(`FIGMA_STATE_CONTRACT_INVALID: ${message}`);
}

function stateBindingKey(binding: {
  targetId: string;
  nodeId: string;
  state: string;
  fixtureId: string;
}): string {
  return `${binding.targetId}\u0000${binding.nodeId}\u0000${binding.state}\u0000${binding.fixtureId}`;
}

function canonicalFacts(facts: Array<z.infer<typeof FigmaStateFactSchema>>): string {
  return JSON.stringify(
    [...facts]
      .sort((left, right) => compareCanonicalStrings(left.id, right.id))
      .map((fact) => ({
        id: fact.id,
        kind: fact.kind,
        subject: fact.subject,
        value: fact.value,
      })),
  );
}

function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
