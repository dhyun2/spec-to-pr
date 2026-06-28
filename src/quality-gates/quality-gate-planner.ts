import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  QUALITY_GATE_ORDER,
  QualityGateCommandOverrideSchema,
  QualityGateNameSchema,
  QualityGatePackageManagerSchema,
  QualityGatePlanSchema,
} from "./quality-gate-model.js";
import type {
  QualityGateCommandOverride,
  QualityGateName,
  QualityGatePackageManager,
  QualityGatePlan,
} from "./quality-gate-model.js";

const DEFAULT_TIMEOUT_MS = 120_000;

const GATE_KIND_BY_NAME = {
  lint: "lint",
  typecheck: "typecheck",
  build: "build",
  unit: "unit",
  component: "component",
  contract: "contract",
  acceptance: "acceptance",
} as const satisfies Record<QualityGateName, string>;

const SCRIPT_CANDIDATES = {
  lint: ["lint"],
  typecheck: ["typecheck", "check:types", "tsc"],
  build: ["build"],
  unit: ["test:unit", "unit", "test"],
  component: ["test:component", "component"],
  contract: ["test:contract", "contract"],
  acceptance: ["test:acceptance", "acceptance"],
} as const satisfies Record<QualityGateName, readonly string[]>;

export const PlanQualityGatesInputSchema = z
  .object({
    projectRoot: z.string().trim().min(1),
    gates: z.array(QualityGateNameSchema).min(1).optional(),
    commands: z.record(z.string(), QualityGateCommandOverrideSchema).optional(),
    timeoutMs: z.number().int().positive().max(600_000).default(DEFAULT_TIMEOUT_MS),
  })
  .strict();

type PackageJson = {
  packageManager?: string;
  scripts: Record<string, string>;
};

export async function planQualityGates(rawInput: unknown): Promise<QualityGatePlan> {
  const input = PlanQualityGatesInputSchema.parse(rawInput);
  const packageJson = await readPackageJson(input.projectRoot);
  const packageManager = await detectPackageManager(input.projectRoot, packageJson);
  const selectedGates = input.gates ?? [...QUALITY_GATE_ORDER];
  const overrides = normalizeOverrides(input.commands);

  const gates = selectedGates.map((gate) => {
    const kind = GATE_KIND_BY_NAME[gate];
    const override = overrides.get(gate);

    if (override !== undefined) {
      return {
        gate,
        kind,
        status: "planned" as const,
        command: override.command,
        args: override.args,
        cwd: override.cwd ?? input.projectRoot,
        timeoutMs: override.timeoutMs ?? input.timeoutMs,
      };
    }

    if (packageJson === undefined) {
      return {
        gate,
        kind,
        status: "skipped" as const,
        skipReason: "package.json was not found.",
      };
    }

    const script = findScript(packageJson.scripts, gate);

    if (script === undefined) {
      return {
        gate,
        kind,
        status: "skipped" as const,
        skipReason: `No package.json script found for ${gate}.`,
      };
    }

    const command = commandForScript(packageManager, script);

    if (command === undefined) {
      return {
        gate,
        kind,
        status: "skipped" as const,
        skipReason: "No supported package manager was detected.",
      };
    }

    return {
      gate,
      kind,
      status: "planned" as const,
      script,
      command: command.command,
      args: command.args,
      cwd: input.projectRoot,
      timeoutMs: input.timeoutMs,
    };
  });

  return QualityGatePlanSchema.parse({
    packageManager,
    projectRoot: input.projectRoot,
    gates,
  });
}

function normalizeOverrides(commands: Record<string, QualityGateCommandOverride> | undefined) {
  const result = new Map<QualityGateName, QualityGateCommandOverride>();

  Object.entries(commands ?? {}).forEach(([key, command]) => {
    const parsedKey = QualityGateNameSchema.safeParse(key);

    if (parsedKey.success) {
      result.set(parsedKey.data, command);
    }
  });

  return result;
}

async function readPackageJson(projectRoot: string): Promise<PackageJson | undefined> {
  try {
    const raw = await readFile(path.join(projectRoot, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }

    const object = parsed as Record<string, unknown>;
    const scripts = object.scripts;

    return {
      ...(typeof object.packageManager === "string"
        ? { packageManager: object.packageManager }
        : {}),
      scripts:
        typeof scripts === "object" && scripts !== null && !Array.isArray(scripts)
          ? Object.fromEntries(
              Object.entries(scripts).filter(
                (entry): entry is [string, string] => typeof entry[1] === "string",
              ),
            )
          : {},
    };
  } catch (error: unknown) {
    if (isMissingFile(error)) {
      return undefined;
    }

    throw error;
  }
}

async function detectPackageManager(
  projectRoot: string,
  packageJson: PackageJson | undefined,
): Promise<QualityGatePackageManager> {
  const fromField = packageJson?.packageManager;

  if (fromField !== undefined) {
    if (fromField.startsWith("pnpm@")) return "pnpm";
    if (fromField.startsWith("npm@")) return "npm";
    if (fromField.startsWith("yarn@")) return "yarn";
    if (fromField.startsWith("bun@")) return "bun";
  }

  if (await exists(path.join(projectRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(path.join(projectRoot, "package-lock.json"))) return "npm";
  if (await exists(path.join(projectRoot, "yarn.lock"))) return "yarn";
  if (
    (await exists(path.join(projectRoot, "bun.lockb"))) ||
    (await exists(path.join(projectRoot, "bun.lock")))
  ) {
    return "bun";
  }

  return packageJson === undefined ? "unknown" : "npm";
}

function findScript(scripts: Record<string, string>, gate: QualityGateName): string | undefined {
  return SCRIPT_CANDIDATES[gate].find((candidate) => scripts[candidate] !== undefined);
}

function commandForScript(
  packageManager: QualityGatePackageManager,
  script: string,
): { command: string; args: string[] } | undefined {
  switch (packageManager) {
    case "pnpm":
      return { command: "pnpm", args: [script] };
    case "npm":
    case "yarn":
    case "bun":
      return { command: packageManager, args: ["run", script] };
    default:
      return undefined;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && (error as { code?: unknown }).code === "ENOENT"
  );
}
