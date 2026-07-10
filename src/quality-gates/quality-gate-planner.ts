import { access, readFile, readdir } from "node:fs/promises";
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
  openspec: "openspec",
  security: "security",
} as const satisfies Record<QualityGateName, string>;

const SCRIPT_CANDIDATES = {
  lint: ["lint"],
  typecheck: ["typecheck", "check:types", "tsc"],
  build: ["build"],
  unit: ["test:unit", "unit", "test"],
  component: ["test:component", "component"],
  contract: ["test:contract", "contract"],
  acceptance: ["test:acceptance", "acceptance"],
  openspec: ["openspec:check", "check:openspec", "openspec:validate", "openspec"],
  security: ["test:security", "security", "audit"],
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
  enginesNode?: string;
  scripts: Record<string, string>;
};

export async function planQualityGates(rawInput: unknown): Promise<QualityGatePlan> {
  const input = PlanQualityGatesInputSchema.parse(rawInput);
  const packageJson = await readPackageJson(input.projectRoot);
  const packageManager = await detectPackageManager(input.projectRoot, packageJson);
  const selectedGates = input.gates ?? [...QUALITY_GATE_ORDER];
  const overrides = normalizeOverrides(input.commands);
  const projectNodeEnv = await resolveProjectNodeEnv(input.projectRoot, packageJson);

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
        ...optionalEnv(mergeCommandEnv(projectNodeEnv, override.env)),
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
      ...optionalEnv(projectNodeEnv),
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
      ...readEnginesNode(object.engines),
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

function readEnginesNode(value: unknown): Pick<PackageJson, "enginesNode"> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  const node = (value as Record<string, unknown>).node;

  return typeof node === "string" && node.trim().length > 0 ? { enginesNode: node.trim() } : {};
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

async function resolveProjectNodeEnv(
  projectRoot: string,
  packageJson: PackageJson | undefined,
): Promise<Record<string, string> | undefined> {
  const desiredVersion = await readDesiredNodeVersion(projectRoot);
  const enginesNode = packageJson?.enginesNode;
  const selectedVersion = desiredVersion ?? versionFromEngineRange(enginesNode);

  if (selectedVersion === undefined) {
    return undefined;
  }

  if (nodeVersionSatisfies(process.versions.node, enginesNode ?? selectedVersion)) {
    return undefined;
  }

  const nodeSelection = await findInstalledNode({
    projectRoot,
    selectedVersion,
    ...(desiredVersion === undefined ? {} : { exactVersion: desiredVersion }),
    ...(enginesNode === undefined ? {} : { enginesNode }),
  });

  if (nodeSelection === undefined) {
    return undefined;
  }

  return {
    PATH: `${nodeSelection.binDirectory}:${"${PATH}"}`,
    SPEC_TO_PR_NODE_VERSION: nodeSelection.version,
  };
}

async function readDesiredNodeVersion(projectRoot: string): Promise<string | undefined> {
  for (const fileName of [".nvmrc", ".node-version"]) {
    try {
      const raw = await readFile(path.join(projectRoot, fileName), "utf8");
      const normalized = normalizeNodeVersion(raw);

      if (normalized !== undefined) {
        return normalized;
      }
    } catch (error: unknown) {
      if (!isMissingFile(error)) {
        throw error;
      }
    }
  }

  return undefined;
}

function normalizeNodeVersion(raw: string): string | undefined {
  const trimmed = raw.trim().replace(/^v/, "");

  return /^\d+\.\d+\.\d+$/.test(trimmed) ? trimmed : undefined;
}

function versionFromEngineRange(range: string | undefined): string | undefined {
  if (range === undefined) {
    return undefined;
  }

  return range.match(/>=\s*v?(\d+\.\d+\.\d+)/)?.[1];
}

type InstalledNodeSelection = {
  version: string;
  binDirectory: string;
};

async function findInstalledNode(input: {
  projectRoot: string;
  selectedVersion: string;
  exactVersion?: string;
  enginesNode?: string;
}): Promise<InstalledNodeSelection | undefined> {
  if (input.exactVersion !== undefined) {
    const exactBin = await findExactInstalledNodeBin(input.projectRoot, input.exactVersion);

    return exactBin === undefined
      ? undefined
      : {
          version: input.exactVersion,
          binDirectory: exactBin,
        };
  }

  const scanned = await scanInstalledNodeBins(input.projectRoot, input.enginesNode);

  if (scanned.length > 0) {
    return scanned.sort((left, right) =>
      compareVersions(parseVersion(right.version), parseVersion(left.version)),
    )[0];
  }

  const exactBin = await findExactInstalledNodeBin(input.projectRoot, input.selectedVersion);

  return exactBin === undefined
    ? undefined
    : {
        version: input.selectedVersion,
        binDirectory: exactBin,
      };
}

async function findExactInstalledNodeBin(
  projectRoot: string,
  version: string,
): Promise<string | undefined> {
  const candidates = [
    process.env.NVM_DIR === undefined
      ? undefined
      : path.join(process.env.NVM_DIR, "versions", "node", `v${version}`, "bin"),
    process.env.FNM_DIR === undefined
      ? undefined
      : path.join(process.env.FNM_DIR, "node-versions", `v${version}`, "installation", "bin"),
    path.join(projectRoot, ".nvm", "versions", "node", `v${version}`, "bin"),
  ].filter((candidate): candidate is string => candidate !== undefined);

  for (const candidate of candidates) {
    if (await exists(path.join(candidate, "node"))) {
      return candidate;
    }
  }

  return undefined;
}

async function scanInstalledNodeBins(
  projectRoot: string,
  enginesNode: string | undefined,
): Promise<InstalledNodeSelection[]> {
  const selections: InstalledNodeSelection[] = [];

  for (const root of nvmVersionRoots(projectRoot)) {
    for (const version of await readNodeVersionEntries(root)) {
      const binDirectory = path.join(root, `v${version}`, "bin");

      if (
        (enginesNode === undefined || nodeVersionSatisfies(version, enginesNode)) &&
        (await exists(path.join(binDirectory, "node")))
      ) {
        selections.push({ version, binDirectory });
      }
    }
  }

  for (const root of fnmVersionRoots()) {
    for (const version of await readNodeVersionEntries(root)) {
      const binDirectory = path.join(root, `v${version}`, "installation", "bin");

      if (
        (enginesNode === undefined || nodeVersionSatisfies(version, enginesNode)) &&
        (await exists(path.join(binDirectory, "node")))
      ) {
        selections.push({ version, binDirectory });
      }
    }
  }

  return selections;
}

function nvmVersionRoots(projectRoot: string): string[] {
  return [
    process.env.NVM_DIR === undefined
      ? undefined
      : path.join(process.env.NVM_DIR, "versions", "node"),
    path.join(projectRoot, ".nvm", "versions", "node"),
  ].filter((root): root is string => root !== undefined);
}

function fnmVersionRoots(): string[] {
  return [
    process.env.FNM_DIR === undefined ? undefined : path.join(process.env.FNM_DIR, "node-versions"),
  ].filter((root): root is string => root !== undefined);
}

async function readNodeVersionEntries(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => normalizeNodeVersion(entry.name))
      .filter((version): version is string => version !== undefined);
  } catch (error: unknown) {
    if (isMissingFile(error)) {
      return [];
    }

    throw error;
  }
}

