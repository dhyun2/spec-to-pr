import { z } from "zod";

import type { OpenApiInventory, OpenApiOperationInventoryItem } from "./openapi-inventory.js";
import type { ParsedOpenApiDocument } from "./openapi-parser.js";

export const OpenApiGapCandidateCodeSchema = z.enum([
  "unsupported-openapi-version",
  "missing-paths",
  "missing-operation-id",
  "duplicate-operation-id",
  "missing-success-response",
  "missing-error-response",
  "unknown-security-scheme",
  "empty-components-schemas",
  "remote-ref-not-resolved",
  "prompt-injection-like-description",
]);

export const OpenApiGapCandidateSchema = z
  .object({
    code: OpenApiGapCandidateCodeSchema,
    severity: z.enum(["blocker", "major", "minor", "info"]),
    category: z.enum(["api", "security"]),
    title: z.string().min(1),
    expected: z.string().min(1),
    observed: z.string().min(1),
    impact: z.string().min(1),
    pointer: z.string().min(1).optional(),
    operationPointer: z.string().min(1).optional(),
  })
  .strict();

export type OpenApiGapCandidate = z.infer<typeof OpenApiGapCandidateSchema>;

const PROMPT_INJECTION_LIKE_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions?/i,
  /disregard\s+(all\s+)?previous\s+instructions?/i,
  /system\s+prompt/i,
  /developer\s+message/i,
  /reveal\s+(the\s+)?secret/i,
  /print\s+(all\s+)?environment\s+variables/i,
  /api\s*key/i,
];

export function detectOpenApiGapCandidates(input: {
  parsed: ParsedOpenApiDocument;
  inventory: OpenApiInventory;
}): OpenApiGapCandidate[] {
  const gaps: OpenApiGapCandidate[] = [];

  if (input.parsed.versionKind === "swagger-2.0" || input.parsed.versionKind === "unknown") {
    gaps.push(
      gap({
        code: "unsupported-openapi-version",
        severity: "blocker",
        category: "api",
        title: "Unsupported OpenAPI version",
        expected: "OpenAPI source should use OpenAPI 3.0.x or 3.1.x for this plugin stage.",
        observed: `Detected version kind: ${input.parsed.versionKind}`,
        impact: "API generation and contract analysis may produce incorrect results.",
        pointer: "/openapi",
      }),
    );
  }

  if (input.inventory.operationCount === 0) {
    gaps.push(
      gap({
        code: "missing-paths",
        severity: "blocker",
        category: "api",
        title: "No OpenAPI operations found",
        expected: "OpenAPI document should define operations under paths.",
        observed: "No HTTP operations were found.",
        impact: "API wrapper and contract generation cannot proceed.",
        pointer: "/paths",
      }),
    );
  }

  if (input.inventory.schemaCount === 0) {
    gaps.push(
      gap({
        code: "empty-components-schemas",
        severity: "minor",
        category: "api",
        title: "No component schemas found",
        expected: "Reusable schemas should be declared under components.schemas when applicable.",
        observed: "components.schemas is empty or missing.",
        impact:
          "Generated types may be incomplete or operation-local schemas may be harder to reuse.",
        pointer: "/components/schemas",
      }),
    );
  }

  gaps.push(...detectOperationGaps(input.inventory.operations));
  gaps.push(...detectDuplicateOperationIds(input.inventory.operations));
  gaps.push(...detectSecurityGaps(input.inventory));
  gaps.push(...detectRemoteRefs(input.inventory));
  gaps.push(...detectPromptInjectionLikeDescriptions(input.inventory.operations));

  return gaps;
}

function detectOperationGaps(operations: OpenApiOperationInventoryItem[]): OpenApiGapCandidate[] {
  const gaps: OpenApiGapCandidate[] = [];

  for (const operation of operations) {
    if (operation.operationId === undefined) {
      gaps.push(
        gap({
          code: "missing-operation-id",
          severity: "major",
          category: "api",
          title: "Operation is missing operationId",
          expected: "Each operation should define a stable operationId.",
          observed: `${operation.method.toUpperCase()} ${operation.path} has no operationId.`,
          impact: "Generated client method names and feature wrappers may become unstable.",
          pointer: `${operation.pointer}/operationId`,
          operationPointer: operation.pointer,
        }),
      );
    }

    if (!operation.responseStatuses.some((status) => isSuccessStatus(status))) {
      gaps.push(
        gap({
          code: "missing-success-response",
          severity: "blocker",
          category: "api",
          title: "Operation is missing success response",
          expected: "Each operation should define at least one 2xx response.",
          observed: `${operation.method.toUpperCase()} ${operation.path} responses: ${operation.responseStatuses.join(", ") || "none"}`,
          impact: "Client generation cannot infer a successful response contract.",
          pointer: `${operation.pointer}/responses`,
          operationPointer: operation.pointer,
        }),
      );
    }

    if (!operation.responseStatuses.some((status) => isErrorStatus(status))) {
      gaps.push(
        gap({
          code: "missing-error-response",
          severity: "minor",
          category: "api",
          title: "Operation has no error response contract",
          expected: "Operations should define relevant 4xx or 5xx error responses.",
          observed: `${operation.method.toUpperCase()} ${operation.path} has no 4xx/5xx responses.`,
          impact: "UI error states and contract tests may need assumptions.",
          pointer: `${operation.pointer}/responses`,
          operationPointer: operation.pointer,
        }),
      );
    }
  }

  return gaps;
}

