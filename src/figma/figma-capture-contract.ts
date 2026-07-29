import { createHash } from "node:crypto";
import path from "node:path";

import { parse } from "@babel/parser";
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

const UiAssertionScalarSchema = z.union([z.string(), z.number(), z.boolean()]);

export const UiAssertionGeometrySnapshotSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
  })
  .strict();

const UiAssertionDefinitionBaseFields = {
  id: z.string().trim().min(1),
  selector: z.string().trim().min(1),
  subject: z.string().trim().min(1),
} as const;

export const UiAssertionDefinitionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...UiAssertionDefinitionBaseFields,
      kind: z.literal("geometry"),
      expected: UiAssertionGeometrySnapshotSchema,
      maxTolerance: z.number().min(0).max(0.5),
    })
    .strict(),
  z
    .object({
      ...UiAssertionDefinitionBaseFields,
      kind: z.literal("computed-style"),
      property: z.string().trim().min(1),
      expected: z.string(),
    })
    .strict(),
  z
    .object({
      ...UiAssertionDefinitionBaseFields,
      kind: z.literal("accessibility"),
      check: z.enum(["focus-visible", "keyboard-focus", "heading-order", "accessible-name"]),
      expected: UiAssertionScalarSchema,
    })
    .strict(),
  z
    .object({
      ...UiAssertionDefinitionBaseFields,
      kind: z.literal("interaction"),
      action: z.enum(["click", "keyboard"]),
      expected: UiAssertionScalarSchema,
    })
    .strict(),
]);

export type UiAssertionDefinition = z.infer<typeof UiAssertionDefinitionSchema>;

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
    mappingId: z.string().trim().min(1).optional(),
    bindingAspect: z
      .enum(["export", "token", "width", "height", "alignment", "flexShrink"])
      .optional(),
  })
  .strict()
  .superRefine((fact, context) => {
    const bindingKind = ["icon", "token", "geometry"].includes(fact.kind);
    if (bindingKind !== (fact.mappingId !== undefined && fact.bindingAspect !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["mappingId"],
        message:
          "Icon, token, and geometry facts must carry a mapping ID and binding aspect; other facts must not",
      });
      return;
    }
    const validAspect =
      (fact.kind === "icon" && fact.bindingAspect === "export") ||
      (fact.kind === "token" && fact.bindingAspect === "token") ||
      (fact.kind === "geometry" &&
        ["width", "height", "alignment", "flexShrink"].includes(fact.bindingAspect ?? ""));
    if (bindingKind && !validAspect) {
      context.addIssue({
        code: "custom",
        path: ["bindingAspect"],
        message: `Binding aspect ${fact.bindingAspect} does not match ${fact.kind}`,
      });
    }
  });

const FigmaStateContractFieldsSchema = z
  .object({
    targetId: z.string().trim().min(1),
    nodeId: z.string().trim().min(1),
    state: z.string().trim().min(1),
    fixtureId: z.string().trim().min(1),
    facts: z.array(FigmaStateFactSchema).min(1).max(2_000),
    requiredAssertions: z.array(UiAssertionDefinitionSchema).min(1).max(500),
    designBindingIds: z.array(z.string().trim().min(1)).max(1_000).default([]),
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
        ...(fact.mappingId === undefined ? {} : { mappingId: fact.mappingId }),
        ...(fact.bindingAspect === undefined ? {} : { bindingAspect: fact.bindingAspect }),
      })),
    requiredAssertions: [...fields.requiredAssertions]
      .sort((left, right) => compareCanonicalStrings(left.id, right.id))
      .map(canonicalUiAssertionDefinition),
    designBindingIds: [...fields.designBindingIds].sort(compareCanonicalStrings),
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
    const duplicateAssertionIds = duplicates(
      contract.requiredAssertions.map((assertion) => assertion.id),
    );
    if (duplicateAssertionIds.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["requiredAssertions"],
        message: `Duplicate required assertion IDs: ${duplicateAssertionIds.join(", ")}`,
      });
    }
    const duplicateDesignBindingIds = duplicates(contract.designBindingIds);
    if (duplicateDesignBindingIds.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["designBindingIds"],
        message: `Duplicate state design binding IDs: ${duplicateDesignBindingIds.join(", ")}`,
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
  mapping: FigmaDesignMapping;
}): void {
  const targets = rawInput.targets;
  const mapping = FigmaDesignMappingSchema.parse(rawInput.mapping);
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

  const mappingsById = new Map(mapping.components.map((binding) => [binding.id, binding]));
  for (const contract of contracts) {
    const bindingIdSet = new Set(contract.designBindingIds);
    const unknownBindingIds = contract.designBindingIds.filter(
      (mappingId) => !mappingsById.has(mappingId),
    );
    const unboundFacts = contract.facts.filter(
      (fact) => fact.mappingId !== undefined && !bindingIdSet.has(fact.mappingId),
    );
    if (unknownBindingIds.length > 0 || unboundFacts.length > 0) {
      throw stateContractError(
        `state ${contract.targetId} has unknown design bindings: ${unknownBindingIds.join(", ") || "none"}; facts outside designBindingIds: ${unboundFacts.map((fact) => fact.id).join(", ") || "none"}`,
      );
    }
    for (const mappingId of contract.designBindingIds) {
      const binding = mappingsById.get(mappingId)!;
      const bindingFacts = contract.facts.filter((fact) => fact.mappingId === mappingId);
      if (binding.role !== "icon") {
        if (bindingFacts.length === 0) {
          throw stateContractError(
            `state ${contract.targetId} design binding ${mappingId} has no mapping-linked facts`,
          );
        }
        continue;
      }
      const expectedFacts = expectedIconStateFacts(binding);
      const mismatched = [...expectedFacts].filter(([aspect, expectedValue]) => {
        const fact = bindingFacts.find((candidate) => candidate.bindingAspect === aspect);
        return fact === undefined || fact.value !== expectedValue;
      });
      const unknownAspects = bindingFacts.filter(
        (fact) => !expectedFacts.has(fact.bindingAspect ?? ""),
      );
      if (
        bindingFacts.length !== expectedFacts.size ||
        mismatched.length > 0 ||
        unknownAspects.length > 0
      ) {
        throw stateContractError(
          `state ${contract.targetId} icon binding ${mappingId} must exact-match export, token, width, height, alignment, and flexShrink facts`,
        );
      }
    }
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

export const RepositoryPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_000)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.startsWith("\\") &&
      !/^[a-z]:[\\/]/i.test(value) &&
      !/^[a-z][a-z0-9+.-]*:\/\//i.test(value) &&
      !value.split(/[\\/]/).some((segment) => segment === ".."),
    "Path must be repository-relative",
  );

