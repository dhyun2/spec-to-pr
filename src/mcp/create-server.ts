import packageJson from "../../package.json" with { type: "json" };
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  WorkflowAdvanceInputSchema,
  WorkflowArchiveInputSchema,
  WorkflowPublishInputSchema,
  WorkflowStartInputSchema,
} from "../application/workflow-service.js";
import type { WorkflowService } from "../application/workflow-service.js";
import {
  RuntimeMetricsRecorder,
  type RuntimeMetricsSink,
} from "../runtime/performance-instrumentation.js";
import { WorkflowStatusInputSchema } from "../workflow/index.js";
import type { ServicesProvider } from "./run-service-provider.js";

const CONTRACT_VERSION = "2.0.0" as const;
const SERVER_NAME = "spec-to-pr-kernel" as const;
const SERVER_INSTRUCTIONS =
  "Workflow order: intake → contracts → implementation → functional-review/design-review → report → publish → archive. Stop for one external action per boundary. Missing evidence never passes a stage or gate. Use workflow_status to resume the recorded Run; use workflow_publish with blocked-diagnostic only for a currently blocked draft-publication Run.";
const TOOL_NAMES = [
  "workflow_advance",
  "workflow_archive",
  "workflow_info",
  "workflow_publish",
  "workflow_start",
  "workflow_status",
  "workflow_submit",
] as const;
const DURABLE_STAGES = [
  "intake",
  "contracts",
  "implementation",
  "functional-review",
  "design-review",
  "report",
  "publish",
  "archive",
] as const;
const REVIEWER_ROLES = ["functional-reviewer", "design-reviewer"] as const;
const DELIVERY_MODES = ["auto", "brief", "legacy", "feature", "figma"] as const;

const EmptyInputSchema = z.object({}).strict();
const WorkflowSubmitToolInputSchema = z
  .object({
    runId: z.string().trim().min(1),
    submission: z
      .object({
        kind: z.enum([
          "legacy-network-evidence",
          "contracts",
          "api-ready",
          "implementation",
          "functional-review",
          "design-review",
          "figma-bundle",
          "visual-comparison",
        ]),
      })
      .passthrough(),
  })
  .strict();
type StructuredResult = Record<string, unknown>;

export function createKernelServer(servicesProvider: ServicesProvider): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: packageJson.version },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "workflow_info",
    {
      title: "Workflow information",
      description: "Return the compact SpecToPR v2 workflow contract and public tool list.",
      inputSchema: EmptyInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    async () =>
      toolResult({
        pluginName: "spec-to-pr",
        pluginVersion: packageJson.version,
        contractVersion: CONTRACT_VERSION,
        transport: "stdio",
        tools: TOOL_NAMES,
        durableStages: DURABLE_STAGES,
        reviewerRoles: REVIEWER_ROLES,
        deliveryModes: DELIVERY_MODES,
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
          semanticLegacyApiDiscovery: true,
          sameRunLegacyNetworkEvidence: true,
          operationAwareApiCoverage: true,
          performanceEvidence: true,
          canonicalPrReportV2: true,
        },
      }),
  );

  server.registerTool(
    "workflow_start",
    {
      title: "Start workflow",
      description:
        "Create a Run, capture intake, estimate workload, classify scope, and stop at the next boundary.",
      inputSchema: WorkflowStartInputSchema.shape,
    },
    async (input) =>
      workflowToolResult(servicesProvider, (workflow) => workflow.start(input, "action")),
  );

  server.registerTool(
    "workflow_advance",
    {
      title: "Advance workflow",
      description: "Run deterministic steps until completion, a blocker, or an external action.",
      inputSchema: WorkflowAdvanceInputSchema.shape,
    },
    async (input) =>
      workflowToolResult(servicesProvider, (workflow) => workflow.advance(input, "action")),
  );

  server.registerTool(
    "workflow_submit",
    {
      title: "Submit workflow result",
      description: "Record contracts, API readiness, implementation, Figma, or review evidence.",
      // Keep discovery compact. WorkflowService re-parses the complete strict
      // discriminated submission contract before any state can change.
      inputSchema: WorkflowSubmitToolInputSchema,
    },
    async (input) =>
      workflowToolResult(servicesProvider, (workflow) => workflow.submit(input, "action")),
  );

  server.registerTool(
    "workflow_status",
    {
      title: "Workflow status",
      description:
        "Return action (default), checkpoint, or detail workflow status. Use action after external actions, checkpoint for bounded submission-evidence status when resuming, and detail only for immutable reviewer or report evidence.",
      inputSchema: WorkflowStatusInputSchema,
      annotations: { readOnlyHint: true },
    },
    async (input) => workflowToolResult(servicesProvider, (workflow) => workflow.status(input)),
  );

  server.registerTool(
    "workflow_publish",
    {
      title: "Publish draft review request",
      description: "Preview or execute safe draft PR/MR publication from the canonical report.",
      inputSchema: WorkflowPublishInputSchema.shape,
    },
    async (input) => workflowToolResult(servicesProvider, (workflow) => workflow.publish(input)),
  );

  server.registerTool(
    "workflow_archive",
    {
      title: "Archive OpenSpec",
      description: "Preview or execute explicit post-merge OpenSpec archival.",
      inputSchema: WorkflowArchiveInputSchema.shape,
    },
    async (input) => workflowToolResult(servicesProvider, (workflow) => workflow.archive(input)),
  );

  return server;
}

async function workflowToolResult(
  servicesProvider: ServicesProvider,
  operation: (workflow: WorkflowService) => Promise<unknown>,
) {
  const services = await servicesProvider();
  return toolResult(await operation(services.workflowService), services.metrics);
}

function toolResult(value: unknown, metrics?: RuntimeMetricsSink) {
  const structuredContent = asStructuredContent(value);
  const text = JSON.stringify(structuredContent);
  const runId = structuredContent["run"];
  if (
    metrics instanceof RuntimeMetricsRecorder &&
    typeof runId === "object" &&
    runId !== null &&
    typeof (runId as Record<string, unknown>)["id"] === "string"
  ) {
    metrics.incrementForRun(
      (runId as { id: `run_${string}` }).id,
      "status.serialized_bytes",
      Buffer.byteLength(text),
      { view: "tool-result" },
    );
  } else {
    metrics?.increment("status.serialized_bytes", Buffer.byteLength(text), { view: "tool-result" });
  }

  return {
    content: [{ type: "text" as const, text }],
    structuredContent,
  };
}

function asStructuredContent(value: unknown): StructuredResult {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as StructuredResult;
  }

  return { result: value };
}
