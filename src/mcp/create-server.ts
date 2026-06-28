import packageJson from "../../package.json" with { type: "json" };
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  GetAccessibilityReportInputSchema,
  GetAccessibilityReportResultSchema,
  PlanAccessibilityGateInputSchema,
  PlanAccessibilityGateResultSchema,
  RecordAccessibilityReviewInputSchema,
  RecordAccessibilityReviewResultSchema,
  RunAccessibilityGateInputSchema,
  RunAccessibilityGateResultSchema,
} from "../application/accessibility-gate-service.js";
import { AgentRuntimePreparationResultSchema } from "../agent-runtime/agent-runtime-report.js";
import {
  CleanupAgentWorktreeInputSchema,
  CleanupAgentWorktreeResultSchema,
  CreateAgentWorktreeInputSchema,
  GetAgentContextPackInputSchema,
  GetAgentContextPackResultSchema,
  ListAgentDescriptorsOutputSchema,
  ListAgentWorktreesInputSchema,
  ListAgentWorktreesResultSchema,
  PrepareAgentRuntimeInputSchema,
} from "../application/agent-runtime-service.js";
import {
  GetApiContractAgentContextInputSchema,
  GetApiContractAgentContextResultSchema,
  PrepareApiContractAgentInputSchema,
  PrepareApiContractAgentResultSchema,
  RecordApiContractAgentResultInputSchema,
  RecordApiContractAgentResultSchema,
} from "../application/api-contract-agent-service.js";
import { GenerateApiPipelineInputSchema } from "../application/api-pipeline-service.js";
import {
  AnalyzeArchitectureBoundariesInputSchema,
  ArchitectureGuardResultSchema,
  GenerateSourceGuardTestsInputSchema,
  GenerateSourceGuardTestsResultSchema,
} from "../application/architecture-guard-service.js";
import { AnalyzeBriefSourceInputSchema } from "../application/brief-adapter-service.js";
import {
  GenerateDesignContractInputSchema,
  GetDesignContractSummaryInputSchema,
} from "../application/design-contract-service.js";
import {
  GetDesignUiAgentContextInputSchema,
  GetDesignUiAgentContextResultSchema,
  PrepareDesignUiAgentInputSchema,
  PrepareDesignUiAgentResultSchema,
  RecordDesignUiAgentResultInputSchema,
  RecordDesignUiAgentResultSchema,
} from "../application/design-ui-agent-lane-service.js";
import {
  BuildEvidenceGraphInputSchema,
  EvidenceGraphBuildResultSchema,
  GetTraceabilityMatrixInputSchema,
} from "../application/evidence-graph-service.js";
import {
  GetFigmaProviderPolicyInputSchema,
  RecordFigmaMcpCapabilitiesInputSchema,
} from "../application/figma-capability-service.js";
import {
  AnalyzeFigmaDesignInventoryInputSchema,
  GetFigmaDesignInventoryInputSchema,
} from "../application/figma-design-inventory-service.js";
import {
  RecordFigmaScreenshotInputSchema,
  RecordFigmaTextArtifactInputSchema,
  RegisterFigmaSourceInputSchema,
} from "../application/figma-intake-service.js";
import { GenerateGherkinTestMatrixInputSchema } from "../application/gherkin-test-matrix-service.js";
import {
  ApplyIntegrationInputSchema,
  ApplyIntegrationResultSchema,
  FinalizeIntegrationInputSchema,
  FinalizeIntegrationResultSchema,
  GetIntegrationPlanInputSchema,
  GetIntegrationPlanResultSchema,
  PrepareIntegrationInputSchema,
  PrepareIntegrationResultSchema,
  RecordIntegrationRepairInputSchema,
  RecordIntegrationRepairResultSchema,
} from "../application/integration-service.js";
import { AnalyzeOpenApiSourceInputSchema } from "../application/openapi-intake-service.js";
import { GenerateOpenSpecChangeInputSchema } from "../application/openspec-change-service.js";
import { RedactTextInputSchema } from "../application/policy-service.js";
import {
  CreateIntakeManifestInputSchema,
  GetProjectProfileInputSchema,
  InspectProjectInputSchema,
} from "../application/profile-service.js";
import {
  RunQualityGatesInputSchema,
  RunQualityGatesResultSchema,
} from "../application/quality-gate-service.js";
import {
  CaptureBrowserScreenshotsInputSchema,
  CaptureBrowserScreenshotsResultSchema,
  CompareVisualSnapshotsInputSchema,
  CompareVisualSnapshotsResultSchema,
  GetVisualReportInputSchema,
  GetVisualReportResultSchema,
  PlanVisualRegressionInputSchema,
  PlanVisualRegressionResultSchema,
  RecordVisualReviewResultInputSchema,
  RecordVisualReviewResultSchema,
} from "../application/visual-regression-service.js";
import {
  GetReviewCouncilContextInputSchema,
  GetReviewCouncilContextResultSchema,
  PrepareReviewCouncilInputSchema,
  PrepareReviewCouncilResultSchema,
  RecordReviewCouncilResultInputSchema,
  RecordReviewCouncilResultSchema,
} from "../application/review-council-service.js";
import {
  CreateRunInputSchema,
  GetRunInputSchema,
  ListRunsInputSchema,
} from "../application/run-service.js";
import {
  GetSourceSnapshotInputSchema,
  RegisterFileSourceInputSchema,
  SourceRegistrationResultSchema,
} from "../application/source-registry-service.js";
import {
  GetSpecBddAgentContextInputSchema,
  GetSpecBddAgentContextResultSchema,
  PrepareSpecBddAgentInputSchema,
  PrepareSpecBddAgentResultSchema,
  RecordSpecBddAgentResultInputSchema,
  RecordSpecBddAgentResultSchema,
} from "../application/spec-bdd-agent-lane-service.js";
import { BriefAnalysisResultSchema } from "../brief/brief-analysis.js";
import {
  BlockStageInputSchema,
  CompleteStageInputSchema,
  FailStageInputSchema,
  GetResumePlanInputSchema,
  HeartbeatStageInputSchema,
  SkipStageInputSchema,
  StartStageInputSchema,
} from "../application/stage-service.js";
import { OpenApiAnalysisResultSchema } from "../openapi/openapi-analysis.js";
import { IntakeManifestSchema, ProjectProfileSchema } from "../profile/contracts.js";
import { RunManifestSchema, RunSummarySchema } from "../run/index.js";
import { CommandInvocationSchema } from "../security/command-policy.js";
import { ValidateWorkspacePathInputSchema } from "../security/path-policy.js";
import type { ServicesProvider } from "./run-service-provider.js";

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

