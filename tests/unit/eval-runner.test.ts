import { describe, expect, it } from "vitest";

import {
  DEFAULT_EVAL_SUITE_ID,
  EvalRunner,
  listDefaultEvalCases,
} from "../../src/release/index.js";

describe("eval runner", () => {
  it("lists the default release-readiness suite", () => {
    const runner = new EvalRunner({
      now: () => "2026-06-28T00:00:00.000Z",
    });

    expect(runner.listSuites()).toEqual([
      {
        id: DEFAULT_EVAL_SUITE_ID,
        caseCount: listDefaultEvalCases().length,
      },
    ]);
  });

  it("runs static release readiness cases", async () => {
    const runner = new EvalRunner({
      now: () => "2026-06-28T00:00:00.000Z",
    });
    const report = await runner.runSuite();

    expect(report.status).toBe("passed");
    expect(report.caseCount).toBeGreaterThan(0);
    expect(report.failedCount).toBe(0);
    expect(report.results.map((result) => result.status)).toEqual(
      Array.from({ length: report.caseCount }, () => "passed"),
    );
  });
});
