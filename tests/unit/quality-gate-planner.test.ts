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
          },
        },
        null,
        2,
      ),
    );

    const plan = await planQualityGates({
      projectRoot: directory,
      gates: ["lint", "typecheck", "unit", "component", "contract"],
    });

    expect(plan.packageManager).toBe("pnpm");
    expect(plan.gates.map((gate) => gate.gate)).toEqual([
      "lint",
      "typecheck",
      "unit",
      "component",
      "contract",
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
});