const PolicyInfoOutputSchema = z.object({
  policyVersion: z.literal("0.5.0"),
  capabilities: z.array(z.string()),
});

const ListProjectProfilesOutputSchema = z.object({
  profiles: z.array(ProjectProfileSchema),
});

type ToolResult<TStructuredContent> = {
  text: string;
  structuredContent: TStructuredContent;
};

const TOOL_NAMES = [
  "kernel_info",
  "kernel_ping",
  "plan_accessibility_gate",
  "run_accessibility_gate",
  "get_accessibility_report",
  "record_accessibility_review",
  "analyze_architecture_boundaries",
  "generate_source_guard_tests",
  "run_quality_gates",
  "plan_visual_regression",
  "capture_browser_screenshots",
  "compare_visual_snapshots",
  "get_visual_report",
  "record_visual_review_result",
  "create_run",
  "get_run",
  "list_runs",
  "start_stage",
  "heartbeat_stage",
  "complete_stage",
  "fail_stage",
  "block_stage",
  "skip_stage",
  "get_resume_plan",
  "policy_info",
  "validate_path",
  "classify_command",
  "redact_text",
  "list_agent_descriptors",
  "prepare_agent_runtime",
  "create_agent_worktree",
  "get_agent_context_pack",
  "list_agent_worktrees",
  "cleanup_agent_worktree",
  "create_intake_manifest",
  "inspect_project",
  "get_project_profile",
  "list_project_profiles",
  "register_file_source",
  "get_source_snapshot",
  "analyze_brief_source",
  "analyze_openapi_source",
  "build_evidence_graph",
  "get_traceability_matrix",
  "record_figma_mcp_capabilities",
  "get_figma_provider_policy",
  "register_figma_source",
  "record_figma_metadata",
  "record_figma_design_context",
  "record_figma_screenshot",
  "record_figma_variable_defs",
  "record_figma_code_connect_map",
  "analyze_figma_design_inventory",
  "get_figma_design_inventory",
  "generate_openspec_change",
  "generate_gherkin_test_matrix",
  "generate_api_pipeline",
  "prepare_api_contract_agent",
  "get_api_contract_agent_context",
  "record_api_contract_agent_result",
  "generate_figma_design_contract",
  "get_figma_design_contract_summary",
  "prepare_design_ui_agent",
  "get_design_ui_agent_context",
  "record_design_ui_agent_result",
  "prepare_review_council",
  "get_review_council_context",
  "record_review_council_result",
  "prepare_integration",
  "get_integration_plan",
  "apply_integration",
  "record_integration_repair",
  "finalize_integration",
  "prepare_spec_bdd_agent",
  "record_spec_bdd_agent_result",
  "get_spec_bdd_agent_context",
] as const;

