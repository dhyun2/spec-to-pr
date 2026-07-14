import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  accumulateUsage,
  decideBudgetAction,
  estimateSdkWorkload,
} from "../../packages/codex-sdk/src/workload-budget.js";
import {
  UsageCalibrationStore,
  calibrateTokenRange,
  isUsageCalibrationReadEnabled,
  isUsageCalibrationEligible,
  readCalibrationBestEffort,
  recordCalibrationBestEffort,
} from "../../packages/codex-sdk/src/usage-calibration.js";
import {
  buildCompactCheckpointPrompt,
  executeBudgetedBoundaryTurns,
} from "../../packages/codex-sdk/src/boundary-runner.js";

describe("Codex SDK workload budget", () => {
  it("counts input and output once while retaining cached and reasoning dimensions", () => {
    const usage = accumulateUsage(null, {
      input_tokens: 800,
      cached_input_tokens: 600,
      output_tokens: 200,
      reasoning_output_tokens: 100,
    });

    expect(usage.totalTokens).toBe(1_000);
    expect(usage.cachedInputTokens).toBe(600);
    expect(usage.reasoningOutputTokens).toBe(100);
    expect(usage.availability).toBe("complete");
  });

  it("preserves missing and partial usage instead of converting it to zero-token usage", () => {
    const unavailable = accumulateUsage(null, null);
    const partial = accumulateUsage(unavailable, {
      input_tokens: 800,
      cached_input_tokens: 600,
      output_tokens: 200,
      reasoning_output_tokens: 100,
    });

    expect(unavailable.availability).toBe("unavailable");
    expect(partial.availability).toBe("partial");
    expect(partial.totalTokens).toBe(1_000);
  });

  it("checkpoints once at 80% and never drops required validation", () => {
    const requiredValidations = ["functional", "design"];
    expect(
      decideBudgetAction({
        usedTokens: 79_999,
        hardLimitTokens: 100_000,
        checkpointed: false,
        workloadSize: "M",
        requiredValidations,
      }).action,
    ).toBe("continue");

    const checkpoint = decideBudgetAction({
      usedTokens: 80_000,
      hardLimitTokens: 100_000,
      checkpointed: false,
      workloadSize: "M",
      requiredValidations,
    });
    expect(checkpoint.action).toBe("checkpoint");
    expect(checkpoint.requiredValidations).toEqual(requiredValidations);

    expect(
      decideBudgetAction({
        usedTokens: 80_000,
        hardLimitTokens: 100_000,
        checkpointed: true,
        workloadSize: "M",
        requiredValidations,
      }).action,
    ).toBe("continue");
  });

  it("requires approval for smaller overruns and splitting for L/XL overruns", () => {
    const base = {
      usedTokens: 100_000,
      hardLimitTokens: 100_000,
      checkpointed: true,
      requiredValidations: ["functional"],
    } as const;

    expect(decideBudgetAction({ ...base, workloadSize: "S" }).action).toBe("approval-required");
    expect(decideBudgetAction({ ...base, workloadSize: "L" }).action).toBe("split-required");
    expect(decideBudgetAction({ ...base, workloadSize: "XL" }).requiredValidations).toEqual([
      "functional",
    ]);
  });

  it("returns an initial range and confidence for SDK intake", () => {
    const estimate = estimateSdkWorkload({
      deliveryMode: "figma",
      promptLength: 800,
      hasBrief: false,
      hasFigma: true,
      hasOpenApi: true,
    });

    expect(estimate.size).toMatch(/^(XS|S|M|L|XL)$/);
    expect(estimate.confidence).toBe("low");
    expect(estimate.tokenRange.max).toBeGreaterThan(estimate.tokenRange.min);
    expect(
      estimateSdkWorkload({
        deliveryMode: "auto",
        promptLength: 0,
        hasBrief: false,
        hasFigma: false,
        hasOpenApi: false,
      }).size,
    ).toBe("XS");
    expect(
      estimateSdkWorkload({
        deliveryMode: "brief",
        promptLength: 50_000,
        hasBrief: true,
        hasFigma: true,
        hasOpenApi: true,
      }).size,
    ).toBe("XL");
  });

  it("starts a compact fresh thread at the first completed boundary at or above 80%", async () => {
    const prompts: string[] = [];
    let threadNumber = 0;
    const client = {
      startThread: () => {
        threadNumber += 1;
        return {
          id: `thread-${threadNumber}`,
          run: async (prompt: string) => {
            prompts.push(prompt);
            return threadNumber === 1
              ? turnResult(80_000, workflowStatus("running", "prepare-contracts"))
              : turnResult(10_000, workflowStatus("completed"));
          },
        };
      },
      resumeThread: () => {
        throw new Error("not expected");
      },
    };

    const result = await executeBudgetedBoundaryTurns({
      client,
      initialPrompt: "sensitive original request",
      hardLimitTokens: 100_000,
      workloadSize: "M",
      requiredValidations: ["functional", "design"],
      maxTurns: 8,
    });

    expect(result.state).toBe("completed");
    expect(result.turnCount).toBe(2);
    expect(result.checkpointCount).toBe(1);
    expect(result.usage.totalTokens).toBe(90_000);
    expect(threadNumber).toBe(2);
    expect(prompts[1]).toContain("run_12345678");
    expect(prompts[1]).not.toContain("sensitive original request");
  });

  it("stops before another boundary at the hard limit and preserves validations", async () => {
    const client = {
      startThread: () => ({
        id: "thread-1",
        run: async () =>
          turnResult(
            100_000,
            workflowStatus("running", "implement", {
              size: "L",
              requiredValidations: ["functional", "design"],
            }),
          ),
      }),
      resumeThread: () => {
        throw new Error("not expected");
      },
    };

    const result = await executeBudgetedBoundaryTurns({
      client,
      initialPrompt: "implement",
      hardLimitTokens: 100_000,
      workloadSize: "L",
      requiredValidations: ["functional", "design"],
      maxTurns: 8,
    });

    expect(result.state).toBe("split-required");
    expect(result.requiredValidations).toEqual(["functional", "design"]);
    expect(result.turnCount).toBe(1);
  });

  it("stops when a nonterminal turn has no usage instead of bypassing the budget", async () => {
    const client = {
      startThread: () => ({
        id: "thread-1",
        run: async () => turnResult(null, workflowStatus("running", "implement")),
      }),
      resumeThread: () => {
        throw new Error("not expected");
      },
    };

    const result = await executeBudgetedBoundaryTurns({
      client,
      initialPrompt: "implement",
      hardLimitTokens: 100_000,
      workloadSize: "M",
      requiredValidations: ["functional"],
      maxTurns: 8,
    });

    expect(result.state).toBe("usage-unavailable");
    expect(result.usage.availability).toBe("unavailable");
  });

  it("requires a fresh workflow status on every action turn", async () => {
    let calls = 0;
    const client = {
      startThread: () => ({
        id: "thread-1",
        run: async () => {
          calls += 1;
          return calls === 1
            ? turnResult(10_000, workflowStatus("running", "implement"))
            : { finalResponse: "missing", items: [], usage: usageFor(10_000) };
        },
      }),
      resumeThread: () => {
        throw new Error("not expected");
      },
    };

    const result = await executeBudgetedBoundaryTurns({
      client,
      initialPrompt: "implement",
      hardLimitTokens: 100_000,
      workloadSize: "M",
      requiredValidations: ["functional"],
      maxTurns: 8,
    });

    expect(result.state).toBe("status-unavailable");
    expect(result.turnCount).toBe(2);
    expect(calls).toBe(2);
  });

  it("applies a caller output schema only to the final formatting turn", async () => {
    const options: Array<{ outputSchema?: unknown } | undefined> = [];
    let calls = 0;
    const schema = { type: "object", required: ["url"] };
    const client = {
      startThread: () => ({
        id: "thread-1",
        run: async (_prompt: string, turnOptions?: { outputSchema?: unknown }) => {
          options.push(turnOptions);
          calls += 1;
          if (calls === 1) return turnResult(10_000, workflowStatus("running", "implement"));
          if (calls === 2) return turnResult(10_000, workflowStatus("completed"));
          return {
            finalResponse: '{"url":"https://example.test/pr/1"}',
            items: [],
            usage: usageFor(1_000),
          };
        },
      }),
      resumeThread: () => {
        throw new Error("not expected");
      },
    };

    const result = await executeBudgetedBoundaryTurns({
      client,
      initialPrompt: "implement",
      outputSchema: schema,
      hardLimitTokens: 100_000,
      workloadSize: "M",
      requiredValidations: ["functional"],
      maxTurns: 8,
    });

    expect(result.state).toBe("completed");
    expect(result.finalResponse).toContain("example.test");
    expect(result.outputFormatting).toBe("applied");
    expect(options).toEqual([undefined, undefined, { outputSchema: schema }]);
  });

  it("preserves a terminal workflow result when optional output formatting fails", async () => {
    let calls = 0;
    const client = {
      startThread: () => ({
        id: "thread-1",
        run: async (_prompt: string, options?: { outputSchema?: unknown }) => {
          calls += 1;
          if (options?.outputSchema !== undefined) {
            throw new Error("schema formatting failed");
          }
          return turnResult(10_000, workflowStatus("completed"));
        },
      }),
      resumeThread: () => {
        throw new Error("not expected");
      },
    };

    const result = await executeBudgetedBoundaryTurns({
      client,
      initialPrompt: "finish",
      outputSchema: { type: "object" },
      hardLimitTokens: 100_000,
      workloadSize: "M",
      requiredValidations: ["functional"],
      maxTurns: 8,
    });

    expect(result.state).toBe("completed");
    expect(result.outputFormatting).toBe("failed");
    expect(result.finalResponse).toContain("run_12345678");
    expect(result.items).toHaveLength(1);
    expect(result.usage.totalTokens).toBe(10_000);
    expect(result.usage.availability).toBe("partial");
    expect(
      isUsageCalibrationEligible({
        completed: result.state === "completed",
        resumed: false,
        usageAvailability: result.usage.availability,
      }),
    ).toBe(false);
    expect(result.turnCount).toBe(1);
    expect(calls).toBe(2);
  });

  it("does not start a formatting turn after terminal work reaches the hard limit", async () => {
    let calls = 0;
    const client = {
      startThread: () => ({
        id: "thread-1",
        run: async () => {
          calls += 1;
          return turnResult(100_000, workflowStatus("completed"));
        },
      }),
      resumeThread: () => {
        throw new Error("not expected");
      },
    };

    const result = await executeBudgetedBoundaryTurns({
      client,
      initialPrompt: "finish",
      outputSchema: { type: "object" },
      hardLimitTokens: 100_000,
      workloadSize: "M",
      requiredValidations: ["functional"],
      maxTurns: 8,
    });

    expect(result.state).toBe("completed");
    expect(result.outputFormatting).toBe("budget-skipped");
    expect(result.turnCount).toBe(1);
    expect(calls).toBe(1);
  });

  it("adopts refined runtime workload and the authoritative validation list", async () => {
    let calls = 0;
    const client = {
      startThread: () => ({
        id: "thread-1",
        run: async () => {
          calls += 1;
          if (calls === 1) {
            return turnResult(
              50_000,
              workflowStatus("running", "prepare-contracts", {
                size: "S",
                hardLimitTokens: 100_000,
                requiredValidations: ["functional"],
              }),
            );
          }
          if (calls === 2) {
            return turnResult(
              60_000,
              workflowStatus("running", "implement", {
                size: "XL",
                hardLimitTokens: 600_000,
                requiredValidations: ["functional", "targeted-feature-e2e", "feature-video"],
              }),
            );
          }
          return turnResult(
            10_000,
            workflowStatus("completed", undefined, {
              size: "XL",
              hardLimitTokens: 600_000,
              requiredValidations: ["functional", "targeted-feature-e2e", "feature-video"],
            }),
          );
        },
      }),
      resumeThread: () => {
        throw new Error("not expected");
      },
    };

    const result = await executeBudgetedBoundaryTurns({
      client,
      initialPrompt: "implement",
      hardLimitTokens: 100_000,
      workloadSize: "S",
      budgetLocked: false,
      requiredValidations: ["functional"],
      maxTurns: 8,
    });

    expect(result.state).toBe("completed");
    expect(result.workloadSize).toBe("XL");
    expect(result.hardLimitTokens).toBe(600_000);
    expect(result.requiredValidations).toEqual([
      "functional",
      "targeted-feature-e2e",
      "feature-video",
    ]);
  });

  it("keeps history calibration active when runtime refines the workload size", async () => {
    const client = {
      startThread: () => ({
        id: "thread-1",
        run: async () =>
          turnResult(
            150_000,
            workflowStatus("running", "implement", {
              size: "XL",
              hardLimitTokens: 600_000,
              requiredValidations: ["functional"],
            }),
          ),
      }),
      resumeThread: () => {
        throw new Error("not expected");
      },
    };

    const result = await executeBudgetedBoundaryTurns({
      client,
      initialPrompt: "implement",
      hardLimitTokens: 100_000,
      workloadSize: "S",
      workloadHardLimits: { XL: 150_000 },
      budgetLocked: false,
      requiredValidations: ["functional"],
      maxTurns: 8,
    });

    expect(result.workloadSize).toBe("XL");
    expect(result.hardLimitTokens).toBe(150_000);
    expect(result.state).toBe("split-required");
  });

  it("keeps the resumable thread when 80% is reached on the final allowed turn", async () => {
    let starts = 0;
    const client = {
      startThread: () => {
        starts += 1;
        return {
          id: `thread-${starts}`,
          run: async () => turnResult(80_000, workflowStatus("running", "implement")),
        };
      },
      resumeThread: () => {
        throw new Error("not expected");
      },
    };

    const result = await executeBudgetedBoundaryTurns({
      client,
      initialPrompt: "implement",
      hardLimitTokens: 100_000,
      workloadSize: "M",
      requiredValidations: ["functional"],
      maxTurns: 1,
    });

    expect(result.state).toBe("turn-limit");
    expect(result.threadId).toBe("thread-1");
    expect(result.checkpointCount).toBe(0);
    expect(starts).toBe(1);
  });

  it("builds checkpoints from durable status handles without source payloads", () => {
    const prompt = buildCompactCheckpointPrompt(workflowStatus("running", "review-functional"), [
      "functional",
      "design",
    ]);

    expect(prompt).toContain("workflow_status");
    expect(prompt).toContain("review-functional");
    expect(prompt).toContain("requiredValidations");
    expect(prompt).toContain("Implement the checkout selector");
    expect(prompt).toContain("contracts/requirements.json");
    expect(prompt).not.toContain("promptText");
  });
});

