import path from "node:path";

import {
  FsdLayerSchema,
  FsdModuleRefSchema,
  FsdSegmentSchema,
  isFsdLayer,
  isPublicApiPath,
} from "./fsd-layers.js";
import type { FsdModuleRef } from "./fsd-layers.js";

export type ProjectBoundaryOptions = {
  projectRoot: string;
  sourceRoots?: string[];
  aliases?: Record<string, string>;
};

const DEFAULT_SOURCE_ROOTS = ["src", "apps/web/src", "apps/rangepro/src"];

export function classifyModulePath(input: {
  absolutePath: string;
  projectRoot: string;
  sourceRoots?: string[];
}): FsdModuleRef {
  const relativePath = toPosix(path.relative(input.projectRoot, input.absolutePath));
  const sourceRoots = input.sourceRoots ?? DEFAULT_SOURCE_ROOTS;

  for (const sourceRoot of sourceRoots) {
    const normalizedSourceRoot = toPosix(sourceRoot).replace(/\/$/, "");

    if (
      relativePath === normalizedSourceRoot ||
      relativePath.startsWith(`${normalizedSourceRoot}/`)
    ) {
      const insideSourceRoot = relativePath.slice(normalizedSourceRoot.length).replace(/^\//, "");

      return classifyInsideSourceRoot({
        absolutePath: input.absolutePath,
        relativePath,
        insideSourceRoot,
      });
    }
  }

  return FsdModuleRefSchema.parse({
    absolutePath: input.absolutePath,
    relativePath,
    publicApi: false,
  });
}

export function resolveImportTarget(input: {
  sourceFile: string;
  importSpecifier: string;
  projectRoot: string;
  sourceRoots?: string[];
  aliases?: Record<string, string>;
}): string | undefined {
  const specifier = input.importSpecifier;

  if (specifier.startsWith(".")) {
    return path.resolve(path.dirname(input.sourceFile), specifier);
  }

  const aliasResolved = resolveAlias({
    importSpecifier: specifier,
    projectRoot: input.projectRoot,
    ...(input.aliases === undefined ? {} : { aliases: input.aliases }),
  });

  if (aliasResolved !== undefined) {
    return aliasResolved;
  }

  if (specifier.startsWith("@/")) {
    return path.join(input.projectRoot, "src", specifier.slice(2));
  }

  return undefined;
}

function classifyInsideSourceRoot(input: {
  absolutePath: string;
  relativePath: string;
  insideSourceRoot: string;
}): FsdModuleRef {
  const parts = input.insideSourceRoot.split("/").filter(Boolean);
  const layerCandidate = parts[0];

  if (layerCandidate === undefined || !isFsdLayer(layerCandidate)) {
    return FsdModuleRefSchema.parse({
      absolutePath: input.absolutePath,
      relativePath: input.relativePath,
      publicApi: isPublicApiPath(input.relativePath),
    });
  }

  const layer = FsdLayerSchema.parse(layerCandidate);

  if (layer === "app") {
    return FsdModuleRefSchema.parse({
      absolutePath: input.absolutePath,
      relativePath: input.relativePath,
      layer,
      segment: FsdSegmentSchema.safeParse(parts[1]).success
        ? FsdSegmentSchema.parse(parts[1])
        : "unknown",
      publicApi: isPublicApiPath(input.relativePath),
    });
  }

  if (layer === "shared") {
    return FsdModuleRefSchema.parse({
      absolutePath: input.absolutePath,
      relativePath: input.relativePath,
      layer,
      slice: parts[1],
      segment: FsdSegmentSchema.safeParse(parts[1]).success
        ? FsdSegmentSchema.parse(parts[1])
        : "unknown",
      publicApi: isPublicApiPath(input.relativePath),
    });
  }

  return FsdModuleRefSchema.parse({
    absolutePath: input.absolutePath,
    relativePath: input.relativePath,
    layer,
    slice: parts[1],
    segment: FsdSegmentSchema.safeParse(parts[2]).success
      ? FsdSegmentSchema.parse(parts[2])
      : "unknown",
    publicApi: isPublicApiPath(input.relativePath),
  });
}

function resolveAlias(input: {
  importSpecifier: string;
  projectRoot: string;
  aliases?: Record<string, string>;
}): string | undefined {
  if (input.aliases === undefined) {
    return undefined;
  }

  for (const [alias, target] of Object.entries(input.aliases)) {
    const normalizedAlias = alias.replace(/\*$/, "");
    const normalizedTarget = target.replace(/\*$/, "");

    if (input.importSpecifier.startsWith(normalizedAlias)) {
      return path.join(
        input.projectRoot,
        normalizedTarget,
        input.importSpecifier.slice(normalizedAlias.length),
      );
    }
  }

  return undefined;
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}
