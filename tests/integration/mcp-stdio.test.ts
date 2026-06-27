import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";

describe("spec-to-pr MCP stdio server", () => {
  let client: Client | undefined;

  afterEach(async () => {
    if (client) {
      await client.close();
      client = undefined;
    }
  });

  it("starts the production bundle, lists tools, and calls kernel tools", async () => {
    const serverPath = path.join(process.cwd(), "dist", "mcp", "server.js");

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      stderr: "pipe",
    });

    client = new Client({
      name: "spec-to-pr-test-client",
      version: "0.1.0",
    });

    await client.connect(transport);

    const tools = await client.listTools();

    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(["kernel_info", "kernel_ping"]);

    const info = await client.callTool({
      name: "kernel_info",
      arguments: {},
    });

    expect(info.structuredContent).toMatchObject({
      pluginName: "spec-to-pr",
      serverName: "spec-to-pr-kernel",
      transport: "stdio",
      runtime: {
        name: "node",
        minimumMajor: 22,
      },
    });

    const ping = await client.callTool({
      name: "kernel_ping",
      arguments: {
        echo: "task-01",
      },
    });

    expect(ping.structuredContent).toMatchObject({
      ok: true,
      echo: "task-01",
    });
  });
});