export function createKernelServer(servicesProvider: ServicesProvider): McpServer {
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
          tools: TOOL_NAMES,
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
    "policy_info",
    {
      title: "Policy information",
      description: "Return the installed security policy capabilities.",
      outputSchema: PolicyInfoOutputSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async () =>
      handleTool(() => {
        const structuredContent = PolicyInfoOutputSchema.parse({
          policyVersion: "0.5.0",
          capabilities: [
            "workspace-path-validation",
            "command-classification",
            "secret-redaction",
            "untrusted-content-wrapping",
          ],
        });

        return {
          text: "Security policy baseline is available.",
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "plan_accessibility_gate",
    {
      title: "Plan accessibility gate",
      description: "Plan accessibility targets and recommended checks.",
      inputSchema: PlanAccessibilityGateInputSchema.shape,
      outputSchema: PlanAccessibilityGateResultSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { accessibilityGateService } = await servicesProvider();
        const structuredContent = await accessibilityGateService.plan(input);

        return {
          text: `Planned accessibility gate for ${structuredContent.targetCount} target(s).`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "run_accessibility_gate",
    {
      title: "Run accessibility gate",
      description: "Run or record accessibility checks and persist accessibility report artifacts.",
      inputSchema: RunAccessibilityGateInputSchema.shape,
      outputSchema: RunAccessibilityGateResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { accessibilityGateService } = await servicesProvider();
        const structuredContent = await accessibilityGateService.run(input);

        return {
          text: `Accessibility gate decision: ${structuredContent.decision}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "get_accessibility_report",
    {
      title: "Get accessibility report",
      description: "Read an accessibility report artifact.",
      inputSchema: GetAccessibilityReportInputSchema.shape,
      outputSchema: GetAccessibilityReportResultSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { accessibilityGateService } = await servicesProvider();
        const structuredContent = await accessibilityGateService.getReport(input);

        return {
          text: `Loaded accessibility report for run ${structuredContent.report.runId}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "record_accessibility_review",
    {
      title: "Record accessibility review",
      description: "Record accessibility reviewer triage notes as an artifact.",
      inputSchema: RecordAccessibilityReviewInputSchema.shape,
      outputSchema: RecordAccessibilityReviewResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { accessibilityGateService } = await servicesProvider();
        const structuredContent = await accessibilityGateService.recordReview(input);

        return {
          text: `Recorded accessibility review artifact ${structuredContent.artifactId}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "analyze_architecture_boundaries",
    {
      title: "Analyze architecture boundaries",
      description: "Analyze FSD dependencies, public API usage, and API source guard boundaries.",
      inputSchema: AnalyzeArchitectureBoundariesInputSchema.shape,
      outputSchema: ArchitectureGuardResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { architectureGuardService } = await servicesProvider();
        const structuredContent = await architectureGuardService.analyze(input);

        return {
          text: `Architecture guard found ${structuredContent.violationCount} violation(s).`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "generate_source_guard_tests",
    {
      title: "Generate source guard tests",
      description: "Generate target repository source guard tests for architecture boundaries.",
      inputSchema: GenerateSourceGuardTestsInputSchema.shape,
      outputSchema: GenerateSourceGuardTestsResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { architectureGuardService } = await servicesProvider();
        const structuredContent = await architectureGuardService.generateSourceGuardTests(input);

        return {
          text: `Generated source guard test at ${structuredContent.relativePath}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "run_quality_gates",
    {
      title: "Run quality gates",
      description:
        "Run deterministic package quality gates and record CheckResult evidence in the Run ledger.",
      inputSchema: RunQualityGatesInputSchema.shape,
      outputSchema: RunQualityGatesResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { qualityGateService } = await servicesProvider();
        const structuredContent = await qualityGateService.run(input);

        return {
          text: `Quality gates ${structuredContent.status}: ${structuredContent.passedCount} passed, ${structuredContent.failedCount} failed, ${structuredContent.skippedCount} skipped.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "plan_visual_regression",
    {
      title: "Plan visual regression",
      description: "Build visual comparison targets from stored Figma screenshot artifacts.",
      inputSchema: PlanVisualRegressionInputSchema.shape,
      outputSchema: PlanVisualRegressionResultSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { visualRegressionService } = await servicesProvider();
        const structuredContent = await visualRegressionService.plan(input);

        return {
          text: `Planned ${structuredContent.targetCount} visual target(s).`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "capture_browser_screenshots",
    {
      title: "Capture browser screenshots",
      description: "Capture browser screenshots for planned visual regression targets.",
      inputSchema: CaptureBrowserScreenshotsInputSchema.shape,
      outputSchema: CaptureBrowserScreenshotsResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { visualRegressionService } = await servicesProvider();
        const structuredContent = await visualRegressionService.capture(input);

        return {
          text: `Captured ${structuredContent.capturedCount} browser screenshot(s).`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "compare_visual_snapshots",
    {
      title: "Compare visual snapshots",
      description: "Compare stored Figma screenshots with browser screenshot artifacts.",
      inputSchema: CompareVisualSnapshotsInputSchema.shape,
      outputSchema: CompareVisualSnapshotsResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { visualRegressionService } = await servicesProvider();
        const structuredContent = await visualRegressionService.compare(input);

        return {
          text: `Visual comparison completed for ${structuredContent.report.targetCount} target(s).`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "get_visual_report",
    {
      title: "Get visual report",
      description: "Load the latest visual regression report for a Run.",
      inputSchema: GetVisualReportInputSchema.shape,
      outputSchema: GetVisualReportResultSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { visualRegressionService } = await servicesProvider();
        const structuredContent = await visualRegressionService.getReport(input);

        return {
          text: `Loaded visual report ${structuredContent.reportArtifactId}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "record_visual_review_result",
    {
      title: "Record visual review result",
      description: "Record visual-regression-reviewer triage output without changing pass/fail.",
      inputSchema: RecordVisualReviewResultInputSchema.shape,
      outputSchema: RecordVisualReviewResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { visualRegressionService } = await servicesProvider();
        const structuredContent = await visualRegressionService.recordReviewResult(input);

        return {
          text: `Recorded ${structuredContent.findingCount} visual review finding(s).`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "validate_path",
    {
      title: "Validate workspace path",
      description: "Validate that a path stays inside a workspace boundary.",
      inputSchema: ValidateWorkspacePathInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { policyService } = await servicesProvider();
        const structuredContent = await policyService.validatePath(input);

        return {
          text: `Path policy verdict: ${structuredContent.decision.verdict}`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "classify_command",
    {
      title: "Classify command",
      description: "Classify a command invocation as allow, approval-required, or deny.",
      inputSchema: CommandInvocationSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { policyService } = await servicesProvider();
        const structuredContent = policyService.classifyCommand(input);

        return {
          text: `Command policy verdict: ${structuredContent.decision.verdict}`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "redact_text",
    {
      title: "Redact text",
      description: "Redact likely secrets from text.",
      inputSchema: RedactTextInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { policyService } = await servicesProvider();
        const structuredContent = policyService.redactText(input);

        return {
          text: `Redacted ${structuredContent.redactionCount} secret-like value(s).`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "list_agent_descriptors",
    {
      title: "List agent descriptors",
      description: "List implementation agent roles available for isolated runtime preparation.",
      outputSchema: ListAgentDescriptorsOutputSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async () =>
      handleTool(async () => {
        const { agentRuntimeService } = await servicesProvider();
        const structuredContent = agentRuntimeService.listAgentDescriptors();

        return {
          text: `Loaded ${structuredContent.descriptors.length} agent descriptors.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "prepare_agent_runtime",
    {
      title: "Prepare agent runtime",
      description:
        "Create isolated git worktrees and context packs for selected implementation agents without running them.",
      inputSchema: PrepareAgentRuntimeInputSchema.shape,
      outputSchema: AgentRuntimePreparationResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { agentRuntimeService } = await servicesProvider();
        const structuredContent = await agentRuntimeService.prepare(input);

        return {
          text: `Prepared ${structuredContent.worktrees.length} agent runtime worktree(s).`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "create_agent_worktree",
    {
      title: "Create agent worktree",
      description: "Create one isolated git worktree and context pack for an implementation agent.",
      inputSchema: CreateAgentWorktreeInputSchema.shape,
      outputSchema: AgentRuntimePreparationResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { agentRuntimeService } = await servicesProvider();
        const structuredContent = await agentRuntimeService.createWorktree(input);

        return {
          text: `Prepared agent runtime worktree for ${structuredContent.worktrees[0]?.agent}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "get_agent_context_pack",
    {
      title: "Get agent context pack",
      description: "Load the persisted context pack prepared for an implementation agent.",
      inputSchema: GetAgentContextPackInputSchema.shape,
      outputSchema: GetAgentContextPackResultSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { agentRuntimeService } = await servicesProvider();
        const structuredContent = await agentRuntimeService.getContextPack(input);

        return {
          text: `Loaded context pack for ${structuredContent.pack.agent.agent}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "list_agent_worktrees",
    {
      title: "List agent worktrees",
      description: "List git worktrees created under a spec-to-pr Run runtime directory.",
      inputSchema: ListAgentWorktreesInputSchema.shape,
      outputSchema: ListAgentWorktreesResultSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { agentRuntimeService } = await servicesProvider();
        const structuredContent = await agentRuntimeService.listWorktrees(input);

        return {
          text: `Loaded ${structuredContent.worktrees.length} agent worktree(s).`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "cleanup_agent_worktree",
    {
      title: "Cleanup agent worktree",
      description: "Remove one prepared spec-to-pr agent worktree for a Run.",
      inputSchema: CleanupAgentWorktreeInputSchema.shape,
      outputSchema: CleanupAgentWorktreeResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { agentRuntimeService } = await servicesProvider();
        const structuredContent = await agentRuntimeService.cleanupWorktree(input);

        return {
          text: structuredContent.removed
            ? `Removed agent worktree for ${structuredContent.agent}.`
            : `Agent worktree for ${structuredContent.agent} was already absent.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "create_intake_manifest",
    {
      title: "Create intake manifest",
      description:
        "Normalize user-provided brief, Figma, OpenAPI, and project inputs into an IntakeManifest.",
      inputSchema: CreateIntakeManifestInputSchema.shape,
      outputSchema: IntakeManifestSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { profileService } = await servicesProvider();
        const structuredContent = await profileService.createIntakeManifest(input);

        return {
          text: `Created intake manifest for run ${structuredContent.runId}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "inspect_project",
    {
      title: "Inspect project",
      description: "Inspect the target repository and create a ProjectProfile.",
      inputSchema: InspectProjectInputSchema.shape,
      outputSchema: ProjectProfileSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: false,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { profileService } = await servicesProvider();
        const structuredContent = await profileService.inspectProject(input);

        return {
          text: `Created project profile for run ${structuredContent.runId}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "get_project_profile",
    {
      title: "Get project profile",
      description: "Load a previously created ProjectProfile.",
      inputSchema: GetProjectProfileInputSchema.shape,
      outputSchema: ProjectProfileSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { profileService } = await servicesProvider();
        const structuredContent = await profileService.getProjectProfile(input);

        return {
          text: `Loaded project profile for run ${structuredContent.runId}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "list_project_profiles",
    {
      title: "List project profiles",
      description: "List stored ProjectProfile records.",
      inputSchema: z.object({}).strict().shape,
      outputSchema: ListProjectProfilesOutputSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async () =>
      handleTool(async () => {
        const { profileService } = await servicesProvider();
        const profiles = await profileService.listProjectProfiles();
        const structuredContent = ListProjectProfilesOutputSchema.parse({ profiles });

        return {
          text: `Loaded ${structuredContent.profiles.length} project profiles.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "register_file_source",
    {
      title: "Register file source",
      description:
        "Snapshot a project file, compute its digest, and attach it as a SourceRef to a Run.",
      inputSchema: RegisterFileSourceInputSchema.shape,
      outputSchema: SourceRegistrationResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { sourceRegistryService } = await servicesProvider();
        const result = await sourceRegistryService.registerFileSource(input);
        const structuredContent = SourceRegistrationResultSchema.parse(result);

        return {
          text: result.duplicate
            ? `Source ${result.source.id} was already registered.`
            : `Registered source ${result.source.id}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "get_source_snapshot",
    {
      title: "Get source snapshot",
      description: "Return metadata for a content-addressed source snapshot.",
      inputSchema: GetSourceSnapshotInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { sourceRegistryService } = await servicesProvider();
        const structuredContent = await sourceRegistryService.getSourceSnapshotMetadata(input);

        return {
          text: `Loaded source snapshot ${structuredContent.canonicalDigest}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "analyze_brief_source",
    {
      title: "Analyze brief source",
      description:
        "Analyze a registered brief Source snapshot and extract requirement Evidence and Gaps.",
      inputSchema: AnalyzeBriefSourceInputSchema.shape,
      outputSchema: BriefAnalysisResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { briefAdapterService } = await servicesProvider();
        const structuredContent = BriefAnalysisResultSchema.parse(
          await briefAdapterService.analyzeBriefSource(input),
        );

        return {
          text: structuredContent.duplicate
            ? `Brief source ${structuredContent.sourceId} was already analyzed.`
            : `Analyzed brief source ${structuredContent.sourceId}: ${structuredContent.evidenceAdded} evidence, ${structuredContent.gapsAdded} gaps.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "analyze_openapi_source",
    {
      title: "Analyze OpenAPI source",
      description:
        "Analyze a registered OpenAPI Source snapshot and extract operation, schema, security, ref inventory, and API gaps.",
      inputSchema: AnalyzeOpenApiSourceInputSchema.shape,
      outputSchema: OpenApiAnalysisResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { openApiIntakeService } = await servicesProvider();
        const structuredContent = await openApiIntakeService.analyzeOpenApiSource(input);

        return {
          text: structuredContent.duplicate
            ? `OpenAPI source ${structuredContent.sourceId} was already analyzed.`
            : `Analyzed OpenAPI source ${structuredContent.sourceId}: ${structuredContent.operationCount} operations, ${structuredContent.schemaCount} schemas, ${structuredContent.gapsAdded} gaps.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "build_evidence_graph",
    {
      title: "Build evidence graph",
      description:
        "Build a traceability graph that links brief requirements, OpenAPI operations, Figma evidence, artifacts, and gaps.",
      inputSchema: BuildEvidenceGraphInputSchema.shape,
      outputSchema: EvidenceGraphBuildResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { evidenceGraphService } = await servicesProvider();
        const structuredContent = await evidenceGraphService.buildEvidenceGraph(input);

        return {
          text: structuredContent.duplicate
            ? `Evidence graph already exists for current run revision ${structuredContent.runId}.`
            : `Built evidence graph for run ${structuredContent.runId}: ${structuredContent.requirementCount} requirements, ${structuredContent.edgeCount} edges.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "get_traceability_matrix",
    {
      title: "Get traceability matrix",
      description: "Return the latest traceability matrix for a Run.",
      inputSchema: GetTraceabilityMatrixInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { evidenceGraphService } = await servicesProvider();
        const matrix = await evidenceGraphService.getTraceabilityMatrix(input);

        return {
          text: "Loaded traceability matrix.",
          structuredContent: {
            matrix,
          },
        };
      }),
  );

  server.registerTool(
    "record_figma_mcp_capabilities",
    {
      title: "Record Figma MCP capabilities",
      description: "Record available Figma MCP providers and derive provider policy.",
      inputSchema: RecordFigmaMcpCapabilitiesInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { figmaCapabilityService } = await servicesProvider();
        const structuredContent = await figmaCapabilityService.recordCapabilities(input);

        return {
          text: `Recorded Figma MCP capability report for run ${structuredContent.report.runId}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "get_figma_provider_policy",
    {
      title: "Get Figma provider policy",
      description: "Return the latest derived Figma provider policy for a Run.",
      inputSchema: GetFigmaProviderPolicyInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { figmaCapabilityService } = await servicesProvider();
        const structuredContent = await figmaCapabilityService.getProviderPolicy(input);

        return {
          text: "Loaded Figma provider policy.",
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "register_figma_source",
    {
      title: "Register Figma source",
      description: "Parse a Figma URL and attach it as a Figma SourceRef to a Run.",
      inputSchema: RegisterFigmaSourceInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { figmaIntakeService } = await servicesProvider();
        const result = await figmaIntakeService.registerFigmaSource(input);

        return {
          text: result.duplicate
            ? `Figma source ${result.source.id} was already registered.`
            : `Registered Figma source ${result.source.id}.`,
          structuredContent: result,
        };
      }),
  );

  server.registerTool(
    "generate_openspec_change",
    {
      title: "Generate OpenSpec change",
      description: "Generate OpenSpec change files from a traceability matrix artifact.",
      inputSchema: GenerateOpenSpecChangeInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { openSpecChangeService } = await servicesProvider();
        const structuredContent = await openSpecChangeService.generateOpenSpecChange(input);

        return {
          text: structuredContent.duplicate
            ? `OpenSpec change ${structuredContent.changeName} already exists.`
            : `Generated OpenSpec change ${structuredContent.changeName} with ${structuredContent.changedFiles.length} changed files.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "generate_gherkin_test_matrix",
    {
      title: "Generate Gherkin and test matrix",
      description:
        "Generate Gherkin feature files and a test matrix from an OpenSpec change manifest.",
      inputSchema: GenerateGherkinTestMatrixInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { gherkinTestMatrixService } = await servicesProvider();
        const structuredContent = await gherkinTestMatrixService.generate(input);

        return {
          text: structuredContent.duplicate
            ? `Gherkin test matrix for ${structuredContent.changeName} already exists.`
            : `Generated ${structuredContent.scenarioCount} Gherkin scenario(s) for ${structuredContent.changeName}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "generate_api_pipeline",
    {
      title: "Generate API pipeline",
      description:
        "Generate API types, Zod schemas, wrappers, mocks, contract tests, source guards, and pipeline reports from OpenAPI intake evidence.",
      inputSchema: GenerateApiPipelineInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { apiPipelineService } = await servicesProvider();
        const structuredContent = await apiPipelineService.generate(input);

        return {
          text: structuredContent.duplicate
            ? `API pipeline for ${structuredContent.sourceKey} already exists.`
            : `Generated API pipeline for ${structuredContent.sourceKey} with ${structuredContent.generatedFiles.length} files.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "prepare_api_contract_agent",
    {
      title: "Prepare API Contract Agent",
      description: "Prepare the API Contract Agent context pack and record it as a Run artifact.",
      inputSchema: PrepareApiContractAgentInputSchema.shape,
      outputSchema: PrepareApiContractAgentResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { apiContractAgentService } = await servicesProvider();
        const structuredContent = await apiContractAgentService.prepare(input);

        return {
          text: `Prepared API Contract Agent context at ${structuredContent.context.contextPackPath}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "get_api_contract_agent_context",
    {
      title: "Get API Contract Agent context",
      description: "Load a prepared API Contract Agent context pack.",
      inputSchema: GetApiContractAgentContextInputSchema.shape,
      outputSchema: GetApiContractAgentContextResultSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { apiContractAgentService } = await servicesProvider();
        const structuredContent = await apiContractAgentService.getContext(input);

        return {
          text: `Loaded API Contract Agent context for run ${structuredContent.runId}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "record_api_contract_agent_result",
    {
      title: "Record API Contract Agent result",
      description: "Validate and record an API Contract Agent implementation result.",
      inputSchema: RecordApiContractAgentResultInputSchema.shape,
      outputSchema: RecordApiContractAgentResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { apiContractAgentService } = await servicesProvider();
        const structuredContent = await apiContractAgentService.recordResult(input);

        return {
          text: `Recorded API Contract Agent result ${structuredContent.resultId}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "generate_figma_design_contract",
    {
      title: "Generate Figma design contract",
      description:
        "Generate component, token, typography, and asset mapping contracts from Figma inventory.",
      inputSchema: GenerateDesignContractInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { designContractService } = await servicesProvider();
        const structuredContent = await designContractService.generate(input);

        return {
          text: structuredContent.duplicate
            ? `Design contract for ${structuredContent.changeName} already exists.`
            : `Generated design contract for ${structuredContent.changeName} with ${structuredContent.changedFiles.length} changed files.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "get_figma_design_contract_summary",
    {
      title: "Get Figma design contract summary",
      description: "Return summary counts for a generated Figma design contract.",
      inputSchema: GetDesignContractSummaryInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { designContractService } = await servicesProvider();
        const structuredContent = await designContractService.getSummary(input);

        return {
          text: `Loaded design contract summary for ${structuredContent.changeName}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "prepare_design_ui_agent",
    {
      title: "Prepare Design/UI agent",
      description: "Prepare the Design/UI agent worktree context pack.",
      inputSchema: PrepareDesignUiAgentInputSchema.shape,
      outputSchema: PrepareDesignUiAgentResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { designUiAgentLaneService } = await servicesProvider();
        const structuredContent = await designUiAgentLaneService.prepare(input);

        return {
          text: `Prepared Design/UI agent context for run ${structuredContent.context.runId}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "get_design_ui_agent_context",
    {
      title: "Get Design/UI agent context",
      description: "Return metadata for the prepared Design/UI context pack.",
      inputSchema: GetDesignUiAgentContextInputSchema.shape,
      outputSchema: GetDesignUiAgentContextResultSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { designUiAgentLaneService } = await servicesProvider();
        const structuredContent = await designUiAgentLaneService.getContext(input);

        return {
          text: `Loaded Design/UI agent context for run ${structuredContent.runId}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "record_design_ui_agent_result",
    {
      title: "Record Design/UI agent result",
      description: "Validate and record the structured Design/UI AgentResult.",
      inputSchema: RecordDesignUiAgentResultInputSchema.shape,
      outputSchema: RecordDesignUiAgentResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { designUiAgentLaneService } = await servicesProvider();
        const structuredContent = await designUiAgentLaneService.recordResult(input);

        return {
          text: `Recorded Design/UI agent result ${structuredContent.result.id}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "prepare_review_council",
    {
      title: "Prepare Review Council",
      description: "Create a Review Council context pack and deterministic precheck findings.",
      inputSchema: PrepareReviewCouncilInputSchema.shape,
      outputSchema: PrepareReviewCouncilResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { reviewCouncilService } = await servicesProvider();
        const structuredContent = await reviewCouncilService.prepare(input);

        return {
          text: `Prepared Review Council context with ${structuredContent.precheckFindingCount} precheck finding(s).`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "get_review_council_context",
    {
      title: "Get Review Council context",
      description: "Return the prepared Review Council context pack.",
      inputSchema: GetReviewCouncilContextInputSchema.shape,
      outputSchema: GetReviewCouncilContextResultSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { reviewCouncilService } = await servicesProvider();
        const structuredContent = await reviewCouncilService.getContext(input);

        return {
          text: `Loaded Review Council context for run ${structuredContent.context.runId}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "record_review_council_result",
    {
      title: "Record Review Council Result",
      description: "Validate and persist a structured Review Council result.",
      inputSchema: RecordReviewCouncilResultInputSchema.shape,
      outputSchema: RecordReviewCouncilResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { reviewCouncilService } = await servicesProvider();
        const structuredContent = await reviewCouncilService.record(input);

        return {
          text: `Recorded Review Council result with ${structuredContent.findingCount} finding(s) and ${structuredContent.newGapCount} new gap(s).`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "prepare_integration",
    {
      title: "Prepare integration",
      description:
        "Create an integration worktree and integration plan from approved AgentResults.",
      inputSchema: PrepareIntegrationInputSchema.shape,
      outputSchema: PrepareIntegrationResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { integrationService } = await servicesProvider();
        const structuredContent = await integrationService.prepareIntegration(input);

        return {
          text: `Prepared integration plan ${structuredContent.planArtifactId}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "get_integration_plan",
    {
      title: "Get integration plan",
      description: "Load a prepared integration plan artifact.",
      inputSchema: GetIntegrationPlanInputSchema.shape,
      outputSchema: GetIntegrationPlanResultSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { integrationService } = await servicesProvider();
        const structuredContent = await integrationService.getIntegrationPlan(input);

        return {
          text: `Loaded integration plan ${structuredContent.planArtifactId}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "apply_integration",
    {
      title: "Apply integration",
      description:
        "Apply integration plan commits into the integration worktree using bounded integration policy.",
      inputSchema: ApplyIntegrationInputSchema.shape,
      outputSchema: ApplyIntegrationResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { integrationService } = await servicesProvider();
        const structuredContent = await integrationService.applyIntegration(input);

        return {
          text: `Integration apply result: ${structuredContent.result.status}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "record_integration_repair",
    {
      title: "Record integration repair",
      description: "Record one bounded integrator repair attempt and update repair history.",
      inputSchema: RecordIntegrationRepairInputSchema.shape,
      outputSchema: RecordIntegrationRepairResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { integrationService } = await servicesProvider();
        const structuredContent = await integrationService.recordRepair(input);

        return {
          text: `Recorded integration repair attempt ${structuredContent.repairAttemptCount}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "finalize_integration",
    {
      title: "Finalize integration",
      description: "Finalize integration stage metadata. Full quality gates run in later tasks.",
      inputSchema: FinalizeIntegrationInputSchema.shape,
      outputSchema: FinalizeIntegrationResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { integrationService } = await servicesProvider();
        const structuredContent = await integrationService.finalizeIntegration(input);

        return {
          text: structuredContent.message,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "prepare_spec_bdd_agent",
    {
      title: "Prepare Spec/BDD agent",
      description: "Prepare context pack for the Spec/BDD agent lane.",
      inputSchema: PrepareSpecBddAgentInputSchema.shape,
      outputSchema: PrepareSpecBddAgentResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { specBddAgentLaneService } = await servicesProvider();
        const structuredContent = await specBddAgentLaneService.prepare(input);

        return {
          text: `Prepared Spec/BDD context pack for ${structuredContent.changeName}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "record_spec_bdd_agent_result",
    {
      title: "Record Spec/BDD agent result",
      description: "Record Spec/BDD review report artifacts after the agent lane finishes.",
      inputSchema: RecordSpecBddAgentResultInputSchema.shape,
      outputSchema: RecordSpecBddAgentResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { specBddAgentLaneService } = await servicesProvider();
        const structuredContent = await specBddAgentLaneService.recordResult(input);

        return {
          text: `Recorded Spec/BDD agent result with ${structuredContent.artifactIds.length} artifacts.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "get_spec_bdd_agent_context",
    {
      title: "Get Spec/BDD agent context",
      description: "Load the prepared context pack for a Spec/BDD agent lane.",
      inputSchema: GetSpecBddAgentContextInputSchema.shape,
      outputSchema: GetSpecBddAgentContextResultSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { specBddAgentLaneService } = await servicesProvider();
        const structuredContent = await specBddAgentLaneService.getContext(input);

        return {
          text: `Loaded Spec/BDD context pack for ${structuredContent.changeName}.`,
          structuredContent,
        };
      }),
  );

  registerFigmaTextRecorder(server, servicesProvider, {
    toolName: "record_figma_metadata",
    title: "Record Figma metadata",
    kind: "metadata",
    mediaType: "application/xml",
  });

  registerFigmaTextRecorder(server, servicesProvider, {
    toolName: "record_figma_design_context",
    title: "Record Figma design context",
    kind: "design-context",
    mediaType: "text/plain",
  });

  registerFigmaTextRecorder(server, servicesProvider, {
    toolName: "record_figma_variable_defs",
    title: "Record Figma variable definitions",
    kind: "variable-defs",
    mediaType: "text/plain",
  });

  registerFigmaTextRecorder(server, servicesProvider, {
    toolName: "record_figma_code_connect_map",
    title: "Record Figma Code Connect map",
    kind: "code-connect-map",
    mediaType: "application/json",
  });

  server.registerTool(
    "record_figma_screenshot",
    {
      title: "Record Figma screenshot",
      description: "Record a base64 screenshot from Figma MCP get_screenshot.",
      inputSchema: RecordFigmaScreenshotInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { figmaIntakeService } = await servicesProvider();
        const structuredContent = await figmaIntakeService.recordScreenshot(input);

        return {
          text: `Recorded Figma screenshot for source ${structuredContent.sourceId}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "analyze_figma_design_inventory",
    {
      title: "Analyze Figma design inventory",
      description:
        "Parse Figma raw artifacts into a design-system inventory and cross-check report.",
      inputSchema: AnalyzeFigmaDesignInventoryInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { figmaDesignInventoryService } = await servicesProvider();
        const structuredContent = await figmaDesignInventoryService.analyze(input);

        return {
          text: `Generated Figma design inventory for source ${structuredContent.inventory.sourceId}.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "get_figma_design_inventory",
    {
      title: "Get Figma design inventory",
      description: "Return the latest Figma design inventory artifact for a Run source.",
      inputSchema: GetFigmaDesignInventoryInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { figmaDesignInventoryService } = await servicesProvider();
        const structuredContent = await figmaDesignInventoryService.getInventory(input);

        return {
          text: `Loaded Figma design inventory for source ${structuredContent.inventory.sourceId}.`,
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
        const { runService } = await servicesProvider();
        const structuredContent = await runService.createRun(input);

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
        const { runService } = await servicesProvider();
        const structuredContent = await runService.getRun(input);

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
        const { runService } = await servicesProvider();
        const runs = await runService.listRuns(input);
        const structuredContent = ListRunsOutputSchema.parse({ runs });

        return {
          text: `Loaded ${structuredContent.runs.length} run summaries.`,
          structuredContent,
        };
      }),
  );

  server.registerTool(
    "start_stage",
    {
      title: "Start stage",
      description: "Transition a Run stage to running and acquire a lease.",
      inputSchema: StartStageInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { stageService } = await servicesProvider();
        const result = await stageService.start(input);

        return {
          text: `Started stage ${result.stage.name} with lease ${result.stage.lease?.id}.`,
          structuredContent: result,
        };
      }),
  );

  server.registerTool(
    "heartbeat_stage",
    {
      title: "Heartbeat stage",
      description: "Renew the current lease for a running stage and optionally update checkpoint.",
      inputSchema: HeartbeatStageInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { stageService } = await servicesProvider();
        const result = await stageService.heartbeat(input);

        return {
          text: `Heartbeat accepted for stage ${result.stage.name}.`,
          structuredContent: result,
        };
      }),
  );

  server.registerTool(
    "complete_stage",
    {
      title: "Complete stage",
      description: "Transition a running stage to passed.",
      inputSchema: CompleteStageInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { stageService } = await servicesProvider();
        const result = await stageService.complete(input);

        return {
          text: `Completed stage ${result.stage.name}.`,
          structuredContent: result,
        };
      }),
  );

  server.registerTool(
    "fail_stage",
    {
      title: "Fail stage",
      description: "Transition a running stage to failed.",
      inputSchema: FailStageInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { stageService } = await servicesProvider();
        const result = await stageService.fail(input);

        return {
          text: `Failed stage ${result.stage.name}.`,
          structuredContent: result,
        };
      }),
  );

  server.registerTool(
    "block_stage",
    {
      title: "Block stage",
      description: "Transition a running stage to blocked and attach gap references.",
      inputSchema: BlockStageInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { stageService } = await servicesProvider();
        const result = await stageService.block(input);

        return {
          text: `Blocked stage ${result.stage.name}.`,
          structuredContent: result,
        };
      }),
  );

  server.registerTool(
    "skip_stage",
    {
      title: "Skip stage",
      description: "Transition a running stage to skipped.",
      inputSchema: SkipStageInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { stageService } = await servicesProvider();
        const result = await stageService.skip(input);

        return {
          text: `Skipped stage ${result.stage.name}.`,
          structuredContent: result,
        };
      }),
  );

  server.registerTool(
    "get_resume_plan",
    {
      title: "Get resume plan",
      description: "Inspect a Run and return the next resumable stages.",
      inputSchema: GetResumePlanInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (input: unknown) =>
      handleTool(async () => {
        const { stageService } = await servicesProvider();
        const structuredContent = await stageService.getResumePlan(input);

        return {
          text: `Resume plan for run ${structuredContent.runId}.`,
          structuredContent,
        };
      }),
  );

  return server;
}

type FigmaTextArtifactKind = "metadata" | "design-context" | "variable-defs" | "code-connect-map";

function registerFigmaTextRecorder(
  server: McpServer,
  servicesProvider: ServicesProvider,
  input: {
    toolName: string;
    title: string;
    kind: FigmaTextArtifactKind;
    mediaType: string;
  },
): void {
  server.registerTool(
    input.toolName,
    {
      title: input.title,
      description: `Record Figma ${input.kind} output as a Run artifact.`,
      inputSchema: RecordFigmaTextArtifactInputSchema.omit({ kind: true }).shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (rawInput: unknown) =>
      handleTool(async () => {
        const { figmaIntakeService } = await servicesProvider();
        const structuredContent = await figmaIntakeService.recordTextArtifact({
          ...(rawInput as Record<string, unknown>),
          kind: input.kind,
          mediaType: input.mediaType,
        });

        return {
          text: `Recorded Figma ${input.kind} for source ${structuredContent.sourceId}.`,
          structuredContent,
        };
      }),
  );
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
