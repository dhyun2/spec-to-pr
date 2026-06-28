import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  AgentRuntimePreparationResultSchema,
  AgentRuntimeReportSchema,
  AgentWorktreeReportSchema,
} from "../agent-runtime/agent-runtime-report.js";
import type { AgentWorktreeReport } from "../agent-runtime/agent-runtime-report.js";
import {
  AgentDescriptorSchema,
  getAgentDescriptor,
  listAgentDescriptors,
  RuntimeAgentKindSchema,
} from "../agent-runtime/agent-descriptor.js";
import type { RuntimeAgentKind } from "../agent-runtime/agent-descriptor.js";
import {
  AgentContextPackSchema,
  buildAgentContextPack,
  renderAgentContextMarkdown,
} from "../agent-runtime/context-pack.js";
import {
  GitWorktreeManager,
  worktreePathFor,
} from "../agent-runtime/worktree-manager.js";
import { toRepoRelativePath } from "../openspec/openspec-paths.js";
import { RunManifestSchema } from "../run/index.js";
import { ArtifactRefSchema } from "../runtime/artifact.js";
import { createArtifactId } from "../runtime/id-factory.js";
import { RunIdSchema } from "../runtime/ids.js";
import { GitObjectIdSchema, IsoDateTimeSchema } from "../runtime/scalars.js";
import { sha256Digest } from "../source-registry/content-hash.js";
import type { RunStore } from "../store/run-store.js";

const DEFAULT_AGENT_SELECTION = ["spec-bdd", "api-contract", "design-ui", "integrator"] as const;

export const PrepareAgentRuntimeInputSchema = z
  .object({
    runId: RunIdSchema,
    agents: z.array(RuntimeAgentKindSchema).min(1).default([...DEFAULT_AGENT_SELECTION]),
  })
  .strict();

export const CreateAgentWorktreeInputSchema = z
  .object({
    runId: RunIdSchema,
    agent: RuntimeAgentKindSchema,
  })
  .strict();

export const GetAgentContextPackInputSchema = z
  .object({
    runId: RunIdSchema,
    agent: RuntimeAgentKindSchema,
  })
  .strict();

export const ListAgentWorktreesInputSchema = z
  .object({
    runId: RunIdSchema,
  })
  .strict();

export const CleanupAgentWorktreeInputSchema = z
  .object({
    runId: RunIdSchema,
    agent: RuntimeAgentKindSchema,
  })
  .strict();

export const ListAgentDescriptorsOutputSchema = z
  .object({
    descriptors: z.array(AgentDescriptorSchema),
  })
  .strict();

export const GetAgentContextPackResultSchema = z
  .object({
    pack: AgentContextPackSchema,
    markdown: z.string(),
    jsonPath: z.string().trim().min(1),
    markdownPath: z.string().trim().min(1),
    jsonRelativePath: z.string().trim().min(1),
    markdownRelativePath: z.string().trim().min(1),
  })
  .strict();

export const ListAgentWorktreesResultSchema = z
  .object({
    runId: RunIdSchema,
    worktrees: z.array(
      z
        .object({
          path: z.string().trim().min(1),
          head: GitObjectIdSchema.optional(),
          branch: z.string().trim().min(1).optional(),
        })
        .strict(),
    ),
  })
  .strict();

export const CleanupAgentWorktreeResultSchema = z
  .object({
    runId: RunIdSchema,
    agent: RuntimeAgentKindSchema,
    worktreePath: z.string().trim().min(1),
    removed: z.boolean(),
  })
  .strict();

