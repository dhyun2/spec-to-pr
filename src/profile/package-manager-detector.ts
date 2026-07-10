import { z } from "zod";

import { PackageManagerProfileSchema, type ProfileFinding } from "./contracts.js";
import type { ProjectProbe } from "./probe.js";

export type PackageManagerProfile = z.infer<typeof PackageManagerProfileSchema>;

const LOCKFILES = [
  ["pnpm", "pnpm-lock.yaml"],
  ["npm", "package-lock.json"],
  ["yarn", "yarn.lock"],
  ["bun", "bun.lockb"],
  ["bun", "bun.lock"],
] as const;

export async function detectPackageManager(
  probe: ProjectProbe,
  findings: ProfileFinding[],
): Promise<PackageManagerProfile> {
  const presentLockfiles: string[] = [];

  for (const [, lockfile] of LOCKFILES) {
    if (await probe.exists(lockfile)) {
      presentLockfiles.push(lockfile);
    }
  }

  const packageJson = await readPackageJson(probe, "package.json");
  const packageManagerField =
    typeof packageJson?.packageManager === "string" ? packageJson.packageManager : undefined;

  const detectedByField = detectFromPackageManagerField(packageManagerField);
  const detectedByLockfile = detectFromLockfiles(presentLockfiles);
  const candidates = new Set(
    [detectedByField, detectedByLockfile].filter(
      (value): value is PackageManagerProfile["name"] => value !== undefined,
    ),
  );

  if (candidates.size > 1) {
    findings.push({
      severity: "warning",
      code: "PACKAGE_MANAGER_CONFLICT",
      message: "Multiple package manager signals were found.",
      evidence: [
        `packageManager=${packageManagerField ?? "none"}`,
        `lockfiles=${presentLockfiles.join(", ")}`,
      ],
    });
  }

  const name = detectedByField ?? detectedByLockfile ?? "unknown";

  return PackageManagerProfileSchema.parse({
    name,
    confidence: name === "unknown" ? "unknown" : candidates.size > 1 ? "medium" : "high",
    lockfiles: presentLockfiles,
    ...(packageJson === undefined ? {} : { packageJsonPath: "package.json" }),
    ...(packageManagerField === undefined ? {} : { packageManagerField }),
    ...(installCommand(name) === undefined ? {} : { installCommand: installCommand(name) }),
    ...(runCommandPrefix(name) === undefined ? {} : { runCommandPrefix: runCommandPrefix(name) }),
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

function detectFromPackageManagerField(
  value: string | undefined,
): PackageManagerProfile["name"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value.startsWith("pnpm@")) return "pnpm";
  if (value.startsWith("npm@")) return "npm";
  if (value.startsWith("yarn@")) return "yarn";
  if (value.startsWith("bun@")) return "bun";

  return undefined;
}

function detectFromLockfiles(lockfiles: string[]): PackageManagerProfile["name"] | undefined {
  if (lockfiles.includes("pnpm-lock.yaml")) return "pnpm";
  if (lockfiles.includes("package-lock.json")) return "npm";
  if (lockfiles.includes("yarn.lock")) return "yarn";
  if (lockfiles.includes("bun.lockb") || lockfiles.includes("bun.lock")) return "bun";

  return undefined;
}

function installCommand(name: PackageManagerProfile["name"]): string | undefined {
  switch (name) {
    case "pnpm":
      return "pnpm install";
    case "npm":
      return "npm install";
    case "yarn":
      return "yarn install";
    case "bun":
      return "bun install";
    default:
      return undefined;
  }
}

function runCommandPrefix(name: PackageManagerProfile["name"]): string | undefined {
  switch (name) {
    case "pnpm":
      return "pnpm";
    case "npm":
      return "npm run";
    case "yarn":
      return "yarn";
    case "bun":
      return "bun run";
    default:
      return undefined;
  }
}
