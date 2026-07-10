import {
  ApiGenerationProfileSchema,
  DesignSystemProfileSchema,
  FrameworkProfileSchema,
  FsdProfileSchema,
  ProjectProfileSchema,
  type ProfileFinding,
  type ProjectProfile,
} from "./contracts.js";
import { detectGit } from "./git-detector.js";
import { detectPackageManager } from "./package-manager-detector.js";
import { createProjectProbe, type ProjectProbe } from "./probe.js";
import { detectWorkspace } from "./workspace-detector.js";

export async function profileProject(input: {
  runId: string;
  projectRoot: string;
  now: string;
}): Promise<ProjectProfile> {
  const probe = await createProjectProbe(input.projectRoot);
  const findings: ProfileFinding[] = [];

  const git = await detectGit(probe);
  const packageManager = await detectPackageManager(probe, findings);
  const workspace = await detectWorkspace(probe, findings);
  const framework = await detectFramework(probe);
  const fsd = await detectFsd(probe);
  const designSystem = await detectDesignSystem(probe);
  const apiGeneration = await detectApiGeneration(probe);

  return ProjectProfileSchema.parse({
    runId: input.runId,
    projectRoot: probe.realRoot,
    profiledAt: input.now,
    git,
    packageManager,
    workspace,
    framework,
    fsd,
    designSystem,
    apiGeneration,
    findings,
  });
}

async function detectFramework(probe: ProjectProbe) {
  const rootPackage = await readPackageJson(probe, "package.json");
  const deps = dependencyNames(rootPackage);

  const evidence: string[] = [];

  const hasNext =
    deps.has("next") ||
    (await probe.exists("next.config.js")) ||
    (await probe.exists("next.config.mjs"));
  const hasReact = deps.has("react");
  const hasVue = deps.has("vue");
  const hasVite =
    deps.has("vite") ||
    (await probe.exists("vite.config.ts")) ||
    (await probe.exists("vite.config.js")) ||
    (await probe.exists("vite.config.mts"));

  const hasVitest = deps.has("vitest") || (await probe.exists("vitest.config.ts"));
  const hasJest =
    deps.has("jest") ||
    (await probe.exists("jest.config.js")) ||
    (await probe.exists("jest.config.ts"));
  const hasPlaywright =
    deps.has("@playwright/test") || (await probe.exists("playwright.config.ts"));
  const hasTsconfig = await probe.exists("tsconfig.json");

  if (hasNext) evidence.push("next dependency or config detected");
  if (hasReact) evidence.push("react dependency detected");
  if (hasVue) evidence.push("vue dependency detected");
  if (hasVite) evidence.push("vite dependency or config detected");
  if (hasVitest) evidence.push("vitest dependency or config detected");
  if (hasJest) evidence.push("jest dependency or config detected");
  if (hasPlaywright) evidence.push("playwright dependency or config detected");
  if (hasTsconfig) evidence.push("tsconfig.json detected");

  return FrameworkProfileSchema.parse({
    primary: hasNext ? "next" : hasReact ? "react" : hasVue ? "vue" : "unknown",
    buildTool: hasNext ? "next" : hasVite ? "vite" : deps.has("webpack") ? "webpack" : "unknown",
    testRunner: hasVitest ? "vitest" : hasJest ? "jest" : hasPlaywright ? "playwright" : "unknown",
    language: hasTsconfig ? "typescript" : "unknown",
    confidence: evidence.length === 0 ? "unknown" : "medium",
    evidence,
  });
}

async function detectFsd(probe: ProjectProbe) {
  const rootCandidates = ["src", "apps/web/src", "apps/rangepro/src"];
  const layers = ["app", "pages", "widgets", "features", "entities", "shared"] as const;

  const detectedRoots: string[] = [];
  const presentLayers = new Set<(typeof layers)[number]>();

  for (const root of rootCandidates) {
    let count = 0;

    for (const layer of layers) {
      if (await probe.exists(`${root}/${layer}`)) {
        count += 1;
        presentLayers.add(layer);
      }
    }

    if (count >= 3) {
      detectedRoots.push(root);
    }
  }

  return FsdProfileSchema.parse({
    detected: detectedRoots.length > 0,
    confidence: detectedRoots.length > 0 ? "medium" : "unknown",
    rootCandidates: detectedRoots,
    presentLayers: [...presentLayers],
  });
}

