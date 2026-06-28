import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ApiContractAgentContextSchema,
  ApiContractContextFileSchema,
} from "./api-contract-agent-contracts.js";
import type {
  ApiContractAgentContext,
  ApiContractContextFile,
} from "./api-contract-agent-contracts.js";
import type { RunManifest } from "../run/index.js";
import { GitObjectIdSchema, IsoDateTimeSchema } from "../runtime/scalars.js";
import { sha256Digest } from "../source-registry/content-hash.js";

export type ApiContractContextBuildInput = {
  run: RunManifest;
  worktreePath: string;
  baseSha: string;
  outputRoot: string;
  preparedAt?: string;
};

export type ApiContractContextBuildResult = {
  context: ApiContractAgentContext;
  files: ApiContractContextFile[];
};

export const API_AGENT_ALLOWED_WRITE_GLOBS = [
  "packages/**/api-client/**",
  "apps/*/src/shared/api/**",
  "apps/*/src/entities/**/api/**",
  "apps/*/src/features/**/api/**",
  "apps/*/src/mocks/**",
  "apps/*/src/**/*.api.test.ts",
  "apps/*/src/**/*.contract.test.ts",
  "src/shared/api/generated/**",
  "src/entities/**/api/**",
  "src/features/**/api/**",
  "src/shared/api/mocks/**",
  "src/shared/api/__tests__/**",
  "tests/contract/**",
] as const;

export const API_AGENT_FORBIDDEN_WRITE_GLOBS = [
  "apps/*/src/pages/**",
  "apps/*/src/widgets/**",
  "apps/*/src/features/**/ui/**",
  "apps/*/src/**/*.stories.*",
  "apps/*/src/app/router/**",
  "src/pages/**",
  "src/widgets/**",
  "src/features/**/ui/**",
  "src/entities/**/ui/**",
  "src/app/router/**",
] as const;

export async function buildApiContractAgentContext(
  input: ApiContractContextBuildInput,
): Promise<ApiContractContextBuildResult> {
  const contextRoot = path.join(input.outputRoot, "api-contract");
  await mkdir(contextRoot, {
    recursive: true,
    mode: 0o700,
  });

  const openApiIntakeArtifacts = input.run.artifacts.filter(
    (artifact) => artifact.kind === "openapi-intake-report",
  );
  const apiPipelineArtifacts = input.run.artifacts.filter((artifact) =>
    ["api-contract-report", "generated-code"].includes(artifact.kind),
  );
  const traceabilityArtifacts = input.run.artifacts.filter((artifact) =>
    ["traceability-graph", "traceability-matrix", "requirement-graph"].includes(artifact.kind),
  );
  const testMatrixArtifacts = input.run.artifacts.filter((artifact) =>
    ["test-matrix", "gherkin"].includes(artifact.kind),
  );
  const apiEvidence = input.run.evidence.filter(
    (evidence) =>
      evidence.location.type === "json-pointer" ||
      evidence.metadata["openapiEvidenceKind"] !== undefined,
  );
  const apiGaps = input.run.gaps.filter((gap) => gap.category === "api");

  const files = [
    {
      name: "README.md",
      content: renderReadme(),
    },
    {
      name: "api-evidence.json",
      content: JSON.stringify(apiEvidence, null, 2),
    },
    {
      name: "api-gaps.json",
      content: JSON.stringify(apiGaps, null, 2),
    },
    {
      name: "api-artifacts.json",
      content: JSON.stringify(
        {
          openApiIntakeArtifacts,
          apiPipelineArtifacts,
          traceabilityArtifacts,
          testMatrixArtifacts,
        },
        null,
        2,
      ),
    },
    {
      name: "ownership-policy.json",
      content: JSON.stringify(
        {
          allowedWriteGlobs: API_AGENT_ALLOWED_WRITE_GLOBS,
          forbiddenWriteGlobs: API_AGENT_FORBIDDEN_WRITE_GLOBS,
        },
        null,
        2,
      ),
    },
    {
      name: "instructions.md",
      content: renderInstructions(),
    },
  ];

  const writtenFiles: ApiContractContextFile[] = [];

  for (const file of files) {
    const filePath = path.join(contextRoot, file.name);
    const content = `${file.content.trimEnd()}\n`;

    await writeFile(filePath, content, {
      encoding: "utf8",
      mode: 0o600,
    });

    writtenFiles.push(
      ApiContractContextFileSchema.parse({
        path: filePath,
        digest: sha256Digest(Buffer.from(content, "utf8")),
      }),
    );
  }

  const context = ApiContractAgentContextSchema.parse({
    runId: input.run.id,
    preparedAt: IsoDateTimeSchema.parse(input.preparedAt ?? new Date().toISOString()),
    projectRoot: input.run.projectRoot,
    worktreePath: input.worktreePath,
    baseSha: GitObjectIdSchema.parse(input.baseSha),
    contextPackPath: contextRoot,
    allowedWriteGlobs: API_AGENT_ALLOWED_WRITE_GLOBS,
    forbiddenWriteGlobs: API_AGENT_FORBIDDEN_WRITE_GLOBS,
    openApiIntakeArtifactIds: openApiIntakeArtifacts.map((artifact) => artifact.id),
    apiPipelineArtifactIds: apiPipelineArtifacts.map((artifact) => artifact.id),
    traceabilityArtifactIds: traceabilityArtifacts.map((artifact) => artifact.id),
    testMatrixArtifactIds: testMatrixArtifacts.map((artifact) => artifact.id),
    evidenceIds: apiEvidence.map((evidence) => evidence.id),
    gapIds: apiGaps.map((gap) => gap.id),
    instructions: [
      "Use only documented OpenAPI operations.",
      "Do not invent endpoints.",
      "Do not edit UI files.",
      "Do not manually edit generated code unless project policy allows it.",
      "Record gaps when API evidence is missing.",
    ],
  });

  const contextJson = `${JSON.stringify(context, null, 2)}\n`;
  const contextPath = path.join(contextRoot, "context.json");
  await writeFile(contextPath, contextJson, {
    encoding: "utf8",
    mode: 0o600,
  });
  writtenFiles.push(
    ApiContractContextFileSchema.parse({
      path: contextPath,
      digest: sha256Digest(Buffer.from(contextJson, "utf8")),
    }),
  );

  return {
    context,
    files: writtenFiles,
  };
}

function renderReadme(): string {
  return `
# API Contract Agent Context Pack

This context pack is for the API Contract Agent.

Read these files before making changes:

1. instructions.md
2. ownership-policy.json
3. api-evidence.json
4. api-gaps.json
5. api-artifacts.json
6. context.json

The API Contract Agent must not invent endpoints or modify UI implementation files.
`;
}

function renderInstructions(): string {
  return `
# API Contract Agent Instructions

You are responsible for API contract implementation only.

You may work on:

- generated API client verification
- API schemas
- feature/entity API wrappers
- API mappers
- API mocks
- API contract tests
- source guard tests

You must not:

- implement UI components
- edit pages/widgets/features UI
- invent undocumented endpoints
- hide API gaps
- mark failed checks as passed

If OpenAPI evidence is missing, record or preserve an API gap.
`;
}
