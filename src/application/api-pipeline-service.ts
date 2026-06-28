import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import {
  ApiPipelineModeSchema,
  ApiPipelineReportSchema,
  discoverApiGenerator,
  generateContractTestSkeleton,
  generateFeatureWrappers,
  generateMswHandlers,
  generateSourceGuardTest,
  generateTypescriptTypes,
  generateZodSchemas,
  renderApiPipelineReportMarkdown,
} from "../api-pipeline/index.js";
import type {
  ApiGeneratedFile,
  ApiOperationPipelineItem,
} from "../api-pipeline/index.js";
import { OpenApiInventorySchema } from "../openapi/openapi-inventory.js";
import type {
  OpenApiInventory,
  OpenApiOperationInventoryItem,
} from "../openapi/openapi-inventory.js";
import { RunManifestSchema, summarizeRun } from "../run/index.js";
import { ArtifactRefSchema } from "../runtime/artifact.js";
import { createArtifactId } from "../runtime/id-factory.js";
import { ArtifactIdSchema, RunIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema, Sha256DigestSchema } from "../runtime/scalars.js";
import { sha256Digest } from "../source-registry/content-hash.js";
import type { RunStore } from "../store/run-store.js";

export const GenerateApiPipelineInputSchema = z
  .object({
    runId: RunIdSchema,
    openApiIntakeArtifactId: ArtifactIdSchema,
    sourceKey: z.string().trim().min(1),
    generatedRoot: z.string().trim().min(1).optional(),
    wrapperRoot: z.string().trim().min(1).optional(),
    preferredCommand: z.array(z.string().trim().min(1)).optional(),
    force: z.boolean().default(false),
  })
  .strict();

export const GenerateApiPipelineResultSchema = z
  .object({
    duplicate: z.boolean(),
    run: z.custom<ReturnType<typeof summarizeRun>>(),
    sourceKey: z.string(),
    mode: ApiPipelineModeSchema,
    generatedFiles: z.array(z.string()),
    reportArtifactId: ArtifactIdSchema.optional(),
    warnings: z.array(z.string()),
  })
  .strict();

type PipelineReportBlob = {
  mediaType: string;
  content: string;
  format: string;
  label: string;
};

