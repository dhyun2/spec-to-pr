import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const EXPECTED_TOOLS = [
  "workflow_advance",
  "workflow_archive",
  "workflow_info",
  "workflow_publish",
  "workflow_start",
  "workflow_status",
  "workflow_submit",
] as const;

describe("spec-to-pr MCP workflow facade", () => {
  let client: Client | undefined;
  let dataDirectory: string;
  let projectDirectory: string;

  beforeEach(async () => {
    dataDirectory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-data-"));
    projectDirectory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-project-"));
  });

  afterEach(async () => {
    await client?.close();
    client = undefined;
    await rm(dataDirectory, { recursive: true, force: true });
    await rm(projectDirectory, { recursive: true, force: true });
  });

  it("advertises only seven compact workflow tools and manages a Run", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(process.cwd(), "dist", "mcp", "server.js")],
      env: {
        ...process.env,
        SPEC_TO_PR_DATA_DIR: dataDirectory,
        GITHUB_TOKEN: "",
        GH_TOKEN: "",
        GITLAB_TOKEN: "",
        GITLAB_PRIVATE_TOKEN: "",
      },
      stderr: "pipe",
    });
    client = new Client({ name: "spec-to-pr-test-client", version: "0.2.0" });
    await client.connect(transport);

    const listed = await client.listTools();

    expect(listed.tools.map((tool) => tool.name).sort()).toEqual(EXPECTED_TOOLS);
    expect(Buffer.byteLength(JSON.stringify(listed.tools), "utf8")).toBeLessThan(40_000);

    const info = await client.callTool({ name: "workflow_info", arguments: {} });
    expect(info.structuredContent).toMatchObject({
      pluginName: "spec-to-pr",
      contractVersion: "2.0.0",
      tools: EXPECTED_TOOLS,
      durableStages: [
        "intake",
        "contracts",
        "implementation",
        "functional-review",
        "design-review",
        "report",
        "publish",
        "archive",
      ],
      reviewerRoles: ["functional-reviewer", "design-reviewer"],
      deliveryModes: ["auto", "brief", "legacy", "feature", "figma"],
      capabilities: {
        apiReadyBeforeUi: true,
        explicitApiReadyCheckpoint: true,
        independentReviews: true,
        conditionalDesignReview: true,
        targetedFeatureEvidence: true,
        featureVideoPublishing: true,
        hostFigmaIntake: true,
      },
    });

    const started = await client.callTool({
      name: "workflow_start",
      arguments: {
        projectRoot: projectDirectory,
        requestText: "Refactor the parser and add unit tests",
        scope: "non-ui",
      },
    });
    const runId = (started.structuredContent as { runId: string }).runId;

    expect(started.structuredContent).toMatchObject({
      status: "needs-external-action",
      currentStage: "contracts",
      deliveryProfile: { mode: "auto", publication: "draft" },
      workload: {
        size: expect.stringMatching(/^(XS|S|M|L|XL)$/),
        confidence: "low",
        source: "intake",
        budget: { checkpointPercent: 80 },
      },
      requiredValidations: ["functional", "draft-publication-preflight"],
    });

    const status = await client.callTool({ name: "workflow_status", arguments: { runId } });
    expect(status.structuredContent).toMatchObject({ runId, status: "needs-external-action" });
    expect(status.structuredContent).not.toHaveProperty("evidence");
    expect(status.structuredContent).not.toHaveProperty("sources");
  });
});
