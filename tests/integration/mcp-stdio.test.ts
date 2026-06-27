import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("spec-to-pr MCP stdio server", () => {
  let client: Client | undefined;
  let dataDirectory: string;
  let projectDirectory: string;

  beforeEach(async () => {
    dataDirectory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-data-"));
    projectDirectory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-project-"));
  });

  afterEach(async () => {
    if (client !== undefined) {
      await client.close();
      client = undefined;
    }

    await rm(dataDirectory, { recursive: true, force: true });
    await rm(projectDirectory, { recursive: true, force: true });
  });

  it("starts the production bundle, lists tools, and manages durable Runs", async () => {
    const serverPath = path.join(process.cwd(), "dist", "mcp", "server.js");

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      env: {
        ...process.env,
        SPEC_TO_PR_DATA_DIR: dataDirectory,
      },
      stderr: "pipe",
    });

    client = new Client({
      name: "spec-to-pr-test-client",
      version: "0.1.0",
    });

    await client.connect(transport);

    const tools = await client.listTools();

    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "create_run",
      "get_run",
      "kernel_info",
      "kernel_ping",
      "list_runs",
    ]);

    const info = await client.callTool({
      name: "kernel_info",
      arguments: {},
    });

    expect(info.structuredContent).toMatchObject({
      pluginName: "spec-to-pr",
      serverName: "spec-to-pr-kernel",
      transport: "stdio",
    });

    const created = await client.callTool({
      name: "create_run",
      arguments: {
        projectRoot: projectDirectory,
      },
    });
    const canonicalProjectDirectory = await realpath(projectDirectory);

    expect(created.structuredContent).toMatchObject({
      projectRoot: canonicalProjectDirectory,
      status: "created",
      revision: 0,
    });

    const runId = (created.structuredContent as { id: string }).id;

    const loaded = await client.callTool({
      name: "get_run",
      arguments: {
        runId,
      },
    });

    expect(loaded.structuredContent).toMatchObject({
      id: runId,
      status: "created",
      revision: 0,
    });

    const listed = await client.callTool({
      name: "list_runs",
      arguments: {
        limit: 10,
      },
    });

    const runs = (listed.structuredContent as { runs: Array<{ id: string }> }).runs;

    expect(runs.map((run) => run.id)).toContain(runId);
  });
});