export class ApiPipelineService {
  public constructor(
    private readonly runStore: RunStore,
    private readonly artifactStore: ArtifactBlobStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async generate(rawInput: unknown) {
    const input = GenerateApiPipelineInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());

    const openApiArtifact = run.artifacts.find(
      (artifact) => artifact.id === input.openApiIntakeArtifactId,
    );

    if (openApiArtifact === undefined) {
      throw new Error(`OpenAPI intake artifact not found: ${input.openApiIntakeArtifactId}`);
    }

    if (openApiArtifact.kind !== "openapi-intake-report") {
      throw new Error(`Artifact is not an OpenAPI intake report: ${openApiArtifact.id}`);
    }

    const existingReport = run.artifacts.find(
      (artifact) =>
        artifact.kind === "api-contract-report" &&
        artifact.metadata["adapter"] === "api-pipeline-v1" &&
        artifact.metadata["openApiIntakeArtifactId"] === input.openApiIntakeArtifactId &&
        artifact.metadata["sourceKey"] === input.sourceKey &&
        artifact.metadata["format"] === "json",
    );

    if (existingReport !== undefined && !input.force) {
      return GenerateApiPipelineResultSchema.parse({
        duplicate: true,
        run: summarizeRun(run),
        sourceKey: input.sourceKey,
        mode: ApiPipelineModeSchema.parse(existingReport.metadata["mode"]),
        generatedFiles: [],
        reportArtifactId: existingReport.id,
        warnings: [],
      });
    }

    const inventory = await this.readOpenApiInventory(openApiArtifact.digest);
    const sourceDigest = optionalSha256(openApiArtifact.metadata["sourceDigest"]);

    const plan = await discoverApiGenerator({
      projectRoot: run.projectRoot,
      sourceKey: input.sourceKey,
      ...(input.generatedRoot === undefined ? {} : { generatedRoot: input.generatedRoot }),
      ...(input.wrapperRoot === undefined ? {} : { wrapperRoot: input.wrapperRoot }),
      ...(input.preferredCommand === undefined ? {} : { preferredCommand: input.preferredCommand }),
    });

    const generatedFiles: ApiGeneratedFile[] = [];
    const warnings: string[] = [];
    const schemas = await this.extractSchemas({
      runArtifacts: run.artifacts,
      sourceDigest,
      inventory,
    });

    if (plan.mode === "fallback-generator") {
      const tsResult = generateTypescriptTypes({ schemas });
      const zodResult = generateZodSchemas({ schemas });

      warnings.push(...tsResult.warnings, ...zodResult.warnings);

      await this.writeProjectFile({
        projectRoot: run.projectRoot,
        relativePath: `${plan.generatedRoot}/types.ts`,
        content: tsResult.content,
        force: input.force,
        generatedFiles,
        kind: "typescript-types",
      });

      await this.writeProjectFile({
        projectRoot: run.projectRoot,
        relativePath: `${plan.generatedRoot}/schemas.ts`,
        content: zodResult.content,
        force: input.force,
        generatedFiles,
        kind: "zod-schemas",
      });

      await this.writeProjectFile({
        projectRoot: run.projectRoot,
        relativePath: `${plan.generatedRoot}/client.ts`,
        content: renderFallbackClient(input.sourceKey),
        force: input.force,
        generatedFiles,
        kind: "api-client",
      });

      await this.writeProjectFile({
        projectRoot: run.projectRoot,
        relativePath: `${plan.generatedRoot}/index.ts`,
        content: `export * from "./types";\nexport * from "./schemas";\nexport * from "./client";\n`,
        force: input.force,
        generatedFiles,
        kind: "api-client",
      });
    } else {
      warnings.push(
        `Existing generator ${plan.generatorName} was detected; command execution is deferred to the project command policy.`,
      );
    }

    const wrappers = generateFeatureWrappers({
      sourceKey: input.sourceKey,
      wrapperRoot: plan.wrapperRoot,
      operations: inventory.operations,
    });
    const wrapperByOperationKey = new Map(wrappers.map((wrapper) => [wrapper.operationKey, wrapper]));

    for (const wrapper of wrappers) {
      await this.writeProjectFile({
        projectRoot: run.projectRoot,
        relativePath: wrapper.path,
        content: wrapper.content,
        force: input.force,
        generatedFiles,
        kind: "feature-wrapper",
      });
    }

    const mock = generateMswHandlers({
      sourceKey: input.sourceKey,
      operations: inventory.operations,
      outputPath: `src/shared/api/mocks/${input.sourceKey}.handlers.ts`,
    });

    await this.writeProjectFile({
      projectRoot: run.projectRoot,
      relativePath: mock.path,
      content: mock.content,
      force: input.force,
      generatedFiles,
      kind: "mock-handler",
    });

    const contractTest = generateContractTestSkeleton({
      sourceKey: input.sourceKey,
      operations: inventory.operations,
      outputPath: `src/shared/api/__tests__/${input.sourceKey}.contract.generated.test.ts`,
    });

    await this.writeProjectFile({
      projectRoot: run.projectRoot,
      relativePath: contractTest.path,
      content: contractTest.content,
      force: input.force,
      generatedFiles,
      kind: "contract-test",
    });

    const uiGlobs = [
      "src/pages/**/*.{ts,tsx}",
      "src/widgets/**/*.{ts,tsx}",
      "src/features/**/*.{ts,tsx}",
    ];
    const sourceGuard = generateSourceGuardTest({
      generatedImportPattern: `shared/api/generated/${input.sourceKey}`,
      uiGlobs,
      outputPath: "src/shared/api/__tests__/source-guards.generated.test.ts",
    });

    await this.writeProjectFile({
      projectRoot: run.projectRoot,
      relativePath: sourceGuard.path,
      content: sourceGuard.content,
      force: input.force,
      generatedFiles,
      kind: "source-guard-test",
    });

    const operationItems = inventory.operations.map((operation) =>
      operationPipelineItem(operation, wrapperByOperationKey.get(operationKey(operation))),
    );

    const baseReport = ApiPipelineReportSchema.parse({
      adapter: "api-pipeline-v1",
      runId: run.id,
      sourceKey: input.sourceKey,
      ...(sourceDigest === undefined ? {} : { openApiSourceDigest: sourceDigest }),
      openApiIntakeArtifactId: openApiArtifact.id,
      mode: plan.mode,
      generator: plan,
      operationCount: inventory.operationCount,
      generatedOperationCount: operationItems.filter((item) => item.status === "generated").length,
      skippedOperationCount: operationItems.filter((item) => item.status === "skipped").length,
      blockedOperationCount: operationItems.filter((item) => item.status === "blocked").length,
      operations: operationItems,
      generatedFiles,
      warnings,
      gapIds: [],
      artifactIds: [],
      generatedAt: timestamp,
    });

    const reportArtifacts = await this.writeReportArtifacts({
      report: baseReport,
      generatedFiles,
      sourceGuardReport: {
        adapter: "api-pipeline-v1",
        sourceKey: input.sourceKey,
        generatedImportPattern: `shared/api/generated/${input.sourceKey}`,
        uiGlobs,
        generatedAt: timestamp,
      },
      timestamp,
    });

    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, ...reportArtifacts],
    });

    await this.runStore.save(nextRun, run.revision);

    return GenerateApiPipelineResultSchema.parse({
      duplicate: false,
      run: summarizeRun(nextRun),
      sourceKey: input.sourceKey,
      mode: plan.mode,
      generatedFiles: generatedFiles.map((file) => file.path),
      reportArtifactId: reportArtifacts[0]?.id,
      warnings,
    });
  }

  private async readOpenApiInventory(rawDigest: string): Promise<OpenApiInventory> {
    const digest = Sha256DigestSchema.parse(rawDigest);
    const content = await this.artifactStore.readContent(digest);

    return OpenApiInventorySchema.parse(JSON.parse(content.toString("utf8")));
  }

  private async extractSchemas(input: {
    runArtifacts: Array<{ kind: string; digest: string; metadata: Record<string, unknown> }>;
    sourceDigest: string | undefined;
    inventory: OpenApiInventory;
  }): Promise<Record<string, Record<string, unknown>>> {
    const normalizedArtifact = input.runArtifacts.find(
      (artifact) =>
        artifact.kind === "openapi-normalized-document" &&
        input.sourceDigest !== undefined &&
        artifact.metadata["sourceDigest"] === input.sourceDigest,
    );

    if (normalizedArtifact !== undefined) {
      const content = await this.artifactStore.readContent(
        Sha256DigestSchema.parse(normalizedArtifact.digest),
      );
      const document = JSON.parse(content.toString("utf8"));
      const rawSchemas = rawComponentSchemas(document);

      if (Object.keys(rawSchemas).length > 0) {
        return rawSchemas;
      }
    }

    return Object.fromEntries(
      input.inventory.schemas.map((schema) => [
        schema.name,
        {
          type: schema.type ?? "object",
        },
      ]),
    );
  }

  private async writeProjectFile(input: {
    projectRoot: string;
    relativePath: string;
    content: string;
    force: boolean;
    generatedFiles: ApiGeneratedFile[];
    kind: ApiGeneratedFile["kind"];
  }): Promise<void> {
    const absolutePath = path.join(input.projectRoot, input.relativePath);
    const relative = path.relative(input.projectRoot, absolutePath);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Refusing to write outside project root: ${absolutePath}`);
    }

    await mkdir(path.dirname(absolutePath), {
      recursive: true,
      mode: 0o700,
    });

    let changed = true;

    try {
      const existing = await readFile(absolutePath, "utf8");

      if (existing === input.content) {
        changed = false;
      } else if (!input.force) {
        throw new Error(`File already exists with different content: ${input.relativePath}`);
      }
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code?: unknown }).code !== "ENOENT"
      ) {
        throw error;
      }
    }

    if (changed) {
      await writeFile(absolutePath, input.content, {
        encoding: "utf8",
        mode: 0o600,
      });
    }

    input.generatedFiles.push({
      kind: input.kind,
      path: input.relativePath,
      digest: sha256Digest(Buffer.from(input.content, "utf8")),
      changed,
    });
  }

  private async writeReportArtifacts(input: {
    report: z.infer<typeof ApiPipelineReportSchema>;
    generatedFiles: ApiGeneratedFile[];
    sourceGuardReport: Record<string, unknown>;
    timestamp: string;
  }) {
    const reportMarkdown = renderApiPipelineReportMarkdown(input.report);
    const blobs: PipelineReportBlob[] = [
      {
        mediaType: "application/json",
        content: `${JSON.stringify(input.report, null, 2)}\n`,
        format: "json",
        label: "api-pipeline-report-json",
      },
      {
        mediaType: "text/markdown",
        content: reportMarkdown,
        format: "markdown",
        label: "api-pipeline-report-md",
      },
      {
        mediaType: "application/json",
        content: `${JSON.stringify(
          {
            adapter: "api-pipeline-v1",
            sourceKey: input.report.sourceKey,
            generatedFiles: input.generatedFiles,
            generatedAt: input.timestamp,
          },
          null,
          2,
        )}\n`,
        format: "generated-file-manifest",
        label: "generated-file-manifest",
      },
      {
        mediaType: "application/json",
        content: `${JSON.stringify(input.sourceGuardReport, null, 2)}\n`,
        format: "source-guard-report",
        label: "source-guard-report",
      },
    ];

    const artifactRefs = [];

    for (const blob of blobs) {
      const stored = await this.artifactStore.writeBlob({
        content: Buffer.from(blob.content, "utf8"),
        mediaType: blob.mediaType,
        storedAt: input.timestamp,
        label: blob.label,
      });

      artifactRefs.push(
        ArtifactRefSchema.parse({
          id: createArtifactId(),
          kind: blob.format === "generated-file-manifest" ? "generated-code" : "api-contract-report",
          uri: stored.uri,
          mediaType: blob.mediaType,
          digest: stored.digest,
          producedBy: "orchestrator",
          evidenceIds: [],
          createdAt: input.timestamp,
          metadata: {
            adapter: "api-pipeline-v1",
            sourceKey: input.report.sourceKey,
            mode: input.report.mode,
            openApiIntakeArtifactId: input.report.openApiIntakeArtifactId,
            format: blob.format,
          },
        }),
      );
    }

    return artifactRefs;
  }
}

function operationPipelineItem(
  operation: OpenApiOperationInventoryItem,
  wrapper: { wrapperName: string; path: string } | undefined,
): ApiOperationPipelineItem {
  const base = {
    operationKey: operationKey(operation),
    method: operation.method,
    path: operation.path,
    ...(operation.operationId === undefined ? {} : { operationId: operation.operationId }),
    evidenceIds: [],
    generatedClientSymbol: "apiClient",
    gapIds: [],
  };

  if (wrapper === undefined) {
    return {
      ...base,
      status: "skipped",
      reason: "Operation has no operationId, so no wrapper skeleton was generated.",
    };
  }

  return {
    ...base,
    wrapperName: wrapper.wrapperName,
    wrapperPath: wrapper.path,
    status: "generated",
    reason: "Wrapper skeleton generated for documented operation.",
  };
}

function operationKey(operation: OpenApiOperationInventoryItem): string {
  return `${operation.method.toUpperCase()} ${operation.path}`;
}

function renderFallbackClient(sourceKey: string): string {
  return `// AUTO-GENERATED by spec-to-pr. DO NOT EDIT.
// Fallback API client skeleton for ${sourceKey}. Replace transport with the target project client.

export const apiClient = {
  async request(input: {
    method: string;
    path: string;
    params?: Record<string, unknown>;
    body?: unknown;
  }): Promise<unknown> {
    return {
      method: input.method,
      path: input.path,
      params: input.params,
      body: input.body,
    };
  },
};
`;
}

function optionalSha256(value: unknown): string | undefined {
  return typeof value === "string" ? Sha256DigestSchema.parse(value) : undefined;
}

function rawComponentSchemas(document: unknown): Record<string, Record<string, unknown>> {
  if (!isRecord(document)) {
    return {};
  }

  const components = document["components"];

  if (!isRecord(components)) {
    return {};
  }

  const schemas = components["schemas"];

  if (!isRecord(schemas)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(schemas).filter(
      (entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]),
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
