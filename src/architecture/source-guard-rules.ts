import type { ArchitectureViolation } from "./architecture-report.js";
import type { FsdModuleRef } from "./fsd-layers.js";
import type { SourceImport } from "./import-parser.js";

export function evaluateSourceGuards(input: {
  index: number;
  source: FsdModuleRef;
  sourceImport: SourceImport;
  sourceContent: string;
}): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];

  if (isUiModule(input.source)) {
    if (isGeneratedClientImport(input.sourceImport.specifier)) {
      violations.push({
        id: violationId(input.index, "GEN"),
        kind: "ui-direct-generated-client",
        severity: "blocker",
        file: input.source.relativePath,
        line: input.sourceImport.line,
        column: input.sourceImport.column,
        importSpecifier: input.sourceImport.specifier,
        message: "UI modules must not import generated API clients directly.",
        recommendation: "Use feature/entity API wrapper instead.",
      });
    }

    if (isHttpClientImport(input.sourceImport.specifier)) {
      violations.push({
        id: violationId(input.index, "HTTP"),
        kind: "ui-direct-http-client",
        severity: "blocker",
        file: input.source.relativePath,
        line: input.sourceImport.line,
        column: input.sourceImport.column,
        importSpecifier: input.sourceImport.specifier,
        message: "UI modules must not import httpClient directly.",
        recommendation: "Use feature/entity API wrapper instead.",
      });
    }
  }

  if (
    isGeneratedClientImport(input.sourceImport.specifier) &&
    !isAllowedGeneratedClientZone(input.source)
  ) {
    violations.push({
      id: violationId(input.index, "GENZONE"),
      kind: "generated-client-outside-api-wrapper",
      severity: "major",
      file: input.source.relativePath,
      line: input.sourceImport.line,
      column: input.sourceImport.column,
      importSpecifier: input.sourceImport.specifier,
      message: "Generated API clients must be used only inside allowed API wrapper zones.",
      recommendation: "Move generated client usage to feature/entity/shared api wrapper.",
    });
  }

  if (isUiModule(input.source) && containsDirectFetch(input.sourceContent)) {
    violations.push({
      id: violationId(input.index, "FETCH"),
      kind: "ui-direct-fetch",
      severity: "blocker",
      file: input.source.relativePath,
      message: "UI module appears to call fetch() directly.",
      recommendation: "Move network access behind feature/entity API wrapper.",
    });
  }

  return violations;
}

function isUiModule(source: FsdModuleRef): boolean {
  return source.segment === "ui" || /\/ui\//.test(source.relativePath);
}

function isGeneratedClientImport(specifier: string): boolean {
  return (
    specifier.includes("/generated/") ||
    specifier.includes("@/shared/api/generated") ||
    specifier.includes("shared/api/generated")
  );
}

function isHttpClientImport(specifier: string): boolean {
  return (
    specifier.includes("http-client") ||
    specifier.includes("httpClient") ||
    specifier.includes("/shared/api/client") ||
    specifier.includes("/shared/api/http")
  );
}

function isAllowedGeneratedClientZone(source: FsdModuleRef): boolean {
  if (source.layer === "shared" && source.segment === "api") {
    return true;
  }

  if ((source.layer === "features" || source.layer === "entities") && source.segment === "api") {
    return true;
  }

  return false;
}

function containsDirectFetch(content: string): boolean {
  return /\bfetch\s*\(/.test(content);
}

function violationId(index: number, suffix: string): string {
  return `ARCH-${String(index + 1).padStart(4, "0")}-${suffix}`;
}
