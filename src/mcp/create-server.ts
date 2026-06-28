import packageJson from "../../package.json" with { type: "json" };
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { AnalyzeBriefSourceInputSchema } from "../application/brief-adapter-service.js";
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
import { AnalyzeOpenApiSourceInputSchema } from "../application/openapi-intake-service.js";
import { GenerateOpenSpecChangeInputSchema } from "../application/openspec-change-service.js";
import { RedactTextInputSchema } from "../application/policy-service.js";
import {
  CreateIntakeManifestInputSchema,
  GetProjectProfileInputSchema,
  InspectProjectInputSchema,
} from "../application/profile-service.js";
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

import { GenerateGherkinTestMatrixInputSchema } from "../application/gherkin-test-matrix-service.js";

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
