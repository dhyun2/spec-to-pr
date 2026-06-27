import packageJson from "../../package.json" with { type: "json" };
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const CONTRACT_VERSION = "0.1.0" as const;
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

type ToolResult<TStructuredContent> = {
  text: string;
  structuredContent: TStructuredContent;
};

function packageMetadata() {
  return PackageMetadataSchema.parse({
    name: packageJson.name,
    version: packageJson.version,
  });
}

function createServer(): McpServer {
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
          tools: ["kernel_info", "kernel_ping"],
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

async function main(): Promise<void> {
  assertSupportedNodeVersion();

  const server = createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  console.error(`[spec-to-pr] ${SERVER_NAME} ${packageMetadata().version} connected over stdio`);
}

function assertSupportedNodeVersion(): void {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);

  if (!Number.isFinite(major) || major < MINIMUM_NODE_MAJOR) {
    throw new Error(
      `spec-to-pr requires Node ${MINIMUM_NODE_MAJOR}+; current version is ${process.versions.node}`,
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);

  console.error(`[spec-to-pr] fatal: ${message}`);
  process.exitCode = 1;
});
