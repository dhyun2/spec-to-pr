import packageJson from "../../package.json" with { type: "json" };
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  WorkflowAdvanceInputSchema,
  WorkflowArchiveInputSchema,
  WorkflowPublishInputSchema,
  WorkflowStartInputSchema,
  WorkflowStatusInputSchema,
  WorkflowSubmitInputSchema,
} from "../application/workflow-service.js";
import { WorkflowStatusSchema } from "../workflow/workflow-contracts.js";
import type { ServicesProvider } from "./run-service-provider.js";

const CONTRACT_VERSION = "2.0.0" as const;
const SERVER_NAME = "spec-to-pr-kernel" as const;
const TOOL_NAMES = [
  "workflow_advance",
  "workflow_archive",
  "workflow_info",
  "workflow_publish",
  "workflow_start",
  "workflow_status",
  "workflow_submit",
] as const;

const EmptyInputSchema = z.object({}).strict();
const WorkflowInfoSchema = z
  .object({
    pluginName: z.literal("spec-to-pr"),
    pluginVersion: z.string().min(1),
    contractVersion: z.literal(CONTRACT_VERSION),
    transport: z.literal("stdio"),
    tools: z.tuple(TOOL_NAMES.map((name) => z.literal(name)) as ToolTuple),
  })
  .strict();

type ToolTuple = [
  z.ZodLiteral<(typeof TOOL_NAMES)[0]>,
  z.ZodLiteral<(typeof TOOL_NAMES)[1]>,
  z.ZodLiteral<(typeof TOOL_NAMES)[2]>,
  z.ZodLiteral<(typeof TOOL_NAMES)[3]>,
  z.ZodLiteral<(typeof TOOL_NAMES)[4]>,
  z.ZodLiteral<(typeof TOOL_NAMES)[5]>,
  z.ZodLiteral<(typeof TOOL_NAMES)[6]>,
];

type StructuredResult = Record<string, unknown>;

export function createKernelServer(servicesProvider: ServicesProvider): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: packageJson.version });

  server.registerTool(
    "workflow_info",
    {
      title: "Workflow information",
      description: "Return the compact SpecToPR v2 workflow contract and public tool list.",
      inputSchema: EmptyInputSchema.shape,
      outputSchema: WorkflowInfoSchema.shape,
      annotations: { readOnlyHint: true },
    },
    async () =>
      toolResult({
        pluginName: "spec-to-pr",
        pluginVersion: packageJson.version,
        contractVersion: CONTRACT_VERSION,
        transport: "stdio",
        tools: TOOL_NAMES,
      }),
  );

  server.registerTool(
    "workflow_start",
    {
      title: "Start workflow",
      description: "Create a Run, capture intake, classify scope, and stop at the next boundary.",
      inputSchema: WorkflowStartInputSchema.shape,
      outputSchema: WorkflowStatusSchema.shape,
    },
    async (input) => toolResult(await (await servicesProvider()).workflowService.start(input)),
  );

  server.registerTool(
    "workflow_advance",
    {
      title: "Advance workflow",
      description: "Run deterministic steps until completion, a blocker, or an external action.",
      inputSchema: WorkflowAdvanceInputSchema.shape,
      outputSchema: WorkflowStatusSchema.shape,
    },
    async (input) => toolResult(await (await servicesProvider()).workflowService.advance(input)),
  );

  server.registerTool(
    "workflow_submit",
    {
      title: "Submit workflow result",
      description: "Record contracts, implementation, Figma, or review evidence for a Run.",
      inputSchema: WorkflowSubmitInputSchema.shape,
      outputSchema: WorkflowStatusSchema.shape,
    },
    async (input) => toolResult(await (await servicesProvider()).workflowService.submit(input)),
  );

  server.registerTool(
    "workflow_status",
    {
      title: "Workflow status",
      description: "Return compact stage, scope, blocker, action, and artifact-handle status.",
      inputSchema: WorkflowStatusInputSchema.shape,
      outputSchema: WorkflowStatusSchema.shape,
      annotations: { readOnlyHint: true },
    },
    async (input) => toolResult(await (await servicesProvider()).workflowService.status(input)),
  );

  server.registerTool(
    "workflow_publish",
    {
      title: "Publish draft review request",
      description: "Preview or execute safe draft PR/MR publication from the canonical report.",
      inputSchema: WorkflowPublishInputSchema.shape,
    },
    async (input) => toolResult(await (await servicesProvider()).workflowService.publish(input)),
  );

  server.registerTool(
    "workflow_archive",
    {
      title: "Archive OpenSpec",
      description: "Preview or execute explicit post-merge OpenSpec archival.",
      inputSchema: WorkflowArchiveInputSchema.shape,
    },
    async (input) => toolResult(await (await servicesProvider()).workflowService.archive(input)),
  );

  return server;
}

function toolResult(value: unknown) {
  const structuredContent = asStructuredContent(value);

  return {
    content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

function asStructuredContent(value: unknown): StructuredResult {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as StructuredResult;
  }

  return { result: value };
}
