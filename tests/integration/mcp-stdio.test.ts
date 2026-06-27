import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
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
      "block_stage",
      "classify_command",
      "complete_stage",
      "create_intake_manifest",
      "create_run",
      "fail_stage",
      "get_project_profile",
      "get_resume_plan",
      "get_run",
      "get_source_snapshot",
      "heartbeat_stage",
      "inspect_project",
      "kernel_info",
      "kernel_ping",
      "list_project_profiles",
      "list_runs",
      "policy_info",
      "redact_text",
      "register_file_source",
      "skip_stage",
      "start_stage",
      "validate_path",
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

    const policyInfo = await client.callTool({
      name: "policy_info",
      arguments: {},
    });

    expect(policyInfo.structuredContent).toMatchObject({
      policyVersion: "0.5.0",
    });

    const pathPolicy = await client.callTool({
      name: "validate_path",
      arguments: {
        workspaceRoot: projectDirectory,
        candidatePath: ".",
        mode: "read",
      },
    });

    expect(pathPolicy.structuredContent).toMatchObject({
      decision: {
        verdict: "allow",
      },
    });

    const commandPolicy = await client.callTool({
      name: "classify_command",
      arguments: {
        command: "bash",
        args: ["-lc", "echo hi"],
        intent: "unknown",
      },
    });

    expect(commandPolicy.structuredContent).toMatchObject({
      decision: {
        verdict: "deny",
      },
    });

    const redacted = await client.callTool({
      name: "redact_text",
      arguments: {
        text: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456",
      },
    });

    expect(redacted.structuredContent).toMatchObject({
      redactionCount: 1,
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

    await mkdir(path.join(projectDirectory, "docs"), {
      recursive: true,
    });

    await writeFile(path.join(projectDirectory, "docs", "brief.md"), "# Brief\nHello\n");

    const registered = await client.callTool({
      name: "register_file_source",
      arguments: {
        runId,
        kind: "brief",
        path: "docs/brief.md",
        mediaType: "text/markdown",
      },
    });

    expect(registered.structuredContent).toMatchObject({
      source: {
        kind: "brief",
        locator: {
          type: "file",
          path: "docs/brief.md",
        },
      },
      duplicate: false,
    });

    const digest = (registered.structuredContent as { source: { digest: string } }).source.digest;

    const snapshot = await client.callTool({
      name: "get_source_snapshot",
      arguments: {
        digest,
      },
    });

    expect(snapshot.structuredContent).toMatchObject({
      canonicalDigest: digest,
      source: {
        kind: "brief",
      },
    });

    const intake = await client.callTool({
      name: "create_intake_manifest",
      arguments: {
        runId,
        projectRoot: projectDirectory,
        language: "ko",
        sources: [
          {
            kind: "brief",
            locator: {
              type: "file",
              path: "docs/brief.md",
            },
            required: true,
          },
        ],
      },
    });

    expect(intake.structuredContent).toMatchObject({
      runId,
      projectRoot: projectDirectory,
      language: "ko",
    });

    const profile = await client.callTool({
      name: "inspect_project",
      arguments: {
        runId,
        projectRoot: projectDirectory,
      },
    });

    expect(profile.structuredContent).toMatchObject({
      runId,
      projectRoot: canonicalProjectDirectory,
    });

    const loadedProfile = await client.callTool({
      name: "get_project_profile",
      arguments: {
        runId,
      },
    });

    expect(loadedProfile.structuredContent).toMatchObject({
      runId,
      projectRoot: canonicalProjectDirectory,
    });

    const listedProfiles = await client.callTool({
      name: "list_project_profiles",
      arguments: {},
    });

    const profiles = (listedProfiles.structuredContent as { profiles: Array<{ runId: string }> })
      .profiles;

    expect(profiles.map((item) => item.runId)).toContain(runId);

    const started = await client.callTool({
      name: "start_stage",
      arguments: {
        runId,
        stageName: "intake",
        workerId: "worker-1",
        leaseTtlMs: 60_000,
      },
    });

    expect(started.structuredContent).toMatchObject({
      stage: {
        name: "intake",
        status: "running",
      },
    });

    const leaseId = (
      started.structuredContent as {
        stage: {
          lease: {
            id: string;
          };
        };
      }
    ).stage.lease.id;

    const heartbeat = await client.callTool({
      name: "heartbeat_stage",
      arguments: {
        runId,
        stageName: "intake",
        workerId: "worker-1",
        leaseId,
        checkpoint: {
          name: "mcp-smoke",
          data: {
            ok: true,
          },
        },
      },
    });

    expect(heartbeat.structuredContent).toMatchObject({
      stage: {
        name: "intake",
        status: "running",
        checkpoint: {
          name: "mcp-smoke",
          data: {
            ok: true,
          },
        },
      },
    });

    const completed = await client.callTool({
      name: "complete_stage",
      arguments: {
        runId,
        stageName: "intake",
        workerId: "worker-1",
        leaseId,
      },
    });

    expect(completed.structuredContent).toMatchObject({
      stage: {
        name: "intake",
        status: "passed",
      },
    });

    const resumePlan = await client.callTool({
      name: "get_resume_plan",
      arguments: {
        runId,
      },
    });

    expect(resumePlan.structuredContent).toMatchObject({
      runId,
      nextStages: ["project-profile"],
      completedStages: ["intake"],
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