async function detectDesignSystem(probe: ProjectProbe) {
  const componentRoots = [
    "src/shared/ui",
    "src/components",
    "packages/ui/src",
    "apps/rangepro/src/shared/ui",
  ];

  const tokenFiles = [
    "src/shared/config/tokens.ts",
    "src/shared/styles/tokens.css",
    "src/styles/tokens.css",
    "tailwind.config.ts",
    "tailwind.config.js",
  ];

  const existingComponentRoots: string[] = [];
  const existingTokenFiles: string[] = [];

  for (const candidate of componentRoots) {
    if (await probe.exists(candidate)) {
      existingComponentRoots.push(candidate);
    }
  }

  for (const candidate of tokenFiles) {
    if (await probe.exists(candidate)) {
      existingTokenFiles.push(candidate);
    }
  }

  return DesignSystemProfileSchema.parse({
    detected: existingComponentRoots.length > 0 || existingTokenFiles.length > 0,
    confidence:
      existingComponentRoots.length > 0
        ? "medium"
        : existingTokenFiles.length > 0
          ? "low"
          : "unknown",
    componentRoots: existingComponentRoots,
    tokenFiles: existingTokenFiles,
    evidence: [...existingComponentRoots, ...existingTokenFiles],
  });
}

async function detectApiGeneration(probe: ProjectProbe) {
  const rootPackage = await readPackageJson(probe, "package.json");
  const scripts =
    typeof rootPackage?.scripts === "object" &&
    rootPackage.scripts !== null &&
    !Array.isArray(rootPackage.scripts)
      ? (rootPackage.scripts as Record<string, unknown>)
      : {};

  const generatorScripts = Object.entries(scripts)
    .filter(([name, value]) => {
      const text = `${name} ${String(value)}`.toLowerCase();

      return (
        text.includes("openapi") ||
        text.includes("api:generate") ||
        text.includes("swagger") ||
        text.includes("orval")
      );
    })
    .map(([name]) => name);

  const generatedClientCandidates = [
    "src/shared/api/generated",
    "apps/rangepro/src/shared/api/generated",
    "src/api/generated",
    "packages/api-client/src/generated",
  ];

  const openapiCandidates = [
    "openapi.yaml",
    "openapi.yml",
    "openapi.json",
    "docs/openapi.yaml",
    "apps/rangepro/openapi.yaml",
  ];

  const generatedClientRoots: string[] = [];
  const openapiSourceCandidates: string[] = [];

  for (const candidate of generatedClientCandidates) {
    if (await probe.exists(candidate)) {
      generatedClientRoots.push(candidate);
    }
  }

  for (const candidate of openapiCandidates) {
    if (await probe.exists(candidate)) {
      openapiSourceCandidates.push(candidate);
    }
  }

  return ApiGenerationProfileSchema.parse({
    detected:
      generatorScripts.length > 0 ||
      generatedClientRoots.length > 0 ||
      openapiSourceCandidates.length > 0,
    confidence:
      generatorScripts.length > 0 ? "medium" : generatedClientRoots.length > 0 ? "low" : "unknown",
    generatorScripts,
    generatedClientRoots,
    openapiSourceCandidates,
    evidence: [...generatorScripts, ...generatedClientRoots, ...openapiSourceCandidates],
  });
}

async function readPackageJson(
  probe: ProjectProbe,
  relativePath: string,
): Promise<Record<string, unknown> | undefined> {
  const value = await probe.readJson(relativePath);

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function dependencyNames(packageJson: Record<string, unknown> | undefined): Set<string> {
  const names = new Set<string>();

  if (packageJson === undefined) {
    return names;
  }

  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const value = packageJson[field];

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      Object.keys(value).forEach((name) => names.add(name));
    }
  }

  return names;
}