export const CapturedFigmaComponentSchema = z
  .object({
    name: z.string().trim().min(1).max(500),
    nodeId: z.string().trim().min(1).max(500),
  })
  .strict();

const FigmaBindingPropValueSchema = z.union([z.string(), z.number(), z.boolean()]);
const ExactSemanticVersionSchema = z
  .string()
  .trim()
  .regex(
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
    "Design-system package version must be an exact semantic version",
  );

const DesignSystemPackageNameSchema = z.enum(["@frontend/ui", "@lessonpro/ui"]);

const DesignSystemPublicModuleSchema = z.enum([
  "@frontend/ui",
  "@frontend/ui/icons/vue",
  "@frontend/ui/icons/react",
  "@lessonpro/ui",
  "@lessonpro/ui/icons",
]);

function publicModulesForPackage(
  packageName: z.infer<typeof DesignSystemPackageNameSchema>,
): readonly z.infer<typeof DesignSystemPublicModuleSchema>[] {
  return packageName === "@frontend/ui"
    ? ["@frontend/ui", "@frontend/ui/icons/vue", "@frontend/ui/icons/react"]
    : ["@lessonpro/ui", "@lessonpro/ui/icons"];
}

const FigmaPublicApiExportSchema = z
  .object({
    figmaComponent: z.string().trim().min(1),
    nodeId: z.string().trim().min(1),
    module: DesignSystemPublicModuleSchema,
    exportName: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/),
    allowedProps: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(200)
          .regex(/^[A-Za-z_$][A-Za-z0-9_$-]*$/),
      )
      .max(100),
  })
  .strict();

const FigmaPublicApiCatalogFieldsSchema = z
  .object({
    schemaVersion: z.literal("figma-public-api-catalog-v1"),
    packageName: DesignSystemPackageNameSchema,
    packageVersion: ExactSemanticVersionSchema,
    packageManifest: z
      .object({
        path: RepositoryPathSchema,
        digest: Sha256DigestSchema,
      })
      .strict(),
    publicBarrels: z
      .array(
        z
          .object({
            module: DesignSystemPublicModuleSchema,
            path: RepositoryPathSchema,
            digest: Sha256DigestSchema,
          })
          .strict(),
      )
      .min(1)
      .max(10),
    publicSources: z
      .array(
        z
          .object({
            path: RepositoryPathSchema,
            digest: Sha256DigestSchema,
          })
          .strict(),
      )
      .max(100)
      .default([]),
    codeConnectManifest: z
      .object({
        path: RepositoryPathSchema,
        digest: Sha256DigestSchema,
      })
      .strict()
      .optional(),
    exports: z.array(FigmaPublicApiExportSchema).max(2_000),
  })
  .strict();

export type FigmaPublicApiCatalogFields = z.input<typeof FigmaPublicApiCatalogFieldsSchema>;

export function figmaPublicApiCatalogDigest(
  rawFields: FigmaPublicApiCatalogFields,
): `sha256:${string}` {
  const fields = FigmaPublicApiCatalogFieldsSchema.parse(rawFields);
  const canonical = {
    schemaVersion: fields.schemaVersion,
    packageName: fields.packageName,
    packageVersion: fields.packageVersion,
    packageManifest: fields.packageManifest,
    publicBarrels: [...fields.publicBarrels].sort((left, right) =>
      compareCanonicalStrings(left.module, right.module),
    ),
    publicSources: [...fields.publicSources].sort((left, right) =>
      compareCanonicalStrings(left.path, right.path),
    ),
    codeConnectManifest: fields.codeConnectManifest,
    exports: [...fields.exports]
      .sort((left, right) =>
        compareCanonicalStrings(
          `${left.figmaComponent}\u0000${left.nodeId}`,
          `${right.figmaComponent}\u0000${right.nodeId}`,
        ),
      )
      .map((entry) => ({
        ...entry,
        allowedProps: [...entry.allowedProps].sort(compareCanonicalStrings),
      })),
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
}

export const FigmaPublicApiCatalogSchema = FigmaPublicApiCatalogFieldsSchema.extend({
  digest: Sha256DigestSchema,
})
  .strict()
  .superRefine((catalog, context) => {
    const { digest: _digest, ...fields } = catalog;
    if (catalog.digest !== figmaPublicApiCatalogDigest(fields)) {
      context.addIssue({
        code: "custom",
        path: ["digest"],
        message: "Public API catalog digest does not match its canonical contents",
      });
    }
    const duplicateBarrels = duplicates(catalog.publicBarrels.map((barrel) => barrel.module));
    const duplicateEvidencePaths = duplicates([
      catalog.packageManifest.path,
      ...catalog.publicBarrels.map((barrel) => barrel.path),
      ...catalog.publicSources.map((source) => source.path),
      ...(catalog.codeConnectManifest === undefined ? [] : [catalog.codeConnectManifest.path]),
    ]);
    const duplicateExports = duplicates(
      catalog.exports.map((entry) => `${entry.figmaComponent}\u0000${entry.nodeId}`),
    );
    if (duplicateBarrels.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["publicBarrels"],
        message: `Duplicate public barrel modules: ${duplicateBarrels.join(", ")}`,
      });
    }
    if (duplicateExports.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["exports"],
        message: `Duplicate public API exports: ${duplicateExports.join(", ")}`,
      });
    }
    if (duplicateEvidencePaths.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["packageManifest"],
        message: `Public API evidence paths must be distinct: ${duplicateEvidencePaths.join(", ")}`,
      });
    }
    const allowedModules = new Set(publicModulesForPackage(catalog.packageName));
    for (const [index, barrel] of catalog.publicBarrels.entries()) {
      if (!allowedModules.has(barrel.module)) {
        context.addIssue({
          code: "custom",
          path: ["publicBarrels", index, "module"],
          message: `${barrel.module} is not published by ${catalog.packageName}`,
        });
      }
    }
    for (const [index, entry] of catalog.exports.entries()) {
      if (!catalog.publicBarrels.some((barrel) => barrel.module === entry.module)) {
        context.addIssue({
          code: "custom",
          path: ["exports", index, "module"],
          message: `Export ${entry.exportName} has no digest-bound public barrel`,
        });
      }
      const duplicateProps = duplicates(entry.allowedProps);
      if (duplicateProps.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["exports", index, "allowedProps"],
          message: `Duplicate allowed props: ${duplicateProps.join(", ")}`,
        });
      }
    }
  });

