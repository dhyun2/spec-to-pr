import { readFile } from "node:fs/promises";
import path from "node:path";

import { ApiGeneratorPlanSchema } from "./api-pipeline-contracts.js";
import type { ApiGeneratorPlan } from "./api-pipeline-contracts.js";

export type ApiGeneratorDiscoveryInput = {
  projectRoot: string;
  sourceKey: string;
  generatedRoot?: string;
  wrapperRoot?: string;
  preferredCommand?: string[];
};

const KNOWN_GENERATOR_SCRIPT_PATTERNS = [
  /^api:generate/i,
  /^generate:api/i,
  /^openapi:generate/i,
  /^swagger:generate/i,
  /^gen:api/i,
];

export async function discoverApiGenerator(
  input: ApiGeneratorDiscoveryInput,
): Promise<ApiGeneratorPlan> {
  if (input.preferredCommand !== undefined && input.preferredCommand.length > 0) {
    return ApiGeneratorPlanSchema.parse({
      mode: "existing-generator",
      generatorName: "preferred-command",
      command: input.preferredCommand,
      generatedRoot: input.generatedRoot ?? "src/shared/api/generated",
      wrapperRoot: input.wrapperRoot ?? "src/features",
      sourceKey: input.sourceKey,
      canRun: true,
      reason: "Preferred API generator command was provided.",
    });
  }

  const packageJson = await readPackageJson(input.projectRoot);
  const scripts = getScripts(packageJson);

  const matchingScript = Object.keys(scripts).find((scriptName) =>
    KNOWN_GENERATOR_SCRIPT_PATTERNS.some((pattern) => pattern.test(scriptName)),
  );

  if (matchingScript !== undefined) {
    return ApiGeneratorPlanSchema.parse({
      mode: "existing-generator",
      generatorName: `package-script:${matchingScript}`,
      command: ["pnpm", "run", matchingScript],
      generatedRoot: input.generatedRoot ?? "src/shared/api/generated",
      wrapperRoot: input.wrapperRoot ?? "src/features",
      sourceKey: input.sourceKey,
      canRun: true,
      reason: `Detected package.json script ${matchingScript}.`,
    });
  }

  const knownConfig = await detectKnownGeneratorConfig(input.projectRoot);

  if (knownConfig !== undefined) {
    return ApiGeneratorPlanSchema.parse({
      mode: "existing-generator",
      generatorName: knownConfig.generatorName,
      command: knownConfig.command,
      generatedRoot: input.generatedRoot ?? "src/shared/api/generated",
      wrapperRoot: input.wrapperRoot ?? "src/features",
      sourceKey: input.sourceKey,
      canRun: true,
      reason: `Detected ${knownConfig.configPath}.`,
    });
  }

  return ApiGeneratorPlanSchema.parse({
    mode: "fallback-generator",
    generatorName: "spec-to-pr-fallback-openapi-ts-zod",
    command: [],
    generatedRoot: input.generatedRoot ?? `src/shared/api/generated/${input.sourceKey}`,
    wrapperRoot: input.wrapperRoot ?? "src/features",
    sourceKey: input.sourceKey,
    canRun: true,
    reason: "No existing API generator was detected. Using conservative fallback generator.",
  });
}

async function readPackageJson(projectRoot: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  } catch {
    return {};
  }
}

function getScripts(packageJson: unknown): Record<string, string> {
  if (typeof packageJson !== "object" || packageJson === null) {
    return {};
  }

  const scripts = (packageJson as { scripts?: unknown }).scripts;

  if (typeof scripts !== "object" || scripts === null) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(scripts).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

async function detectKnownGeneratorConfig(projectRoot: string): Promise<
  | {
      generatorName: string;
      configPath: string;
      command: string[];
    }
  | undefined
> {
  const candidates = [
    {
      file: "orval.config.ts",
      generatorName: "orval",
      command: ["pnpm", "orval"],
    },
    {
      file: "orval.config.js",
      generatorName: "orval",
      command: ["pnpm", "orval"],
    },
    {
      file: "openapi-generator.config.json",
      generatorName: "openapi-generator",
      command: ["pnpm", "openapi-generator-cli", "generate"],
    },
    {
      file: "swagger-typescript-api.config.ts",
      generatorName: "swagger-typescript-api",
      command: ["pnpm", "swagger-typescript-api"],
    },
    {
      file: "openapi-ts.config.ts",
      generatorName: "openapi-typescript",
      command: ["pnpm", "openapi-typescript"],
    },
  ];

  for (const candidate of candidates) {
    try {
      await readFile(path.join(projectRoot, candidate.file), "utf8");

      return {
        generatorName: candidate.generatorName,
        configPath: candidate.file,
        command: candidate.command,
      };
    } catch {
      // Try next candidate.
    }
  }

  return undefined;
}
