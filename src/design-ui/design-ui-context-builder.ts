import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { AgentResultSchema } from "../runtime/agent-result.js";
import { ArtifactIdSchema, EvidenceIdSchema, GapIdSchema, RunIdSchema } from "../runtime/ids.js";
import {
  DesignUiAllowedFilesSchema,
  DesignUiContextPackSchema,
  DesignUiForbiddenImportsSchema,
} from "./design-ui-context.js";
import type {
  DesignUiAllowedFiles,
  DesignUiContextPack,
  DesignUiForbiddenImports,
} from "./design-ui-context.js";

export const BuildDesignUiContextInputSchema = z
  .object({
    runId: RunIdSchema,
    changeName: z.string().trim().min(1),
    worktreePath: z.string().trim().min(1),
    contextRoot: z.string().trim().min(1),
    designContractArtifactId: ArtifactIdSchema,
    figmaInventoryArtifactId: ArtifactIdSchema.optional(),
    openSpecArtifactIds: z.array(ArtifactIdSchema).default([]),
    gherkinArtifactIds: z.array(ArtifactIdSchema).default([]),
    apiContractArtifactIds: z.array(ArtifactIdSchema).default([]),
    evidenceIds: z.array(EvidenceIdSchema).default([]),
    gapIds: z.array(GapIdSchema).default([]),
  })
  .strict();

export type BuildDesignUiContextInput = z.input<typeof BuildDesignUiContextInputSchema>;

export async function buildDesignUiContextPack(
  rawInput: BuildDesignUiContextInput,
): Promise<DesignUiContextPack> {
  const input = BuildDesignUiContextInputSchema.parse(rawInput);
  const root = path.join(input.contextRoot, "design-ui", input.runId);

  await mkdir(root, {
    recursive: true,
    mode: 0o700,
  });

  const files = {
    agentBrief: path.join(root, "agent-brief.md"),
    designContract: path.join(root, "design-contract.json"),
    figmaInventory: path.join(root, "figma-inventory.json"),
    figmaEvidenceSummary: path.join(root, "figma-evidence-summary.md"),
    openSpecSummary: path.join(root, "openspec-summary.md"),
    gherkinSummary: path.join(root, "gherkin-summary.md"),
    apiWrapperContract: path.join(root, "api-wrapper-contract.md"),
    fsdOwnershipPolicy: path.join(root, "fsd-ownership-policy.json"),
    allowedFiles: path.join(root, "allowed-files.json"),
    forbiddenImports: path.join(root, "forbidden-imports.json"),
    implementationPlanTemplate: path.join(root, "implementation-plan.template.md"),
    resultSchema: path.join(root, "result.schema.json"),
  };

  const allowedFiles = createAllowedFilesPolicy();
  const forbiddenImports = createForbiddenImportsPolicy();

  await writeFile(files.agentBrief, renderAgentBrief(input), "utf8");
  await writeFile(
    files.designContract,
    renderPlaceholderJson("designContractArtifactId", input.designContractArtifactId),
    "utf8",
  );
  await writeFile(
    files.figmaInventory,
    renderPlaceholderJson("figmaInventoryArtifactId", input.figmaInventoryArtifactId ?? null),
    "utf8",
  );
  await writeFile(files.figmaEvidenceSummary, renderFigmaEvidenceSummary(input), "utf8");
  await writeFile(files.openSpecSummary, renderOpenSpecSummary(input), "utf8");
  await writeFile(files.gherkinSummary, renderGherkinSummary(input), "utf8");
  await writeFile(files.apiWrapperContract, renderApiWrapperContract(input), "utf8");
  await writeFile(
    files.fsdOwnershipPolicy,
    `${JSON.stringify(createFsdOwnershipPolicy(), null, 2)}\n`,
    "utf8",
  );
  await writeFile(files.allowedFiles, `${JSON.stringify(allowedFiles, null, 2)}\n`, "utf8");
  await writeFile(files.forbiddenImports, `${JSON.stringify(forbiddenImports, null, 2)}\n`, "utf8");
  await writeFile(files.implementationPlanTemplate, renderImplementationPlanTemplate(), "utf8");

  const resultJsonSchema = z.toJSONSchema(AgentResultSchema, {
    target: "draft-2020-12",
  });

  await writeFile(files.resultSchema, `${JSON.stringify(resultJsonSchema, null, 2)}\n`, "utf8");

  return DesignUiContextPackSchema.parse({
    runId: input.runId,
    changeName: input.changeName,
    agent: "design-ui",
    worktreePath: input.worktreePath,
    contextRoot: root,
    designContractArtifactId: input.designContractArtifactId,
    ...(input.figmaInventoryArtifactId === undefined
      ? {}
      : { figmaInventoryArtifactId: input.figmaInventoryArtifactId }),
    openSpecArtifactIds: input.openSpecArtifactIds,
    gherkinArtifactIds: input.gherkinArtifactIds,
    apiContractArtifactIds: input.apiContractArtifactIds,
    evidenceIds: input.evidenceIds,
    gapIds: input.gapIds,
    files,
  });
}