export type FigmaPublicApiCatalog = z.infer<typeof FigmaPublicApiCatalogSchema>;

export function assertFigmaPublicApiCatalogEvidence(rawInput: {
  mapping: FigmaDesignMapping;
  evidence: Array<{ path: string; content: Buffer | string }>;
}): void {
  const mapping = FigmaDesignMappingSchema.parse(rawInput.mapping);
  const catalog = mapping.publicApiCatalog;
  const duplicateEvidencePaths = duplicates(rawInput.evidence.map((entry) => entry.path));
  if (duplicateEvidencePaths.length > 0) {
    throw designMappingError(
      `duplicate public API evidence paths: ${duplicateEvidencePaths.join(", ")}`,
    );
  }
  const evidence = new Map(
    rawInput.evidence.map((entry) => [
      RepositoryPathSchema.parse(entry.path),
      Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, "utf8"),
    ]),
  );
  const expectedEvidence = [
    catalog.packageManifest,
    ...catalog.publicBarrels,
    ...catalog.publicSources,
    ...(catalog.codeConnectManifest === undefined ? [] : [catalog.codeConnectManifest]),
  ];
  for (const expected of expectedEvidence) {
    const content = evidence.get(expected.path);
    if (content === undefined) {
      throw designMappingError(`missing public API evidence: ${expected.path}`);
    }
    const observedDigest = `sha256:${createHash("sha256").update(content).digest("hex")}` as const;
    if (observedDigest !== expected.digest) {
      throw designMappingError(`public API evidence digest does not match: ${expected.path}`);
    }
  }

  const packageManifestBytes = evidence.get(catalog.packageManifest.path)!;
  const packageManifest = parseJsonEvidence(
    packageManifestBytes,
    catalog.packageManifest.path,
    z
      .object({
        name: DesignSystemPackageNameSchema,
        version: ExactSemanticVersionSchema,
        exports: z.record(
          z.string(),
          z.union([
            z.string().trim().min(1),
            z
              .object({
                types: z.string().trim().min(1).optional(),
                default: z.string().trim().min(1).optional(),
              })
              .strict()
              .refine(
                (entry) => entry.types !== undefined || entry.default !== undefined,
                "Conditional export must contain a types or default target",
              ),
          ]),
        ),
      })
      .passthrough(),
  );
  if (
    packageManifest.name !== catalog.packageName ||
    packageManifest.version !== catalog.packageVersion ||
    packageManifest.name !== mapping.designSystem.packageName ||
    packageManifest.version !== mapping.designSystem.packageVersion
  ) {
    throw designMappingError(
      `package manifest name/version ${packageManifest.name}@${packageManifest.version} does not exact-match the catalog`,
    );
  }
  const packageDirectory = pathDirectory(catalog.packageManifest.path);
  const barrelsByModule = new Map(catalog.publicBarrels.map((barrel) => [barrel.module, barrel]));
  const exportedNamesByModule = new Map<string, Set<string>>();
  const requestedExportsByModule = new Map<string, Set<string>>();
  for (const entry of catalog.exports) {
    const exports = requestedExportsByModule.get(entry.module) ?? new Set<string>();
    exports.add(entry.exportName);
    requestedExportsByModule.set(entry.module, exports);
  }
  const allowedBarrelPaths = new Set([
    ...catalog.publicBarrels.map((barrel) => barrel.path),
    ...catalog.publicSources.map((source) => source.path),
  ]);
  const exportedNamesByPath = new Map<string, Set<string>>();
  for (const barrel of catalog.publicBarrels) {
    const exportKey = barrel.module === catalog.packageName
      ? "."
      : `.${barrel.module.slice(catalog.packageName.length)}`;
    const declaredTarget = packageExportTarget(packageManifest.exports[exportKey]);
    if (declaredTarget === undefined) {
      throw designMappingError(
        `package manifest does not publish ${barrel.module} at ${exportKey}`,
      );
    }
    const resolvedTarget = normalizeRepositoryPath(packageDirectory, declaredTarget);
    if (resolvedTarget !== barrel.path) {
      throw designMappingError(
        `package export ${exportKey} resolves to ${resolvedTarget}, not evidence ${barrel.path}`,
      );
    }
    exportedNamesByModule.set(
      barrel.module,
      namedModuleExports({
        content: evidence.get(barrel.path)!,
        evidencePath: barrel.path,
        evidence,
        allowedBarrelPaths,
        exportedNamesByPath,
        visiting: new Set(),
        ...(requestedExportsByModule.get(barrel.module) === undefined
          ? {}
          : { requestedNames: requestedExportsByModule.get(barrel.module)! }),
      }),
    );
  }

  for (const entry of catalog.exports) {
    const barrel = barrelsByModule.get(entry.module);
    const namedExports = exportedNamesByModule.get(entry.module);
    if (barrel === undefined || namedExports === undefined || !namedExports.has(entry.exportName)) {
      throw designMappingError(
        `catalog export ${entry.module}#${entry.exportName} is not a real named barrel export`,
      );
    }
  }

  if (catalog.codeConnectManifest !== undefined) {
    const codeConnectManifest = parseJsonEvidence(
      evidence.get(catalog.codeConnectManifest.path)!,
      catalog.codeConnectManifest.path,
      z
        .object({
          packageName: DesignSystemPackageNameSchema,
          packageVersion: ExactSemanticVersionSchema,
          mappings: z.array(FigmaPublicApiExportSchema).max(2_000),
        })
        .strict(),
    );
    if (
      codeConnectManifest.packageName !== catalog.packageName ||
      codeConnectManifest.packageVersion !== catalog.packageVersion ||
      canonicalPublicApiExports(codeConnectManifest.mappings) !==
        canonicalPublicApiExports(catalog.exports)
    ) {
      throw designMappingError(
        "Code Connect manifest package/version/mappings do not exact-match the public API catalog",
      );
    }
  }
}

