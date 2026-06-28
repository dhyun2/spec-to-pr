import { z } from "zod";

import { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import {
  deriveFigmaProviderPolicy,
  FigmaCapabilityReportSchema,
  FigmaProviderCapabilitySchema,
  inferProviderKind,
  normalizeFigmaToolName,
  type FigmaProviderCapability,
} from "../figma/figma-capability.js";
import { RunManifestSchema, summarizeRun } from "../run/index.js";
import { ArtifactRefSchema } from "../runtime/artifact.js";
import { GapSchema, type Gap } from "../runtime/gap.js";
import { createArtifactId, createGapId } from "../runtime/id-factory.js";
import { RunIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema } from "../runtime/scalars.js";
import type { RunStore } from "../store/run-store.js";

export const RecordFigmaMcpCapabilitiesInputSchema = z
  .object({
    runId: RunIdSchema,
    providers: z.array(
      z
        .object({
          providerId: z.string().trim().min(1),
          serverName: z.string().trim().min(1).optional(),
          kind: z.enum(["local-desktop", "remote", "plugin", "unknown"]).optional(),
          available: z.boolean().default(true),
          transport: z.enum(["stdio", "http", "sse", "unknown"]).default("unknown"),
          rawToolNames: z.array(z.string().trim().min(1)).default([]),
          notes: z.array(z.string().trim().min(1).max(500)).default([]),
        })
        .strict(),
    ),
  })
  .strict();

export const GetFigmaProviderPolicyInputSchema = z
  .object({
    runId: RunIdSchema,
  })
  .strict();

const FIGMA_CAPABILITY_ADAPTER = "figma-capability-v1" as const;

export class FigmaCapabilityService {
  public constructor(
    private readonly runStore: RunStore,
    private readonly artifactStore: ArtifactBlobStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async recordCapabilities(rawInput: unknown) {
    const input = RecordFigmaMcpCapabilitiesInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());

    const providers = input.providers.map((provider): FigmaProviderCapability => {
      const rawToolNames = provider.rawToolNames;
      const normalizedTools = [...new Set(rawToolNames.map(normalizeFigmaToolName))].filter(
        (toolName) => toolName !== "unknown",
      );

      return FigmaProviderCapabilitySchema.parse({
        providerId: provider.providerId,
        kind:
          provider.kind ??
          inferProviderKind({
            providerId: provider.providerId,
            ...(provider.serverName === undefined ? {} : { serverName: provider.serverName }),
            rawToolNames,
          }),
        available: provider.available,
        transport: provider.transport,
        tools: normalizedTools,
        rawToolNames,
        notes: provider.notes,
      });
    });

    const policy = deriveFigmaProviderPolicy(providers);

    const reportWithoutIds = {
      runId: run.id,
      capturedAt: timestamp,
      providers,
      policy,
      gapIds: [] as string[],
    };

    const content = Buffer.from(`${JSON.stringify(reportWithoutIds, null, 2)}\n`, "utf8");
    const blob = await this.artifactStore.writeBlob({
      content,
      mediaType: "application/json",
      storedAt: timestamp,
      label: "figma-mcp-capability-report",
    });

    const artifact = ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: "figma-mcp-capability-report",
      uri: blob.uri,
      mediaType: "application/json",
      digest: blob.digest,
      producedBy: "orchestrator",
      evidenceIds: [],
      createdAt: timestamp,
      metadata: {
        adapter: FIGMA_CAPABILITY_ADAPTER,
      },
    });

    const gaps = createCapabilityGaps(policy.missingCapabilities, timestamp);

    const finalReport = FigmaCapabilityReportSchema.parse({
      ...reportWithoutIds,
      artifactId: artifact.id,
      gapIds: gaps.map((gap) => gap.id),
    });

    const finalReportContent = Buffer.from(`${JSON.stringify(finalReport, null, 2)}\n`, "utf8");
    const finalBlob = await this.artifactStore.writeBlob({
      content: finalReportContent,
      mediaType: "application/json",
      storedAt: timestamp,
      label: "figma-mcp-capability-report-final",
    });

    const finalArtifact = ArtifactRefSchema.parse({
      ...artifact,
      digest: finalBlob.digest,
      uri: finalBlob.uri,
    });

    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, finalArtifact],
      gaps: [...run.gaps, ...gaps],
    });

    await this.runStore.save(nextRun, run.revision);

    return {
      run: summarizeRun(nextRun),
      report: finalReport,
      artifact: finalArtifact,
      gaps,
    };
  }

  public async getProviderPolicy(rawInput: unknown) {
    const input = GetFigmaProviderPolicyInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);

    const capabilityArtifacts = run.artifacts.filter(
      (artifact) => artifact.kind === "figma-mcp-capability-report",
    );

    const latest = capabilityArtifacts.at(-1);

    if (latest === undefined) {
      throw new Error(`No Figma capability report found for run ${run.id}`);
    }

    const content = await this.artifactStore.readContent(latest.digest);
    const report = FigmaCapabilityReportSchema.parse(JSON.parse(content.toString("utf8")));

    return report.policy;
  }
}

function createCapabilityGaps(capabilities: string[], timestamp: string): Gap[] {
  return capabilities.map((capability) =>
    GapSchema.parse({
      id: createGapId(),
      category: "design",
      severity: capability === "screenshot" || capability === "design-context" ? "major" : "minor",
      status: "open",
      title: `Missing Figma MCP capability: ${capability}`,
      expected: `A connected Figma MCP provider should expose ${capability} capability for reliable design intake.`,
      observed: `No available Figma provider exposed ${capability} capability in the recorded capability report.`,
      impact:
        "Figma intake may be incomplete, and later UI implementation may need a fallback or manual review.",
      sourceEvidenceIds: [],
      owner: "evidence-verifier",
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  );
}