export function createAllowedFilesPolicy(): DesignUiAllowedFiles {
  return DesignUiAllowedFilesSchema.parse({
    writableGlobs: [
      "src/pages/**/ui/**",
      "src/widgets/**/ui/**",
      "src/features/**/ui/**",
      "src/features/**/model/**",
      "src/features/**/lib/**",
      "src/entities/**/ui/**",
      "src/**/*.test.tsx",
      "src/**/*.stories.tsx",
      "tests/**/*.test.tsx",
    ],
    readonlyGlobs: [
      "openspec/**",
      "src/shared/api/generated/**",
      "src/shared/api/**",
      "src/entities/**/api/**",
      "src/features/**/api/**",
    ],
    forbiddenGlobs: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
      ".git/**",
      "src/shared/api/generated/**",
      "openspec/**",
    ],
  });
}

export function createForbiddenImportsPolicy(): DesignUiForbiddenImports {
  return DesignUiForbiddenImportsSchema.parse({
    forbiddenPatterns: [
      String.raw`from ['"]@?/?.*shared/api/generated`,
      String.raw`from ['"]@?/?.*httpClient`,
      String.raw`\bfetch\s*\(`,
      String.raw`from ['"]@?/?.*openapi`,
    ],
    message:
      "UI code must not call fetch, httpClient, OpenAPI sources, or generated clients directly. Use feature/entity API wrappers.",
  });
}

function createFsdOwnershipPolicy() {
  return {
    layers: ["pages", "widgets", "features", "entities", "shared"],
    writePolicy: {
      pages: "ui-only",
      widgets: "ui-only",
      features: ["ui", "model", "lib"],
      entities: ["ui"],
      shared: "requires-explicit-allow",
    },
    importDirection: ["pages", "widgets", "features", "entities", "shared"],
    publicApiRequired: true,
  };
}

function renderAgentBrief(input: z.infer<typeof BuildDesignUiContextInputSchema>): string {
  return `# Design/UI Agent Brief

Run: ${input.runId}
Change: ${input.changeName}

You are the Design/UI Agent.

You must implement UI only from the provided design contract, Figma inventory, OpenSpec summary, Gherkin summary, and API wrapper contract.

Do not modify files outside allowed policy.
Do not import generated API clients or call fetch directly from UI.
Do not claim visual regression passed.

`;
}

function renderPlaceholderJson(key: string, value: unknown): string {
  return `${JSON.stringify({ [key]: value }, null, 2)}\n`;
}

function renderFigmaEvidenceSummary(
  input: z.infer<typeof BuildDesignUiContextInputSchema>,
): string {
  return `# Figma Evidence Summary

Figma inventory artifact: ${input.figmaInventoryArtifactId ?? "not provided"}

Evidence IDs:

${input.evidenceIds.map((id) => `- ${id}`).join("\n") || "- none"}

`;
}

function renderOpenSpecSummary(input: z.infer<typeof BuildDesignUiContextInputSchema>): string {
  return `# OpenSpec Summary

OpenSpec artifact IDs:

${input.openSpecArtifactIds.map((id) => `- ${id}`).join("\n") || "- none"}

`;
}

function renderGherkinSummary(input: z.infer<typeof BuildDesignUiContextInputSchema>): string {
  return `# Gherkin Summary

Gherkin/Test Matrix artifact IDs:

${input.gherkinArtifactIds.map((id) => `- ${id}`).join("\n") || "- none"}

`;
}

function renderApiWrapperContract(input: z.infer<typeof BuildDesignUiContextInputSchema>): string {
  return `# API Wrapper Contract

API contract artifact IDs:

${input.apiContractArtifactIds.map((id) => `- ${id}`).join("\n") || "- none"}

Rules:

- UI must call feature/entity API wrappers only.
- UI must not import generated clients.
- UI must not call fetch directly.

`;
}

function renderImplementationPlanTemplate(): string {
  return `# Design/UI Implementation Plan

## Target screens

- [ ] Identify screens from design contract

## FSD slices

- [ ] pages
- [ ] widgets
- [ ] features
- [ ] entities
- [ ] shared only if explicitly allowed

## UI states

- [ ] loading
- [ ] empty
- [ ] success
- [ ] error
- [ ] confirmation
- [ ] disabled

## Design-system usage

- [ ] components
- [ ] tokens
- [ ] typography
- [ ] icons/assets

## API boundary

- [ ] wrappers only
- [ ] no generated client direct import
- [ ] no direct fetch

## Tests / fixtures / stories

- [ ] component tests
- [ ] fixture routes
- [ ] stories

## Gaps / decisions

- [ ] record unresolved Figma gaps
- [ ] record implementation decisions

`;
}