describe("usage calibration", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  });

  it("stores numeric-only samples and strips unrecognized sensitive fields", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-usage-"));
    const filePath = path.join(directory, "usage.jsonl");
    const store = new UsageCalibrationStore(filePath);

    await store.record({
      version: 1,
      mode: "feature",
      workloadSize: "M",
      estimatedMinTokens: 90_000,
      estimatedMaxTokens: 180_000,
      hardLimitTokens: 180_000,
      inputTokens: 100_000,
      cachedInputTokens: 60_000,
      outputTokens: 20_000,
      reasoningOutputTokens: 8_000,
      totalTokens: 120_000,
      turnCount: 4,
      checkpointCount: 1,
      completed: true,
      recordedAtEpochMs: 1_700_000_000_000,
      prompt: "must-not-be-persisted",
      sourcePath: "/secret/repo",
    } as never);

    const raw = await readFile(filePath, "utf8");
    expect(raw).not.toContain("must-not-be-persisted");
    expect(raw).not.toContain("/secret/repo");
    await expect(store.read()).resolves.toHaveLength(1);
  });

  it("uses median and p90 completed samples only after enough matching history", () => {
    const samples = Array.from({ length: 10 }, (_, index) => ({
      version: 1 as const,
      mode: "feature" as const,
      workloadSize: "M" as const,
      estimatedMinTokens: 90_000,
      estimatedMaxTokens: 180_000,
      hardLimitTokens: 180_000,
      inputTokens: 80_000 + index * 1_000,
      cachedInputTokens: 40_000,
      outputTokens: 20_000,
      reasoningOutputTokens: 5_000,
      totalTokens: 100_000 + index * 1_000,
      turnCount: 4,
      checkpointCount: 0,
      completed: true,
      recordedAtEpochMs: 1_700_000_000_000 + index,
    }));

    const calibrated = calibrateTokenRange({
      mode: "feature",
      workloadSize: "M",
      fallback: { min: 90_000, max: 180_000 },
      samples,
    });

    expect(calibrated.sampleCount).toBe(10);
    expect(calibrated.source).toBe("calibrated");
    expect(calibrated.confidence).toBe("medium");
    expect(calibrated.min).toBeGreaterThanOrEqual(100_000);
    expect(calibrated.max).toBeLessThan(180_000);
  });

  it("isolates optional calibration read and write failures from workflow results", async () => {
    const failingStore = {
      read: async () => Promise.reject(new Error("EACCES")),
      record: async () => Promise.reject(new Error("EROFS")),
    };

    await expect(readCalibrationBestEffort(failingStore)).resolves.toEqual({
      samples: [],
      status: "unavailable",
    });
    await expect(recordCalibrationBestEffort(failingStore, {} as never)).resolves.toBe(
      "unavailable",
    );
  });

  it("learns only from fresh complete runs, never a resumed tail", () => {
    expect(isUsageCalibrationReadEnabled({ enabled: true, resumed: false })).toBe(true);
    expect(isUsageCalibrationReadEnabled({ enabled: true, resumed: true })).toBe(false);
    expect(
      isUsageCalibrationEligible({
        completed: true,
        resumed: false,
        usageAvailability: "complete",
      }),
    ).toBe(true);
    expect(
      isUsageCalibrationEligible({
        completed: true,
        resumed: true,
        usageAvailability: "complete",
      }),
    ).toBe(false);
    expect(
      isUsageCalibrationEligible({
        completed: true,
        resumed: false,
        usageAvailability: "partial",
      }),
    ).toBe(false);
  });
});