export const FigmaSemanticTokenBindingSchema = z
  .object({
    role: z.enum(["text", "icon", "background", "border"]),
    figmaVariable: z.string().trim().min(1),
    codeToken: z.string().trim().min(1),
  })
  .strict()
  .superRefine((token, context) => {
    const expected = semanticCodeToken(token.figmaVariable, token.role);
    if (token.codeToken !== expected) {
      context.addIssue({
        code: "custom",
        path: ["codeToken"],
        message: `Semantic token ${token.figmaVariable} must use ${expected} for ${token.role}`,
      });
    }
  });

export const FigmaExpectedGeometrySchema = z
  .object({
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    alignment: z.string().trim().min(1).optional(),
    flexShrink: z.number().nonnegative().optional(),
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
      props: z.record(z.string(), FigmaBindingPropValueSchema),
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
      unavailableExport: z
        .object({
          requestedModule: DesignSystemPublicModuleSchema,
          requestedExport: z
            .string()
            .trim()
            .min(1)
            .max(300)
            .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/),
          catalogDigest: Sha256DigestSchema,
        })
        .strict(),
      substitute: z
        .object({
          path: RepositoryPathSchema,
          digest: Sha256DigestSchema,
          size: z.number().positive(),
          color: z
            .string()
            .trim()
            .regex(/^--semantic-[a-z0-9-]+$/i),
        })
        .strict(),
    })
    .strict(),
]);

export const FigmaDesignBindingSchema = z
  .object({
    id: z.string().trim().min(1),
    figmaComponent: z.string().trim().min(1),
    nodeId: z.string().trim().min(1),
    role: z.enum(["component", "icon"]),
    resolution: ComponentResolutionSchema,
    semanticTokens: z.array(FigmaSemanticTokenBindingSchema),
    expectedGeometry: FigmaExpectedGeometrySchema.optional(),
  })
  .strict()
  .superRefine((binding, context) => {
    const duplicateTokens = duplicates(
      binding.semanticTokens.map((token) => `${token.role}\u0000${token.figmaVariable}`),
    );
    if (duplicateTokens.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["semanticTokens"],
        message: "Semantic token bindings must be unique",
      });
    }
    if (binding.role !== "icon") return;
    if (binding.resolution.kind === "asset") {
      context.addIssue({
        code: "custom",
        path: ["resolution"],
        message:
          "Icon bindings must use a public component or a proof-bearing unavailable-export exception",
      });
      return;
    }
    const iconTokens = binding.semanticTokens.filter((token) => token.role === "icon");
    if (iconTokens.length !== 1 || binding.semanticTokens.length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["semanticTokens"],
        message: "Icon bindings require exactly one icon-role semantic token",
      });
    }
    if (
      binding.expectedGeometry?.width === undefined ||
      binding.expectedGeometry.height === undefined ||
      binding.expectedGeometry.alignment === undefined ||
      binding.expectedGeometry.flexShrink === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["expectedGeometry"],
        message: "Icon bindings require exact width, height, alignment, and flex-shrink geometry",
      });
    }
    const iconToken = iconTokens[0];
    if (binding.resolution.kind === "exception") {
      if (iconToken !== undefined && binding.resolution.substitute.color !== iconToken.codeToken) {
        context.addIssue({
          code: "custom",
          path: ["resolution", "substitute", "color"],
          message: "Exception substitute color must exactly match its icon semantic token",
        });
      }
      if (
        binding.expectedGeometry?.width !== binding.resolution.substitute.size ||
        binding.expectedGeometry.height !== binding.resolution.substitute.size
      ) {
        context.addIssue({
          code: "custom",
          path: ["expectedGeometry"],
          message: "Exception substitute size must match exact icon width and height",
        });
      }
      return;
    }
    if (!/^@frontend\/ui\/icons\/(?:vue|react)$/.test(binding.resolution.module) && binding.resolution.module !== "@lessonpro/ui/icons") {
      context.addIssue({
        code: "custom",
        path: ["resolution", "module"],
        message: "Icon bindings must use the public design-system icon module",
      });
    }
    const size = binding.resolution.props["size"];
    const color = binding.resolution.props["color"];
    if (typeof size !== "number" || size <= 0) {
      context.addIssue({
        code: "custom",
        path: ["resolution", "props", "size"],
        message: "Icon bindings require an exact positive numeric size prop",
      });
    }
    if (typeof color !== "string" || !/^--semantic-[a-z0-9-]+$/i.test(color)) {
      context.addIssue({
        code: "custom",
        path: ["resolution", "props", "color"],
        message: "Icon color props must use a bare --semantic-* custom property name",
      });
    }
    if (iconToken !== undefined && color !== iconToken.codeToken) {
      context.addIssue({
        code: "custom",
        path: ["resolution", "props", "color"],
        message: "Icon color prop must exactly match its semantic token binding",
      });
    }
    if (
      typeof size === "number" &&
      (binding.expectedGeometry?.width !== size || binding.expectedGeometry.height !== size)
    ) {
      context.addIssue({
        code: "custom",
        path: ["expectedGeometry"],
        message: "Icon width and height must match the exact size prop",
      });
    }
  });

