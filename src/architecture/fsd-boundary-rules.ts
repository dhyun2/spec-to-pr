import { compareFsdLayer, type FsdModuleRef } from "./fsd-layers.js";
import type { SourceImport } from "./import-parser.js";
import type { ArchitectureViolation } from "./architecture-report.js";

export function evaluateFsdImport(input: {
  index: number;
  source: FsdModuleRef;
  target: FsdModuleRef;
  sourceImport: SourceImport;
}): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];

  if (input.source.layer === undefined || input.target.layer === undefined) {
    return violations;
  }

  const direction = compareFsdLayer(input.source.layer, input.target.layer);

  if (direction === "upward") {
    violations.push({
      id: violationId(input.index, "UP"),
      kind: "fsd-upward-import",
      severity: "blocker",
      file: input.source.relativePath,
      line: input.sourceImport.line,
      column: input.sourceImport.column,
      importSpecifier: input.sourceImport.specifier,
      message: `${input.source.layer} must not import from higher layer ${input.target.layer}.`,
      recommendation:
        "Move shared dependency downward or expose required behavior through an allowed lower layer.",
    });
  }

  if (isCrossSliceDeepImport(input.source, input.target)) {
    violations.push({
      id: violationId(input.index, "DEEP"),
      kind: "cross-slice-deep-import",
      severity: "major",
      file: input.source.relativePath,
      line: input.sourceImport.line,
      column: input.sourceImport.column,
      importSpecifier: input.sourceImport.specifier,
      message: `Cross-slice import must use public API: ${input.target.relativePath}.`,
      recommendation: `Import from the slice public API instead of internal path. Target slice: ${input.target.slice}.`,
    });
  }

  return violations;
}

export function isCrossSliceDeepImport(source: FsdModuleRef, target: FsdModuleRef): boolean {
  if (source.layer === undefined || target.layer === undefined) {
    return false;
  }

  if (source.layer !== target.layer) {
    return false;
  }

  if (target.slice === undefined || source.slice === undefined) {
    return false;
  }

  if (source.slice === target.slice) {
    return false;
  }

  return !target.publicApi;
}

function violationId(index: number, suffix: string): string {
  return `ARCH-${String(index + 1).padStart(4, "0")}-${suffix}`;
}
