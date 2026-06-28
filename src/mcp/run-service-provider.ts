import os from "node:os";
import path from "node:path";

import packageJson from "../../package.json" with { type: "json" };
import { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import { AgentRuntimeService } from "../application/agent-runtime-service.js";
import { ApiContractAgentService } from "../application/api-contract-agent-service.js";
import { ApiPipelineService } from "../application/api-pipeline-service.js";
import { ArchitectureGuardService } from "../application/architecture-guard-service.js";
import { BriefAdapterService } from "../application/brief-adapter-service.js";
import { DesignContractService } from "../application/design-contract-service.js";
import { DesignUiAgentLaneService } from "../application/design-ui-agent-lane-service.js";
import { EvidenceGraphService } from "../application/evidence-graph-service.js";
import { FigmaCapabilityService } from "../application/figma-capability-service.js";
import { FigmaDesignInventoryService } from "../application/figma-design-inventory-service.js";
import { FigmaIntakeService } from "../application/figma-intake-service.js";
import { GherkinTestMatrixService } from "../application/gherkin-test-matrix-service.js";
import { IntegrationService } from "../application/integration-service.js";
import { OpenApiIntakeService } from "../application/openapi-intake-service.js";
import { OpenSpecChangeService } from "../application/openspec-change-service.js";
import { PolicyService } from "../application/policy-service.js";
import { ProjectProfileService } from "../application/profile-service.js";
import { QualityGateService } from "../application/quality-gate-service.js";
import { ReviewCouncilService } from "../application/review-council-service.js";
import { RunService } from "../application/run-service.js";
import { SourceRegistryService } from "../application/source-registry-service.js";
import { SpecBddAgentLaneService } from "../application/spec-bdd-agent-lane-service.js";
import { StageService } from "../application/stage-service.js";
import { VisualRegressionService } from "../application/visual-regression-service.js";
import { JsonProfileStore } from "../profile/profile-store.js";
import { SourceSnapshotStore } from "../source-registry/snapshot-store.js";

import type { RunStore } from "../store/run-store.js";

export type Services = {
  runService: RunService;
  stageService: StageService;
  policyService: PolicyService;
  architectureGuardService: ArchitectureGuardService;
  qualityGateService: QualityGateService;
  profileService: ProjectProfileService;
  sourceRegistryService: SourceRegistryService;
  briefAdapterService: BriefAdapterService;
  evidenceGraphService: EvidenceGraphService;
  figmaCapabilityService: FigmaCapabilityService;
  figmaDesignInventoryService: FigmaDesignInventoryService;
  figmaIntakeService: FigmaIntakeService;
  openApiIntakeService: OpenApiIntakeService;
  openSpecChangeService: OpenSpecChangeService;
  gherkinTestMatrixService: GherkinTestMatrixService;
  integrationService: IntegrationService;
  apiPipelineService: ApiPipelineService;
  apiContractAgentService: ApiContractAgentService;
  designContractService: DesignContractService;
  designUiAgentLaneService: DesignUiAgentLaneService;
  reviewCouncilService: ReviewCouncilService;
  agentRuntimeService: AgentRuntimeService;
  specBddAgentLaneService: SpecBddAgentLaneService;
  visualRegressionService: VisualRegressionService;
};

export type ServicesProvider = () => Promise<Services>;

export function createLazyServicesProvider(): ServicesProvider {
  let services: Services | undefined;

  return async () => {
    if (services !== undefined) {
      return services;
    }

    const { SqliteRunStore } = await import("../store/sqlite-run-store.js");

    const dataDirectory = resolveDataDirectory();
    const store: RunStore = new SqliteRunStore(path.join(dataDirectory, "runs.sqlite3"));
    const snapshotStore = new SourceSnapshotStore(path.join(dataDirectory, "source-snapshots"));
    const artifactStore = new ArtifactBlobStore(path.join(dataDirectory, "artifacts"));

    services = {
      runService: new RunService(store, {
        pluginVersion: packageJson.version,
      }),
      stageService: new StageService(store),
      policyService: new PolicyService(),
      architectureGuardService: new ArchitectureGuardService(store, artifactStore),
      qualityGateService: new QualityGateService(store, artifactStore),
      profileService: new ProjectProfileService(
        new JsonProfileStore(path.join(dataDirectory, "profiles")),
      ),
      sourceRegistryService: new SourceRegistryService(store, snapshotStore),
      briefAdapterService: new BriefAdapterService(store, snapshotStore),
      evidenceGraphService: new EvidenceGraphService(store, artifactStore),
      figmaCapabilityService: new FigmaCapabilityService(store, artifactStore),
      figmaDesignInventoryService: new FigmaDesignInventoryService(store, artifactStore),
      figmaIntakeService: new FigmaIntakeService(store, artifactStore),
      openApiIntakeService: new OpenApiIntakeService(store, snapshotStore, artifactStore),
      openSpecChangeService: new OpenSpecChangeService(store, artifactStore),
      gherkinTestMatrixService: new GherkinTestMatrixService(store),
      integrationService: new IntegrationService(store, artifactStore, dataDirectory),
      apiPipelineService: new ApiPipelineService(store, artifactStore),
      apiContractAgentService: new ApiContractAgentService(store, dataDirectory),
      designContractService: new DesignContractService(store, artifactStore),
      designUiAgentLaneService: new DesignUiAgentLaneService(store, dataDirectory),
      reviewCouncilService: new ReviewCouncilService(store, artifactStore, dataDirectory),
      agentRuntimeService: new AgentRuntimeService(store),
      specBddAgentLaneService: new SpecBddAgentLaneService(store),
      visualRegressionService: new VisualRegressionService(store, artifactStore),
    };

    return services;
  };
}

function resolveDataDirectory(): string {
  return process.env.SPEC_TO_PR_DATA_DIR ?? path.join(os.tmpdir(), "spec-to-pr-plugin-data");
}
