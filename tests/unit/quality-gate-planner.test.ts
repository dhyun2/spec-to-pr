import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { planQualityGates } from "../../src/quality-gates/quality-gate-planner.js";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-quality-plan-"));
});

afterEach(async () => {
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("planQualityGates", () => {
  it("detects package manager scripts in deterministic gate order", async () => {
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify(
        {
          packageManager: "pnpm@9.0.0",
          scripts: {
            lint: "eslint .",
            typecheck: "tsc --noEmit",
            test: "vitest run",
            "test:contract": "vitest run contract",
            "test:security": "vitest run security",
          },
        },
        null,
        2,
      ),
    );

    const plan = await planQualityGates({
      projectRoot: directory,
      gates: ["lint", "typecheck", "unit", "component", "contract", "security"],
    });

    expect(plan.packageManager).toBe("pnpm");
    expect(plan.gates.map((gate) => gate.gate)).toEqual([
      "lint",
      "typecheck",
      "unit",
      "component",
      "contract",
      "security",
    ]);
    expect(plan.gates[0]).toMatchObject({
      status: "planned",
      command: "pnpm",
      args: ["lint"],
    });
    expect(plan.gates[2]).toMatchObject({
      status: "planned",
      script: "test",
    });
    expect(plan.gates[3]).toMatchObject({
      status: "skipped",
    });
    expect(plan.gates[4]).toMatchObject({
      status: "planned",
      script: "test:contract",
    });
    expect(plan.gates[5]).toMatchObject({
      status: "planned",
      script: "test:security",
    });
  });

  it("uses explicit command overrides", async () => {
    const plan = await planQualityGates({
      projectRoot: directory,
      gates: ["build"],
      commands: {
        build: {
          command: "node",
          args: ["-e", "process.exit(0)"],
          timeoutMs: 1000,
        },
      },
    });

    expect(plan.gates).toHaveLength(1);
    expect(plan.gates[0]).toMatchObject({
      gate: "build",
      status: "planned",
      command: "node",
      args: ["-e", "process.exit(0)"],
      timeoutMs: 1000,
    });
  });

  it("plans OpenSpec checks and preserves per-command environment overrides", async () => {
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify(
        {
          packageManager: "pnpm@9.0.0",
          scripts: {
            "openspec:check": "openspec check --strict",
          },
        },
        null,
        2,
      ),
    );

    const plan = await planQualityGates({
      projectRoot: directory,
      gates: ["openspec"],
      commands: {
        openspec: {
          command: "pnpm",
          args: ["openspec:check"],
          env: {
            PATH: "/opt/node-v22/bin:${PATH}",
            NODE_OPTIONS: "--max-old-space-size=4096",
          },
        },
      },
    });

    expect(plan.gates[0]).toMatchObject({
      gate: "openspec",
      kind: "openspec",
      status: "planned",
      command: "pnpm",
      args: ["openspec:check"],
      env: {
        PATH: "/opt/node-v22/bin:${PATH}",
        NODE_OPTIONS: "--max-old-space-size=4096",
      },
    });
  });

  it("prepends a compatible Node version from .nvmrc when the plugin Node is outside project engines", async () => {
    await mkdir(path.join(directory, ".nvm", "versions", "node", "v18.19.0", "bin"), {
      recursive: true,
    });
    await writeFile(
      path.join(directory, ".nvm", "versions", "node", "v18.19.0", "bin", "node"),
      "",
    );
    await writeFile(path.join(directory, ".nvmrc"), "18.19.0\n");
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify(
        {
          packageManager: "pnpm@9.0.0",
          engines: {
            node: ">=18.19.0 <19",
          },
          scripts: {
            build: "vite build",
          },
        },
        null,
        2,
      ),
    );

    const previousNvmDir = process.env.NVM_DIR;
    process.env.NVM_DIR = path.join(directory, ".nvm");

    try {
      const plan = await planQualityGates({
        projectRoot: directory,
        gates: ["build"],
      });

      expect(plan.gates[0]).toMatchObject({
        status: "planned",
        env: {
          PATH: `${path.join(directory, ".nvm", "versions", "node", "v18.19.0", "bin")}:${"${PATH}"}`,
          SPEC_TO_PR_NODE_VERSION: "18.19.0",
        },
      });
    } finally {
      if (previousNvmDir === undefined) {
        delete process.env.NVM_DIR;
      } else {
        process.env.NVM_DIR = previousNvmDir;
      }
    }
  });

  it("selects an installed Node version that satisfies package engines.node ranges", async () => {
    await mkdir(path.join(directory, ".nvm", "versions", "node", "v22.20.0", "bin"), {
      recursive: true,
    });
    await writeFile(
      path.join(directory, ".nvm", "versions", "node", "v22.20.0", "bin", "node"),
      "",
    );
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify(
        {
          packageManager: "pnpm@9.0.0",
          engines: {
            node: ">=22.12.0 <23",
          },
          scripts: {
            typecheck: "tsc --noEmit",
          },
        },
        null,
        2,
      ),
    );

    const previousNvmDir = process.env.NVM_DIR;
    process.env.NVM_DIR = path.join(directory, ".nvm");

    try {
      const plan = await planQualityGates({
        projectRoot: directory,
        gates: ["typecheck"],
      });

      expect(plan.gates[0]).toMatchObject({
        status: "planned",
        env: {
          PATH: `${path.join(directory, ".nvm", "versions", "node", "v22.20.0", "bin")}:${"${PATH}"}`,
          SPEC_TO_PR_NODE_VERSION: "22.20.0",
        },
      });
    } finally {
      if (previousNvmDir === undefined) {
        delete process.env.NVM_DIR;
      } else {
        process.env.NVM_DIR = previousNvmDir;
      }
    }
  });
});