export const FigmaDesignMappingSchema = z
  .object({
    designSystem: z
      .object({
        packageName: DesignSystemPackageNameSchema,
        packageVersion: ExactSemanticVersionSchema,
        catalogDigest: Sha256DigestSchema,
        guidanceSkill: z.string().trim().min(1).max(500).optional(),
      })
      .strict(),
    publicApiCatalog: FigmaPublicApiCatalogSchema,
    components: z.array(FigmaDesignBindingSchema).max(1_000),
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
  .strict()
  .superRefine((mapping, context) => {
    if (
      mapping.publicApiCatalog.packageName !== mapping.designSystem.packageName ||
      mapping.publicApiCatalog.packageVersion !== mapping.designSystem.packageVersion ||
      mapping.publicApiCatalog.digest !== mapping.designSystem.catalogDigest
    ) {
      context.addIssue({
        code: "custom",
        path: ["publicApiCatalog"],
        message:
          "Public API catalog must bind the exact design-system package, resolved semver, and catalog digest",
      });
    }
    const duplicateIds = duplicates(mapping.components.map((component) => component.id));
    if (duplicateIds.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["components"],
        message: `Duplicate design binding IDs: ${duplicateIds.join(", ")}`,
      });
    }
    mapping.components.forEach((component, index) => {
      assertKnownIconContract(component, index, context);
      if (component.resolution.kind === "exception") {
        const resolution = component.resolution;
        if (resolution.unavailableExport.catalogDigest !== mapping.publicApiCatalog.digest) {
          context.addIssue({
            code: "custom",
            path: ["components", index, "resolution", "unavailableExport", "catalogDigest"],
            message: `Exception ${component.id} must bind the exact public API catalog digest`,
          });
        }
        const requestedIsPublished = mapping.publicApiCatalog.exports.some(
          (entry) =>
            entry.module === resolution.unavailableExport.requestedModule &&
            entry.exportName === resolution.unavailableExport.requestedExport,
        );
        if (requestedIsPublished) {
          context.addIssue({
            code: "custom",
            path: ["components", index, "resolution", "unavailableExport"],
            message: `Exception ${component.id} cannot claim an export that the catalog publishes`,
          });
        }
        return;
      }
      if (component.resolution.kind !== "component") return;
      const resolution = component.resolution;
      const expectedModule =
        component.role === "icon"
          ? new Set(
              mapping.designSystem.packageName === "@frontend/ui"
                ? ["@frontend/ui/icons/vue", "@frontend/ui/icons/react"]
                : ["@lessonpro/ui/icons"],
            )
          : new Set([mapping.designSystem.packageName]);
      if (!expectedModule.has(resolution.module)) {
        context.addIssue({
          code: "custom",
          path: ["components", index, "resolution", "module"],
          message: `Binding ${component.id} must use a public module from ${mapping.designSystem.packageName}`,
        });
      }
      const catalogEntry = mapping.publicApiCatalog.exports.find(
        (entry) =>
          entry.figmaComponent === component.figmaComponent &&
          entry.nodeId === component.nodeId &&
          entry.module === resolution.module &&
          entry.exportName === resolution.exportName,
      );
      if (catalogEntry === undefined) {
        context.addIssue({
          code: "custom",
          path: ["components", index, "resolution"],
          message: `Binding ${component.id} is not present in the digest-bound public API/Code Connect catalog`,
        });
      } else {
        const unknownProps = Object.keys(resolution.props).filter(
          (prop) => !catalogEntry.allowedProps.includes(prop),
        );
        if (unknownProps.length > 0) {
          context.addIssue({
            code: "custom",
            path: ["components", index, "resolution", "props"],
            message: `Binding ${component.id} uses props absent from the public API catalog: ${unknownProps.join(", ")}`,
          });
        }
      }
    });
  });

export type CapturedFigmaComponent = z.infer<typeof CapturedFigmaComponentSchema>;
export type FigmaDesignMapping = z.infer<typeof FigmaDesignMappingSchema>;
export type FigmaDesignBinding = z.infer<typeof FigmaDesignBindingSchema>;

const FigmaImplementationResolutionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("component"),
      module: z.string().trim().min(1),
      exportName: z.string().trim().min(1),
      appliedProps: z.record(z.string(), FigmaBindingPropValueSchema),
      tokenUsages: z.array(FigmaSemanticTokenBindingSchema),
      observedGeometry: FigmaExpectedGeometrySchema.optional(),
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
      reason: z.string().trim().min(1),
      unavailableExport: z
        .object({
          requestedModule: DesignSystemPublicModuleSchema,
          requestedExport: z.string().trim().min(1),
          catalogDigest: Sha256DigestSchema,
        })
        .strict(),
      substitute: z
        .object({
          path: RepositoryPathSchema,
          digest: Sha256DigestSchema,
          size: z.number().positive(),
          color: z
            .string()
            .trim()
            .regex(/^--semantic-[a-z0-9-]+$/i),
        })
        .strict(),
    })
    .strict(),
]);

export const FigmaImplementationBindingSchema = z
  .object({
    mappingId: z.string().trim().min(1),
    sourceFile: RepositoryPathSchema,
    resolution: FigmaImplementationResolutionSchema,
  })
  .strict();

export type FigmaImplementationBinding = z.infer<typeof FigmaImplementationBindingSchema>;

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

export function assertExactFigmaImplementationBindings(rawInput: {
  mapping: FigmaDesignMapping;
  usages: FigmaImplementationBinding[];
}): void {
  const parsed = z
    .object({
      mapping: FigmaDesignMappingSchema,
      usages: z.array(FigmaImplementationBindingSchema).max(1_000),
    })
    .strict()
    .safeParse(rawInput);
  if (!parsed.success) {
    throw implementationBindingError(parsed.error.issues.map((issue) => issue.message).join("; "));
  }

  const mappingsById = new Map(
    parsed.data.mapping.components.map((component) => [component.id, component]),
  );
  const usagesById = new Map(parsed.data.usages.map((usage) => [usage.mappingId, usage]));
  const duplicateUsageIds = duplicates(parsed.data.usages.map((usage) => usage.mappingId));
  const missing = [...mappingsById.keys()].filter((mappingId) => !usagesById.has(mappingId));
  const unknown = [...usagesById.keys()].filter((mappingId) => !mappingsById.has(mappingId));
  const mismatched = [...mappingsById].flatMap(([mappingId, binding]) => {
    const usage = usagesById.get(mappingId);
    if (usage === undefined) return [];
    const expectedResolution =
      binding.resolution.kind === "component"
        ? {
            kind: "component" as const,
            module: binding.resolution.module,
            exportName: binding.resolution.exportName,
            appliedProps: binding.resolution.props,
            tokenUsages: binding.semanticTokens,
            ...(binding.expectedGeometry === undefined
              ? {}
              : { observedGeometry: binding.expectedGeometry }),
          }
        : binding.resolution;
    return canonicalBindingValue(usage.resolution) === canonicalBindingValue(expectedResolution)
      ? []
      : [mappingId];
  });
  if (
    duplicateUsageIds.length > 0 ||
    missing.length > 0 ||
    unknown.length > 0 ||
    mismatched.length > 0
  ) {
    throw implementationBindingError(
      `missing: ${missing.join(", ") || "none"}; unknown: ${unknown.join(", ") || "none"}; duplicate: ${duplicateUsageIds.join(", ") || "none"}; mismatched: ${mismatched.join(", ") || "none"}`,
    );
  }
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

function implementationBindingError(message: string): Error {
  return new Error(`FIGMA_DESIGN_SYSTEM_EVIDENCE_INVALID: ${message}`);
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
        ...(fact.mappingId === undefined ? {} : { mappingId: fact.mappingId }),
        ...(fact.bindingAspect === undefined ? {} : { bindingAspect: fact.bindingAspect }),
      })),
  );
}

function canonicalUiAssertionDefinition(definition: UiAssertionDefinition): unknown {
  if (definition.kind === "geometry") {
    return {
      id: definition.id,
      kind: definition.kind,
      selector: definition.selector,
      subject: definition.subject,
      expected: definition.expected,
      maxTolerance: definition.maxTolerance,
    };
  }
  if (definition.kind === "computed-style") {
    return {
      id: definition.id,
      kind: definition.kind,
      selector: definition.selector,
      subject: definition.subject,
      property: definition.property,
      expected: definition.expected,
    };
  }
  if (definition.kind === "accessibility") {
    return {
      id: definition.id,
      kind: definition.kind,
      selector: definition.selector,
      subject: definition.subject,
      check: definition.check,
      expected: definition.expected,
    };
  }
  return {
    id: definition.id,
    kind: definition.kind,
    selector: definition.selector,
    subject: definition.subject,
    action: definition.action,
    expected: definition.expected,
  };
}

function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function semanticCodeToken(
  figmaVariable: string,
  role: "text" | "icon" | "background" | "border",
): string {
  const customProperty = `--${figmaVariable.trim().replaceAll("/", "-")}`;
  return role === "icon" ? customProperty : `var(${customProperty})`;
}