function nodeVersionSatisfies(version: string, range: string): boolean {
  const parsed = parseVersion(version);
  const comparators = range.match(/(>=|>|<=|<|=)?\s*v?\d+(?:\.\d+){0,2}/g) ?? [];

  if (comparators.length === 0) {
    const exact = parseVersion(range);

    return exact === undefined ? true : compareVersions(parsed, exact) === 0;
  }

  return comparators.every((comparator) => {
    const match = comparator.trim().match(/^(>=|>|<=|<|=)?\s*v?(\d+(?:\.\d+){0,2})$/);

    if (match === null) {
      return true;
    }

    const operator = match[1] ?? "=";
    const target = parseVersion(match[2] ?? "");

    if (target === undefined) {
      return true;
    }

    const comparison = compareVersions(parsed, target);

    switch (operator) {
      case ">=":
        return comparison >= 0;
      case ">":
        return comparison > 0;
      case "<=":
        return comparison <= 0;
      case "<":
        return comparison < 0;
      default:
        return comparison === 0;
    }
  });
}

function parseVersion(version: string): [number, number, number] | undefined {
  const match = version
    .trim()
    .replace(/^v/, "")
    .match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);

  if (match === null) {
    return undefined;
  }

  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function compareVersions(
  left: [number, number, number] | undefined,
  right: [number, number, number] | undefined,
): number {
  if (left === undefined || right === undefined) {
    return 0;
  }

  for (let index = 0; index < 3; index += 1) {
    const delta = left[index]! - right[index]!;

    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

function mergeCommandEnv(
  base: Record<string, string> | undefined,
  override: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (base === undefined && override === undefined) {
    return undefined;
  }

  return {
    ...(base ?? {}),
    ...(override ?? {}),
  };
}

function optionalEnv(
  env: Record<string, string> | undefined,
): { env: Record<string, string> } | {} {
  return env === undefined || Object.keys(env).length === 0 ? {} : { env };
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