export class AgentRuntimeService {
  public constructor(
    private readonly runStore: RunStore,
    private readonly worktreeManager: GitWorktreeManager = new GitWorktreeManager(),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public listAgentDescriptors() {
    return ListAgentDescriptorsOutputSchema.parse({
      descriptors: listAgentDescriptors(),
    });
  }

  public async prepare(rawInput: unknown) {
    const input = PrepareAgentRuntimeInputSchema.parse(rawInput);

    return this.prepareAgents({
      runId: input.runId,
      agents: [...new Set(input.agents)],
    });
  }

  public async createWorktree(rawInput: unknown) {
    const input = CreateAgentWorktreeInputSchema.parse(rawInput);

    return this.prepareAgents({
      runId: input.runId,
      agents: [input.agent],
    });
  }

  public async getContextPack(rawInput: unknown) {
    const input = GetAgentContextPackInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const paths = contextPackPaths(run.projectRoot, input.runId, input.agent);
    const rawJson = await readFile(paths.jsonPath, "utf8");
    const markdown = await readFile(paths.markdownPath, "utf8");

    return GetAgentContextPackResultSchema.parse({
      pack: AgentContextPackSchema.parse(JSON.parse(rawJson)),
      markdown,
      ...paths,
    });
  }

  public async listWorktrees(rawInput: unknown) {
    const input = ListAgentWorktreesInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const prefix = path.resolve(run.projectRoot, ".spec-to-pr", "worktrees", input.runId);
    const worktrees = (await this.worktreeManager.listWorktrees(run.projectRoot)).filter((item) =>
      path.resolve(item.path).startsWith(`${prefix}${path.sep}`),
    );

    return ListAgentWorktreesResultSchema.parse({
      runId: input.runId,
      worktrees,
    });
  }

  public async cleanupWorktree(rawInput: unknown) {
    const input = CleanupAgentWorktreeInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const worktreePath = worktreePathFor(run.projectRoot, input.runId, input.agent);
    const listed = await this.worktreeManager.listWorktrees(run.projectRoot);
    const existing = listed.find((item) => path.resolve(item.path) === path.resolve(worktreePath));

    if (existing === undefined) {
      await this.worktreeManager.prune(run.projectRoot);

      return CleanupAgentWorktreeResultSchema.parse({
        runId: input.runId,
        agent: input.agent,
        worktreePath,
        removed: false,
      });
    }

    await this.worktreeManager.removeWorktree(run.projectRoot, worktreePath);

    return CleanupAgentWorktreeResultSchema.parse({
      runId: input.runId,
      agent: input.agent,
      worktreePath,
      removed: true,
    });
  }

  private async prepareAgents(input: { runId: string; agents: RuntimeAgentKind[] }) {
    const run = await this.runStore.get(RunIdSchema.parse(input.runId));
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const baseCommit = GitObjectIdSchema.parse(
      run.baseCommit ?? (await this.worktreeManager.currentHead(run.projectRoot)),
    );
    const worktrees: AgentWorktreeReport[] = [];

    for (const agent of input.agents) {
      const descriptor = getAgentDescriptor(agent);
      const worktree = await this.worktreeManager.createAgentWorktree({
        runId: run.id,
        agent,
        projectRoot: run.projectRoot,
        baseCommit,
      });
      const pack = buildAgentContextPack({
        run,
        descriptor,
        generatedAt: timestamp,
        baseCommit,
      });
      const writtenPack = await writeContextPack({
        projectRoot: run.projectRoot,
        pack,
      });

      worktrees.push(
        AgentWorktreeReportSchema.parse({
          agent,
          worktreePath: worktree.worktreePath,
          branchName: worktree.branchName,
          baseCommit,
          contextPackJsonPath: writtenPack.jsonPath,
          contextPackMarkdownPath: writtenPack.markdownPath,
          contextPackJsonRelativePath: writtenPack.jsonRelativePath,
          contextPackMarkdownRelativePath: writtenPack.markdownRelativePath,
        }),
      );
    }

    const report = AgentRuntimeReportSchema.parse({
      adapter: "agent-runtime-v1",
      runId: run.id,
      projectRoot: run.projectRoot,
      baseCommit,
      worktrees,
      generatedAt: timestamp,
    });
    const writtenReport = await writeReport({
      projectRoot: run.projectRoot,
      report,
    });
    const artifact = ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: "log",
      uri: `repo://${writtenReport.relativePath}`,
      mediaType: "application/json",
      digest: writtenReport.digest,
      producedBy: "orchestrator",
      evidenceIds: [],
      createdAt: timestamp,
      metadata: {
        adapter: report.adapter,
        runRevision: run.revision,
        relativePath: writtenReport.relativePath,
        agentCount: worktrees.length,
      },
    });

    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, artifact],
    });

    await this.runStore.save(nextRun, run.revision);

    return AgentRuntimePreparationResultSchema.parse({
      runId: run.id,
      reportArtifactId: artifact.id,
      worktrees,
    });
  }
}

async function writeContextPack(input: {
  projectRoot: string;
  pack: z.infer<typeof AgentContextPackSchema>;
}) {
  const paths = contextPackPaths(input.projectRoot, input.pack.runId, input.pack.agent.agent);
  const json = `${JSON.stringify(input.pack, null, 2)}\n`;
  const markdown = renderAgentContextMarkdown(input.pack);

  assertInsideProjectRoot(input.projectRoot, paths.jsonPath);
  assertInsideProjectRoot(input.projectRoot, paths.markdownPath);

  await mkdir(path.dirname(paths.jsonPath), {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(paths.jsonPath, json, {
    encoding: "utf8",
    mode: 0o600,
  });
  await writeFile(paths.markdownPath, markdown, {
    encoding: "utf8",
    mode: 0o600,
  });

  return paths;
}

async function writeReport(input: {
  projectRoot: string;
  report: z.infer<typeof AgentRuntimeReportSchema>;
}) {
  const reportPath = path.join(
    input.projectRoot,
    ".spec-to-pr",
    "agent-runtime",
    input.report.runId,
    "report.json",
  );
  const content = `${JSON.stringify(input.report, null, 2)}\n`;

  assertInsideProjectRoot(input.projectRoot, reportPath);
  await mkdir(path.dirname(reportPath), {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(reportPath, content, {
    encoding: "utf8",
    mode: 0o600,
  });

  return {
    path: reportPath,
    relativePath: toRepoRelativePath(input.projectRoot, reportPath),
    digest: sha256Digest(Buffer.from(content, "utf8")),
  };
}

function contextPackPaths(projectRoot: string, runId: string, agent: RuntimeAgentKind) {
  const root = path.join(projectRoot, ".spec-to-pr", "context-packs", runId, agent);
  const jsonPath = path.join(root, "context.json");
  const markdownPath = path.join(root, "context.md");

  return {
    jsonPath,
    markdownPath,
    jsonRelativePath: toRepoRelativePath(projectRoot, jsonPath),
    markdownRelativePath: toRepoRelativePath(projectRoot, markdownPath),
  };
}

function assertInsideProjectRoot(projectRoot: string, absolutePath: string): void {
  const relative = path.relative(projectRoot, absolutePath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside project root: ${absolutePath}`);
  }
}
