import { z } from "zod";

import { WorkspaceProfileSchema, type ProfileFinding } from "./contracts.js";
import type { ProjectProbe } from "./probe.js";

export type WorkspaceProfile = z.infer<typeof WorkspaceProfileSchema>;

export async function detectWorkspace(
  probe: ProjectProbe,
  findings: ProfileFinding[],
): Promise<WorkspaceProfile> {
  const rootPackageJson = await readPackageJson(probe, "package.json");
  const patterns = new Set<string>();

  const workspaceField = rootPackageJson?.workspaces;

  if (Array.isArray(workspaceField)) {
    workspaceField.forEach((item) => {
      if (typeof item === "string") {
        patterns.add(item);
      }
    });
  }

  if (
    typeof workspaceField === "object" &&
    workspaceField !== null &&
    !Array.isArray(workspaceField) &&
    Array.isArray((workspaceField as { packages?: unknown }).packages)
  ) {
    (workspaceField as { packages: unknown[] }).packages.forEach((item) => {
      if (typeof item === "string") {
        patterns.add(item);
      }
    });
  }

  const pnpmWorkspace = await probe.readText("pnpm-workspace.yaml");

  if (pnpmWorkspace !== undefined) {
    extractPnpmWorkspacePatterns(pnpmWorkspace).forEach((pattern) => patterns.add(pattern));
  }

  const packages = await discoverWorkspacePackages(probe, [...patterns]);

  if (patterns.size > 0 && packages.length === 0) {
    findings.push({
      severity: "warning",
      code: "WORKSPACE_PATTERNS_WITH_NO_PACKAGES",
      message: "Workspace patterns were detected but no package.json files were found.",
      evidence: [...patterns],
    });
  }

  return WorkspaceProfileSchema.parse({
    isMonorepo: patterns.size > 0 || packages.length > 1,
    ...(rootPackageJson === undefined ? {} : { rootPackageJson: "package.json" }),
    patterns: [...patterns],
    packages,
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

function extractPnpmWorkspacePatterns(text: string): string[] {
  const result: string[] = [];
  const lines = text.split(/\r?\n/);
  let inPackages = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "packages:") {
      inPackages = true;
      continue;
    }

    if (inPackages && trimmed.startsWith("-")) {
      result.push(trimmed.replace(/^-/, "").trim().replace(/^["']|["']$/g, ""));
      continue;
    }

    if (inPackages && trimmed !== "" && !line.startsWith(" ")) {
      break;
    }
  }

  return result;
}

async function discoverWorkspacePackages(probe: ProjectProbe, patterns: string[]) {
  const roots = new Set<string>();

  for (const pattern of patterns) {
    const normalized = pattern.replace(/\/\*+$/, "");

    if (normalized.includes("*") || normalized.startsWith("!")) {
      continue;
    }

    roots.add(normalized);
  }

  ["apps", "packages"].forEach((item) => roots.add(item));

  const packages = [];

  for (const root of roots) {
    const children = await probe.list(root);

    for (const child of children) {
      const packageJsonPath = `${root}/${child}/package.json`;
      const value = await probe.readJson(packageJsonPath);

      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        const object = value as Record<string, unknown>;
        const scripts = object.scripts;

        packages.push({
          ...(typeof object.name === "string" ? { name: object.name } : {}),
          path: `${root}/${child}`,
          packageJsonPath,
          ...(typeof object.private === "boolean" ? { private: object.private } : {}),
          scripts:
            typeof scripts === "object" && scripts !== null && !Array.isArray(scripts)
              ? Object.fromEntries(
                  Object.entries(scripts).filter(
                    (entry): entry is [string, string] => typeof entry[1] === "string",
                  ),
                )
              : {},
        });
      }
    }
  }

  return packages;
}