function detectDuplicateOperationIds(
  operations: OpenApiOperationInventoryItem[],
): OpenApiGapCandidate[] {
  const byId = new Map<string, OpenApiOperationInventoryItem[]>();

  for (const operation of operations) {
    if (operation.operationId === undefined) {
      continue;
    }

    byId.set(operation.operationId, [...(byId.get(operation.operationId) ?? []), operation]);
  }

  const gaps: OpenApiGapCandidate[] = [];

  for (const [operationId, matches] of byId.entries()) {
    if (matches.length <= 1) {
      continue;
    }

    gaps.push(
      gap({
        code: "duplicate-operation-id",
        severity: "major",
        category: "api",
        title: "Duplicate operationId",
        expected: "operationId values should be unique.",
        observed: `${operationId} is used by ${matches
          .map((item) => `${item.method.toUpperCase()} ${item.path}`)
          .join(", ")}.`,
        impact: "Generated clients may overwrite methods or create unstable names.",
        pointer: matches[0]!.pointer,
        operationPointer: matches[0]!.pointer,
      }),
    );
  }

  return gaps;
}

function detectSecurityGaps(inventory: OpenApiInventory): OpenApiGapCandidate[] {
  const known = new Set(inventory.securitySchemes.map((scheme) => scheme.name));
  const gaps: OpenApiGapCandidate[] = [];

  for (const operation of inventory.operations) {
    for (const schemeName of operation.securitySchemeNames) {
      if (!known.has(schemeName)) {
        gaps.push(
          gap({
            code: "unknown-security-scheme",
            severity: "major",
            category: "security",
            title: "Operation references unknown security scheme",
            expected: "Security requirements should reference components.securitySchemes entries.",
            observed: `${operation.method.toUpperCase()} ${operation.path} references ${schemeName}, but it is not declared.`,
            impact: "API authentication behavior cannot be verified.",
            pointer: `${operation.pointer}/security`,
            operationPointer: operation.pointer,
          }),
        );
      }
    }
  }

  return gaps;
}

function detectRemoteRefs(inventory: OpenApiInventory): OpenApiGapCandidate[] {
  return inventory.refs
    .filter((item) => !item.ref.startsWith("#/"))
    .map((item) =>
      gap({
        code: "remote-ref-not-resolved",
        severity: "minor",
        category: "api",
        title: "Remote or external $ref not resolved in intake",
        expected: "Task 12 only inventories local JSON Pointer references.",
        observed: `External reference found: ${item.ref}`,
        impact: "Remote reference resolution requires network and trust policy and is deferred.",
        pointer: item.pointer,
      }),
    );
}

function detectPromptInjectionLikeDescriptions(
  operations: OpenApiOperationInventoryItem[],
): OpenApiGapCandidate[] {
  const gaps: OpenApiGapCandidate[] = [];

  for (const operation of operations) {
    const combinedText = [operation.summary].filter(Boolean).join("\n");

    if (PROMPT_INJECTION_LIKE_PATTERNS.some((pattern) => pattern.test(combinedText))) {
      gaps.push(
        gap({
          code: "prompt-injection-like-description",
          severity: "blocker",
          category: "security",
          title: "Prompt-injection-like text in OpenAPI operation",
          expected:
            "OpenAPI descriptions should be treated as untrusted data and must not instruct the automation system.",
          observed: `${operation.method.toUpperCase()} ${operation.path}: ${combinedText}`,
          impact:
            "The content resembles an instruction aimed at the model or tool environment rather than API documentation.",
          pointer: operation.pointer,
          operationPointer: operation.pointer,
        }),
      );
    }
  }

  return gaps;
}

function isSuccessStatus(status: string): boolean {
  return /^2\d\d$/.test(status) || status === "default";
}

function isErrorStatus(status: string): boolean {
  return /^[45]\d\d$/.test(status) || status === "default";
}

function gap(input: OpenApiGapCandidate): OpenApiGapCandidate {
  return OpenApiGapCandidateSchema.parse(input);
}
