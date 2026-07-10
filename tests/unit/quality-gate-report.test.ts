import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  readCoverageSummary,
  renderQualityGateReportMarkdown,
} from "../../src/quality-gates/quality-gate-report.js";
import { CheckResultSchema } from "../../src/runtime/check.js";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-quality-report-"));
});

afterEach(async () => {
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("quality gate report helpers", () => {
  it("reads Istanbul coverage summary files", async () => {
    await mkdir(path.join(directory, "coverage"), {
      recursive: true,
    });
    await writeFile(
      path.join(directory, "coverage", "coverage-summary.json"),
      JSON.stringify({
        total: {
          lines: { total: 10, covered: 8, skipped: 0, pct: 80 },
          statements: { total: 12, covered: 9, skipped: 0, pct: 75 },
          functions: { total: 4, covered: 4, skipped: 0, pct: 100 },
          branches: { total: 6, covered: 3, skipped: 0, pct: 50 },
        },
      }),
    );

    const result = await readCoverageSummary({
      projectRoot: directory,
      relativePath: "coverage/coverage-summary.json",
    });

    expect(result.coverageSummary).toMatchObject({
      path: "coverage/coverage-summary.json",
      lines: {
        pct: 80,
      },
      branches: {
        covered: 3,
      },
    });
  });

  it("renders markdown summary", () => {
    const markdown = renderQualityGateReportMarkdown({
      adapter: "quality-gate-runner-v1",
      runId: "run_11111111111111111111111111111111",
      projectRoot: directory,
      packageManager: "pnpm",
      status: "passed",
      startedAt: "2026-06-23T00:00:00.000Z",
      completedAt: "2026-06-23T00:00:00.000Z",
      durationMs: 0,
      gateCount: 1,
      passedCount: 1,
      failedCount: 0,
      skippedCount: 0,
      checks: [
        CheckResultSchema.parse({
          id: "chk_11111111111111111111111111111111",
          name: "typecheck",
          kind: "typecheck",
          status: "passed",
          command: "pnpm typecheck",
          summary: "typecheck passed.",
        }),
      ],
      warnings: [],
    });

    expect(markdown).toContain("# Quality Gate Report");
    expect(markdown).toContain("| typecheck | typecheck | passed | pnpm typecheck |");
  });
});