function assertKnownIconContract(
  binding: FigmaDesignBinding,
  index: number,
  context: z.RefinementCtx,
): void {
  const known = {
    "icon/normal/spot": {
      exportName: "Spot",
      props: { size: 16, color: "--semantic-text-tertiary", state: "normal" },
      token: {
        role: "icon",
        figmaVariable: "semantic/text/tertiary",
        codeToken: "--semantic-text-tertiary",
      },
    },
    "icon/status/circle": {
      exportName: "Circle",
      props: { size: 16, color: "--semantic-status-positive", state: "available" },
      token: {
        role: "icon",
        figmaVariable: "semantic/status/positive",
        codeToken: "--semantic-status-positive",
      },
    },
    "icon/status/close": {
      exportName: "Close",
      props: { size: 16, color: "--semantic-status-negative", state: "unavailable" },
      token: {
        role: "icon",
        figmaVariable: "semantic/status/negative",
        codeToken: "--semantic-status-negative",
      },
    },
  } as const;
  const expected = known[binding.figmaComponent as keyof typeof known];
  if (expected === undefined) return;
  if (binding.role !== "icon" || binding.resolution.kind !== "component") {
    context.addIssue({
      code: "custom",
      path: ["components", index, "resolution"],
      message: `${binding.figmaComponent} is a required known icon and must use its public component export`,
    });
    return;
  }
  if (
    binding.resolution.module !== "@frontend/ui/icons/vue" ||
    binding.resolution.exportName !== expected.exportName ||
    canonicalBindingValue(binding.resolution.props) !== canonicalBindingValue(expected.props) ||
    canonicalBindingValue(binding.semanticTokens) !== canonicalBindingValue([expected.token]) ||
    canonicalBindingValue(binding.expectedGeometry) !==
      canonicalBindingValue({ width: 16, height: 16, alignment: "center", flexShrink: 0 })
  ) {
    context.addIssue({
      code: "custom",
      path: ["components", index],
      message: `${binding.figmaComponent} must exact-match its public Vue export, props, semantic token, and geometry`,
    });
  }
}

function expectedIconStateFacts(
  binding: FigmaDesignBinding,
): Map<string, string | number | boolean> {
  if (binding.role !== "icon") return new Map();
  const token = binding.semanticTokens.find((candidate) => candidate.role === "icon");
  const geometry = binding.expectedGeometry;
  const exportName =
    binding.resolution.kind === "component"
      ? binding.resolution.exportName
      : binding.resolution.kind === "exception"
        ? binding.resolution.unavailableExport.requestedExport
        : "";
  return new Map<string, string | number | boolean>([
    ["export", exportName],
    ["token", token?.codeToken ?? ""],
    ["width", geometry?.width ?? -1],
    ["height", geometry?.height ?? -1],
    ["alignment", geometry?.alignment ?? ""],
    ["flexShrink", geometry?.flexShrink ?? -1],
  ]);
}

function canonicalBindingValue(value: unknown): string {
  return JSON.stringify(canonicalizeBindingValue(value));
}

