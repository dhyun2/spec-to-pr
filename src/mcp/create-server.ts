import packageJson from "../../package.json" with { type: "json" };
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  CreateRunInputSchema,
  GetRunInputSchema,
  ListRunsInputSchema,
} from "../application/run-service.js";
import { RunManifestSchema, RunSummarySchema } from "../run/index.js";
import type { RunServiceProvider } from "./run-service-provider.js";

const CONTRACT_VERSION = "0.2.0" as const;
const SERVER_NAME = "spec-to-pr-kernel" as const;
const MINIMUM_NODE_MAJOR = 22 as const;

const PackageMetadataSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
});

const KernelInfoSchema = z.object({
  pluginName: z.literal("spec-to-pr"),
  serverName: z.literal(SERVER_NAME),
  pluginVersion: z.string().min(1),
  contractVersion: z.literal(CONTRACT_VERSION),
  transport: z.literal("stdio"),
  runtime: z.object({
    name: z.literal("node"),
    minimumMajor: z.literal(MINIMUM_NODE_MAJOR),
  }),
  tools: z.array(z.string().min(1)),
});

const KernelPingInputSchema = z.object({
  echo: z.string().min(1).max(200).default("pong"),
});

const KernelPingOutputSchema = z.object({
  ok: z.literal(true),
  echo: z.string().min(1).max(200),
  pluginVersion: z.string().min(1),
  contractVersion: z.literal(CONTRACT_VERSION),
});

const ListRunsOutputSchema = z.object({
  runs: z.array(RunSummarySchema),
});

type ToolResult<TStructuredContent> = {
  text: string;
  structuredContent: TStructuredContent;
};

export function createKernelServer(runServiceProvider: RunServiceProvider): McpServer {
  const metadata = packageMetadata();

  const server = new McpServer({
    name: SERVER_NAME,
    version: metadata.version,
  });

  server.registerTool(
    "kernel_info",
    {
      title: "Kernel information",
      description:
        "Return the installed spec-to-pr kernel version, contract version, runtime requirement, and available tools.",
      outputSchema: KernelInfoSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async () =>
      handleTool(() => {
        const structuredContent = KernelInfoSchema.parse({
          pluginName: "spec-to-pr",
          serverName: SERVER_NAME,
          pluginVersion: metadata.version,
          contractVersion: CONTRACT_VERSION,
          transport: "stdio",
          runtime: {
            name: "node",
            minimumMajor: MINIMUM_NODE_MAJOR,
          },
          tools: ["kernel_info", "kernel_ping", "create_run", "get_run", "list_runs"],
        });

        return {
          text: `spec-to-pr kernel ${structuredContent.pluginVersion} is available over stdio.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "kernel_ping",
    {
      title: "Kernel ping",
      description: "Echo a short string to verify MCP request and response plumbing.",
      inputSchema: KernelPingInputSchema.shape,
      outputSchema: KernelPingOutputSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(() => {
        const parsedInput = KernelPingInputSchema.parse(input);

        const structuredContent = KernelPingOutputSchema.parse({
          ok: true,
          echo: parsedInput.echo,
          pluginVersion: metadata.version,
          contractVersion: CONTRACT_VERSION,
        });

        return {
          text: `pong: ${structuredContent.echo}`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "create_run",
    {
      title: "Create run",
      description:
        "Create a durable spec-to-pr Run ledger for a project root and return its summary.",
      inputSchema: CreateRunInputSchema.shape,
      outputSchema: RunSummarySchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const service = await runServiceProvider();
        const structuredContent = await service.createRun(input);

        return {
          text: `Created run ${structuredContent.id} for ${structuredContent.projectRoot}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "get_run",
    {
      title: "Get run",
      description: "Return a full Run manifest by ID.",
      inputSchema: GetRunInputSchema.shape,
      outputSchema: RunManifestSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const service = await runServiceProvider();
        const structuredContent = await service.getRun(input);

        return {
          text: `Loaded run ${structuredContent.id}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "list_runs",
    {
      title: "List runs",
      description: "List durable Run summaries.",
      inputSchema: ListRunsInputSchema.shape,
      outputSchema: ListRunsOutputSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const service = await runServiceProvider();
        const runs = await service.listRuns(input);
        const structuredContent = ListRunsOutputSchema.parse({ runs });

        return {
          text: `Loaded ${structuredContent.runs.length} run summaries.`,
          structuredContent,
        };
      }),
  );

  return server;
}

async function handleTool<TStructuredContent>(
  operation: () => ToolResult<TStructuredContent> | Promise<ToolResult<TStructuredContent>>,
) {
  try {
    const result = await operation();

    return {
      content: [
        {
          type: "text" as const,
          text: result.text,
        },
      ],
      structuredContent: result.structuredContent,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown spec-to-pr MCP error";

    console.error(`[spec-to-pr] tool error: ${message}`);

    return {
      content: [
        {
          type: "text" as const,
          text: message,
        },
      ],
      isError: true,
    };
  }
}

function packageMetadata() {
  return PackageMetadataSchema.parse({
    name: packageJson.name,
    version: packageJson.version,
  });
}
