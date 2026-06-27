import packageJson from "../../package.json" with { type: "json" };
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { createKernelServer } from "./create-server.js";
import { createLazyRunServiceProvider } from "./run-service-provider.js";

const SERVER_NAME = "spec-to-pr-kernel" as const;
const MINIMUM_NODE_MAJOR = 22 as const;

// Keep Zod initialized before the bundled MCP SDK registers schemas.
// This avoids bundler initialization edge cases when SDK + Zod are included in one file.
const zodWarmup = z.string();
void zodWarmup;

async function main(): Promise<void> {
  assertSupportedNodeVersion();

  const server = createKernelServer(createLazyRunServiceProvider());
  const transport = new StdioServerTransport();

  await server.connect(transport);

  console.error(`[spec-to-pr] ${SERVER_NAME} ${packageJson.version} connected over stdio`);
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
