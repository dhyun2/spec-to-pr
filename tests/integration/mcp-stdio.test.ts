import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

    const instructionHead = client.getInstructions()?.slice(0, 512) ?? "";
    expect(instructionHead).toContain(
      "intake → contracts → implementation → functional-review/design-review → report → publish → archive",
    );
    expect(instructionHead).toContain("one external action per boundary");
    expect(instructionHead).toContain("Missing evidence never passes");

    const listed = await client.listTools();

    expect(listed.tools.map((tool) => tool.name).sort()).toEqual(EXPECTED_TOOLS);
    expect(Buffer.byteLength(JSON.stringify(listed.tools), "utf8")).toBeLessThan(40_000);
    const statusTool = listed.tools.find((tool) => tool.name === "workflow_status");
    expect(statusTool?.description).toContain("action");
    expect(statusTool?.description).toContain("checkpoint");
    expect(statusTool?.description).toContain("detail");
    expect(statusTool?.inputSchema).toMatchObject({
      properties: {
        view: { default: "action", enum: ["action", "checkpoint", "detail"] },
      },
    });

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
        deterministicVisualComparison: true,
        legacyProjectInventory: true,
        operationAwareApiCoverage: true,
        performanceEvidence: true,
        canonicalPrReportV2: true,
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
    expect(status.structuredContent).toMatchObject({
      view: "action",
      runId,
      status: "needs-external-action",
    });
    expect(status.structuredContent).not.toHaveProperty("scope");
    expect(status.structuredContent).not.toHaveProperty("resumeContext");
    expect(status.structuredContent).not.toHaveProperty("legacyInventory");
    expect(status.structuredContent).not.toHaveProperty("evidence");
    expect(status.structuredContent).not.toHaveProperty("sources");

    const checkpoint = await client.callTool({
      name: "workflow_status",
      arguments: { runId, view: "checkpoint" },
    });
    expect(checkpoint.structuredContent).toMatchObject({
      view: "checkpoint",
      runId,
      resumeContext: { goal: expect.any(String), evidencePaths: [], submissions: [] },
    });

    const detail = await client.callTool({
      name: "workflow_status",
      arguments: { runId, view: "detail" },
    });
    expect(detail.structuredContent).toMatchObject({
      view: "detail",
      runId,
      scope: { code: true },
      deliveryProfile: { mode: "auto", publication: "draft" },
    });

    await mkdir(path.join(projectDirectory, "docs"), { recursive: true });
    await writeFile(
      path.join(projectDirectory, "docs", "brief.pdf"),
      minimalTextPdf("Acceptance criterion: checkout submits once."),
    );
    await writeFile(
      path.join(projectDirectory, "docs", "openapi.yaml"),
      "openapi: 3.1.0\npaths:\n  /checkout:\n    post:\n      operationId: checkout\n      responses: {}\n",
      "utf8",
    );
    const pdfStarted = await client.callTool({
      name: "workflow_start",
      arguments: {
        projectRoot: projectDirectory,
        requestText: "Implement checkout from the supplied full-delivery sources",
        scope: "ui",
        mode: "brief",
        briefPath: "docs/brief.pdf",
        figmaUrl: "https://www.figma.com/design/abc/file?node-id=1-2",
        openApiPath: "docs/openapi.yaml",
      },
    });
    if (pdfStarted.isError) throw new Error(JSON.stringify(pdfStarted.content));
    expect(pdfStarted.structuredContent).toMatchObject({
      status: "needs-external-action",
      deliveryProfile: { mode: "brief", briefPath: "docs/brief.pdf" },
    });
  });
});

function minimalTextPdf(text: string): Buffer {
  const escaped = text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const stream = "BT /F1 12 Tf 72 720 Td (" + escaped + ") Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " +
      String(Buffer.byteLength(stream, "latin1")) +
      " >>\nstream\n" +
      stream +
      "\nendstream",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += String(index + 1) + " 0 obj\n" + object + "\nendobj\n";
  });
  const xrefOffset = Buffer.byteLength(body, "latin1");
  body += "xref\n0 " + String(objects.length + 1) + "\n0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    body += String(offset).padStart(10, "0") + " 00000 n \n";
  });
  body +=
    "trailer\n<< /Size " +
    String(objects.length + 1) +
    " /Root 1 0 R >>\nstartxref\n" +
    String(xrefOffset) +
    "\n%%EOF\n";
  return Buffer.from(body, "latin1");
}