function parseJsonEvidence<T>(content: Buffer, evidencePath: string, schema: z.ZodType<T>): T {
  let raw: unknown;
  try {
    raw = JSON.parse(content.toString("utf8"));
  } catch {
    throw designMappingError(`${evidencePath} must contain strict JSON`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw designMappingError(
      `${evidencePath} is invalid: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
  return parsed.data;
}

function pathDirectory(repositoryPath: string): string {
  const directory = path.posix.dirname(repositoryPath);
  return directory === "." ? "" : directory;
}

function packageExportTarget(
  entry: string | { types?: string | undefined; default?: string | undefined } | undefined,
): string | undefined {
  if (typeof entry === "string") return entry;
  return entry?.default ?? entry?.types;
}

function normalizeRepositoryPath(directory: string, target: string): string {
  if (!target.startsWith("./")) {
    throw designMappingError(`package export target must be a relative ./ path: ${target}`);
  }
  const normalized = path.posix.normalize(path.posix.join(directory, target));
  return RepositoryPathSchema.parse(normalized);
}

function namedModuleExports(input: {
  content: Buffer;
  evidencePath: string;
  evidence: ReadonlyMap<string, Buffer>;
  allowedBarrelPaths: ReadonlySet<string>;
  exportedNamesByPath: Map<string, Set<string>>;
  visiting: Set<string>;
  requestedNames?: ReadonlySet<string>;
}): Set<string> {
  const cached =
    input.requestedNames === undefined ? input.exportedNamesByPath.get(input.evidencePath) : undefined;
  if (cached !== undefined) return cached;
  if (input.visiting.has(input.evidencePath)) {
    throw designMappingError(
      `public barrels contain a cyclic named re-export: ${input.evidencePath}`,
    );
  }
  input.visiting.add(input.evidencePath);

  let program: ReturnType<typeof parse>["program"];
  try {
    program = parse(input.content.toString("utf8"), {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    }).program;
  } catch {
    throw designMappingError(
      `public barrel is not parseable JavaScript/TypeScript: ${input.evidencePath}`,
    );
  }
  const runtimeLocals = new Set<string>();
  for (const rawStatement of program.body) {
    const statement = rawStatement as unknown as Record<string, unknown>;
    const declaration =
      statement["type"] === "ExportNamedDeclaration"
        ? asRecord(statement["declaration"])
        : statement;
    collectRuntimeDeclarationNames(declaration, runtimeLocals);
  }

  const names = new Set<string>();
  for (const rawStatement of program.body) {
    const statement = rawStatement as unknown as Record<string, unknown>;
    if (statement["type"] === "ExportAllDeclaration") {
      throw designMappingError(
        `public barrel ${input.evidencePath} must use bounded named exports, not export *`,
      );
    }
    if (statement["type"] !== "ExportNamedDeclaration") continue;
    if (statement["exportKind"] === "type") continue;
    const declaration = asRecord(statement["declaration"]);
    if (declaration !== undefined) {
      collectRuntimeDeclarationNames(declaration, names);
    }
    if (Array.isArray(statement["specifiers"])) {
      for (const rawSpecifier of statement["specifiers"]) {
        const specifier = asRecord(rawSpecifier);
        if (specifier?.["type"] !== "ExportSpecifier") continue;
        if (specifier["exportKind"] === "type") continue;
        const local = moduleExportName(specifier["local"]);
        const exported = moduleExportName(specifier["exported"]);
        if (local === undefined || exported === undefined) continue;
        if (input.requestedNames !== undefined && !input.requestedNames.has(exported)) continue;
        const source = moduleSourceValue(statement["source"]);
        if (source === undefined) {
          if (runtimeLocals.has(local)) names.add(exported);
          continue;
        }
        const targetPath = resolveDigestBoundReExportPath({
          evidencePath: input.evidencePath,
          source,
          allowedBarrelPaths: input.allowedBarrelPaths,
        });
        const targetContent = input.evidence.get(targetPath);
        if (targetContent === undefined) {
          throw designMappingError(
            `public barrel ${input.evidencePath} re-exports from missing digest-bound evidence ${targetPath}`,
          );
        }
        const targetExports = namedModuleExports({
          ...input,
          content: targetContent,
          evidencePath: targetPath,
          visiting: new Set(input.visiting),
          requestedNames: new Set([local]),
        });
        if (targetExports.has(local)) names.add(exported);
      }
    }
  }
  if (input.requestedNames === undefined) {
    input.exportedNamesByPath.set(input.evidencePath, names);
  }
  input.visiting.delete(input.evidencePath);
  return names;
}

function collectRuntimeDeclarationNames(
  declaration: Record<string, unknown> | undefined,
  names: Set<string>,
): void {
  if (declaration === undefined || declaration["declare"] === true) return;
  const declarationType = declaration["type"];
  if (
    (declarationType === "FunctionDeclaration" || declarationType === "ClassDeclaration") &&
    asRecord(declaration["id"])?.["type"] === "Identifier"
  ) {
    names.add(String(asRecord(declaration["id"])?.["name"]));
    return;
  }
  if (
    declarationType === "TSEnumDeclaration" &&
    declaration["const"] !== true &&
    asRecord(declaration["id"])?.["type"] === "Identifier"
  ) {
    names.add(String(asRecord(declaration["id"])?.["name"]));
    return;
  }
  if (declarationType === "VariableDeclaration" && Array.isArray(declaration["declarations"])) {
    for (const item of declaration["declarations"]) {
      collectBindingNames(asRecord(item)?.["id"], names);
    }
  }
}

function moduleExportName(rawName: unknown): string | undefined {
  const name = asRecord(rawName);
  if (name?.["type"] === "Identifier") return String(name["name"]);
  if (name?.["type"] === "StringLiteral") return String(name["value"]);
  return undefined;
}

function moduleSourceValue(rawSource: unknown): string | undefined {
  const source = asRecord(rawSource);
  return source?.["type"] === "StringLiteral" ? String(source["value"]) : undefined;
}

function resolveDigestBoundReExportPath(input: {
  evidencePath: string;
  source: string;
  allowedBarrelPaths: ReadonlySet<string>;
}): string {
  if (!input.source.startsWith("./") && !input.source.startsWith("../")) {
    throw designMappingError(
      `public barrel ${input.evidencePath} re-export must target digest-bound relative evidence`,
    );
  }
  const resolved = RepositoryPathSchema.parse(
    path.posix.normalize(path.posix.join(path.posix.dirname(input.evidencePath), input.source)),
  );
  const candidates = [
    resolved,
    `${resolved}.ts`,
    `${resolved}.tsx`,
    `${resolved}.js`,
    `${resolved}.jsx`,
    `${resolved}/index.ts`,
    `${resolved}/index.tsx`,
    `${resolved}/index.js`,
    `${resolved}/index.jsx`,
  ].filter((candidate) => input.allowedBarrelPaths.has(candidate));
  if (candidates.length !== 1) {
    throw designMappingError(
      `public barrel ${input.evidencePath} re-export target is not digest-bound evidence: ${resolved}`,
    );
  }
  return candidates[0]!;
}

function collectBindingNames(rawPattern: unknown, names: Set<string>): void {
  const pattern = asRecord(rawPattern);
  if (pattern === undefined) return;
  if (pattern["type"] === "Identifier") {
    names.add(String(pattern["name"]));
    return;
  }
  if (pattern["type"] === "AssignmentPattern" || pattern["type"] === "RestElement") {
    collectBindingNames(
      pattern[pattern["type"] === "AssignmentPattern" ? "left" : "argument"],
      names,
    );
    return;
  }
  if (pattern["type"] === "ObjectPattern" && Array.isArray(pattern["properties"])) {
    for (const property of pattern["properties"]) {
      const propertyRecord = asRecord(property);
      collectBindingNames(
        propertyRecord?.["type"] === "RestElement"
          ? propertyRecord["argument"]
          : propertyRecord?.["value"],
        names,
      );
    }
    return;
  }
  if (pattern["type"] === "ArrayPattern" && Array.isArray(pattern["elements"])) {
    for (const element of pattern["elements"]) collectBindingNames(element, names);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function canonicalPublicApiExports(
  entries: Array<z.infer<typeof FigmaPublicApiExportSchema>>,
): string {
  return JSON.stringify(
    [...entries]
      .sort((left, right) =>
        compareCanonicalStrings(
          `${left.figmaComponent}\u0000${left.nodeId}`,
          `${right.figmaComponent}\u0000${right.nodeId}`,
        ),
      )
      .map((entry) => ({
        ...entry,
        allowedProps: [...entry.allowedProps].sort(compareCanonicalStrings),
      })),
  );
}

function canonicalizeBindingValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(canonicalizeBindingValue)
      .sort((left, right) => compareCanonicalStrings(JSON.stringify(left), JSON.stringify(right)));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareCanonicalStrings(left, right))
        .map(([key, nested]) => [key, canonicalizeBindingValue(nested)]),
    );
  }
  return value;
}