function workflowStatus(
  status: "running" | "completed",
  nextKind?: string,
  options: {
    size?: "XS" | "S" | "M" | "L" | "XL";
    hardLimitTokens?: number;
    requiredValidations?: string[];
  } = {},
) {
  const size = options.size ?? "M";
  const hardLimitTokens = options.hardLimitTokens ?? 180_000;
  return {
    runId: "run_12345678",
    status,
    ...(status === "completed" ? {} : { currentStage: "contracts" }),
    stages: [{ name: "intake", status: "passed" }],
    nextActions: nextKind === undefined ? [] : [{ kind: nextKind, runId: "run_12345678" }],
    blockers: [],
    requiredValidations: options.requiredValidations ?? ["functional"],
    resumeContext: {
      goal: "Implement the checkout selector",
      evidencePaths: ["contracts/requirements.json"],
      submissions: [
        { kind: "contracts", summary: "Mapped checkout requirements", outcome: "passed" },
      ],
    },
    workload: {
      size,
      confidence: "low" as const,
      source: "intake" as const,
      tokenRange: { min: Math.floor(hardLimitTokens / 2), max: hardLimitTokens },
      budget: {
        checkpointPercent: 80 as const,
        checkpointAtTokens: Math.floor(hardLimitTokens * 0.8),
        hardLimitTokens,
      },
    },
  };
}

function turnResult(totalTokens: number | null, status: ReturnType<typeof workflowStatus>) {
  return {
    finalResponse: JSON.stringify(status),
    items: [
      {
        id: `item-${String(totalTokens)}`,
        type: "mcp_tool_call" as const,
        server: "spec-to-pr",
        tool: "workflow_status",
        arguments: { runId: status.runId },
        result: { content: [], structured_content: status },
        status: "completed" as const,
      },
    ],
    usage: totalTokens === null ? null : usageFor(totalTokens),
  };
}

function usageFor(totalTokens: number) {
  return {
    input_tokens: totalTokens - 1_000,
    cached_input_tokens: 0,
    output_tokens: 1_000,
    reasoning_output_tokens: 0,
  };
}
