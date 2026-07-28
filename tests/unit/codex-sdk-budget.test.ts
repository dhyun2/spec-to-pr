import { access, link, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  accumulateUsage,
  decideBudgetAction,
  effectiveHardLimitForWorkload,
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
  buildBlockedDiagnosticFinalizationPrompt,
  buildBoundaryContinuationPrompt,
  buildCompactCheckpointPrompt,
  executeBudgetedBoundaryTurns,
  extractWorkflowStatus,
  type BoundaryWorkflowStatus,
} from "../../packages/codex-sdk/src/boundary-runner.js";
import { DEFAULT_BLOCKED_DIAGNOSTIC_TOKEN_RESERVE } from "../../packages/codex-sdk/src/spec-to-pr-runner.js";

describe("Codex SDK workload budget", () => {
  it("defaults the blocked-diagnostic reserve to deterministic 50% headroom", () => {
    expect(DEFAULT_BLOCKED_DIAGNOSTIC_TOKEN_RESERVE).toBe(24_000);
  });
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

  it("requires scope splitting for every hard-limit overrun", () => {
    const base = {
      usedTokens: 100_000,
      hardLimitTokens: 100_000,
      checkpointed: true,
      requiredValidations: ["functional"],
    } as const;

    expect(decideBudgetAction({ ...base, workloadSize: "S" }).action).toBe("split-required");
    expect(decideBudgetAction({ ...base, workloadSize: "L" }).action).toBe("split-required");
    expect(decideBudgetAction({ ...base, workloadSize: "XL" }).requiredValidations).toEqual([
      "functional",
    ]);
  });

  it("keeps the automatic hard limit independent from calibrated ranges", () => {
    expect(effectiveHardLimitForWorkload("M")).toBe(180_000);
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

  it("pins the first durable run id and stops on a later mismatch", async () => {
    let calls = 0;
    const client = {
      startThread: () => ({
        id: "thread-1",
        run: async () => {
          calls += 1;
          return turnResult(
            10_000,
            workflowStatus("running", "implement", {
              runId: calls === 1 ? "run_12345678" : "run_wrong_9999",
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
      workloadSize: "M",
      requiredValidations: ["functional"],
      maxTurns: 8,
    });

    expect(result.state).toBe("run-mismatch");
    expect(result.workflowStatus?.runId).toBe("run_12345678");
    expect(result.turnCount).toBe(2);
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

  it("does not let later authoritative statuses shrink required validations", async () => {
    let calls = 0;
    const client = {
      startThread: () => ({
        id: "thread-1",
        run: async () => {
          calls += 1;
          if (calls === 1) {
            return turnResult(
              10_000,
              workflowStatus("running", "implement", {
                requiredValidations: ["functional", "visual"],
              }),
            );
          }
          return turnResult(
            100_000,
            workflowStatus("running", "review-functional", {
              requiredValidations: ["functional"],
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
      workloadSize: "M",
      requiredValidations: ["functional"],
      maxTurns: 8,
    });

    expect(result.state).toBe("split-required");
    expect(result.requiredValidations).toEqual(["functional", "visual"]);
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
      workloadHardLimits: { XL: 600_000 },
      requiredValidations: ["functional"],
      maxTurns: 8,
    });

    expect(result.workloadSize).toBe("XL");
    expect(result.hardLimitTokens).toBe(600_000);
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
    const prompt = buildCompactCheckpointPrompt(
      workflowStatus("running", "review-functional"),
      ["functional", "design"],
      { usedTokens: 144_000, hardLimitTokens: 180_000 },
    );

    expect(prompt).toContain('workflow_status with {"runId":"run_12345678","view":"checkpoint"}');
    expect(prompt).toContain("review-functional");
    expect(prompt).toContain("requiredValidations");
    expect(prompt).toContain("Implement the checkout selector");
    expect(prompt).toContain("contracts/requirements.json");
    expect(prompt).toContain('"usedTokens":144000');
    expect(prompt).toContain('"remainingTokens":36000');
    expect(prompt).toContain('"checkpointAtTokens":144000');
    expect(prompt).toContain('"hardLimitTokens":180000');
    expect(prompt).not.toContain("promptText");
  });

  it("requests the smallest status view needed at each SDK boundary", () => {
    const implementation = buildBoundaryContinuationPrompt(
      workflowStatus("running", "implement"),
      ["functional"],
      { usedTokens: 12_000, hardLimitTokens: 48_000 },
    );
    const reviewer = buildBoundaryContinuationPrompt(
      workflowStatus("running", "review-functional"),
      ["functional"],
      { usedTokens: 12_000, hardLimitTokens: 48_000 },
    );
    const report = buildBoundaryContinuationPrompt(
      { ...workflowStatus("running"), currentStage: "report" },
      ["functional"],
      { usedTokens: 12_000, hardLimitTokens: 48_000 },
    );

    expect(implementation).toContain(
      'workflow_status with {"runId":"run_12345678","view":"action"}',
    );
    expect(implementation).not.toContain('"view":"detail"');
    expect(reviewer).toContain('workflow_status with {"runId":"run_12345678","view":"action"}');
    expect(reviewer).toContain('workflow_status with {"runId":"run_12345678","view":"detail"}');
    expect(reviewer).toContain("immutable reviewer evidence");
    expect(report).toContain('workflow_status with {"runId":"run_12345678","view":"detail"}');
  });

  it("projects blocker, publication, delegation, and diagnostic publication status", () => {
    const status = workflowStatus("blocked", undefined, {
      publication: "draft",
      blockerKind: "verification",
      diagnosticPublication: {
        host: "github",
        url: "https://github.com/example/repo/pull/42",
        number: "42",
        created: true,
        updated: false,
        publishResultArtifactId: "artifact_publish_12345678",
      },
    });

    expect(extractWorkflowStatus(turnResult(1_000, status).items)).toMatchObject({
      revision: 7,
      deliveryProfile: { publication: "draft" },
      delegationPolicy: {
        singleWriter: true,
        allowNested: false,
        maxReadOnlyScouts: 1,
        parallelReviewers: false,
      },
      blockerDetails: [{ kind: "verification", retryable: false }],
      diagnosticPublication: {
        host: "github",
        number: "42",
      },
    });
  });

  it("holds the last normal turn for a blocked draft diagnostic finalization", async () => {
    const prompts: string[] = [];
    let calls = 0;
    const initialBlockedStatus = workflowStatus("blocked", undefined, {
      hardLimitTokens: 48_000,
      publication: "draft",
      blockerKind: "verification",
    });
    const client = {
      startThread: () => ({
        id: "thread-1",
        run: async (prompt: string) => {
          prompts.push(prompt);
          calls += 1;
          return turnResult(
            16_000,
            calls === 1
              ? initialBlockedStatus
              : workflowStatus("blocked", undefined, {
                  hardLimitTokens: 48_000,
                  publication: "draft",
                  blockerKind: "verification",
                  diagnosticPublication: {
                    host: "github" as const,
                    url: "https://github.com/example/repo/pull/42",
                    number: "42",
                    created: true,
                    updated: false,
                    publishResultArtifactId: "artifact_publish_12345678",
                  },
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
      hardLimitTokens: 48_000,
      workloadSize: "M",
      requiredValidations: ["functional"],
      maxTurns: 2,
      blockedDiagnosticTokenReserve: 24_000,
      inspectBlockedDiagnosticPreflight: () => ({
        eligible: true,
        sourceBranch: "codex/checkout",
        targetBranch: "main",
        remoteName: "origin",
      }),
    });

    expect(result.state).toBe("blocked");
    expect(result.turnCount).toBe(2);
    expect(calls).toBe(2);
    expect(prompts[1]).toContain('intent: "blocked-diagnostic"');
  });

  it("does not launch blocked finalization when the first blocked turn already consumed the reserve", async () => {
    let calls = 0;
    const client = {
      startThread: () => ({
        id: "thread-1",
        run: async () => {
          calls += 1;
          return turnResult(
            40_000,
            workflowStatus("blocked", undefined, {
              hardLimitTokens: 48_000,
              publication: "draft",
              blockerKind: "verification",
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
      outputSchema: { type: "object" },
      hardLimitTokens: 48_000,
      workloadSize: "M",
      requiredValidations: ["functional"],
      maxTurns: 2,
      blockedDiagnosticTokenReserve: 24_000,
      inspectBlockedDiagnosticPreflight: () => ({
        eligible: true,
        sourceBranch: "codex/checkout",
        targetBranch: "main",
        remoteName: "origin",
      }),
    });

    expect(result.state).toBe("blocked");
    expect(result.outputFormatting).toBe("budget-skipped");
    expect(result.turnCount).toBe(1);
    expect(calls).toBe(1);
  });

  it("does not let nonterminal draft work consume its reserved finalization turn", async () => {
    let calls = 0;
    const client = {
      startThread: () => ({
        id: "thread-1",
        run: async () => {
          calls += 1;
          return turnResult(
            1_000,
            workflowStatus("running", undefined, {
              hardLimitTokens: 48_000,
              publication: "draft",
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
      hardLimitTokens: 48_000,
      workloadSize: "M",
      requiredValidations: ["functional"],
      maxTurns: 2,
      blockedDiagnosticTokenReserve: 24_000,
    });

    expect(result.state).toBe("turn-limit");
    expect(result.turnCount).toBe(1);
    expect(calls).toBe(1);
  });

  it("uses the hard limit less the held blocked-diagnostic token reserve for draft work", async () => {
    const prompts: string[] = [];
    const client = {
      startThread: () => ({
        id: "thread-1",
        run: async (prompt: string) => {
          prompts.push(prompt);
          return turnResult(
            10_000,
            workflowStatus("running", undefined, {
              hardLimitTokens: 48_000,
              publication: "draft",
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
      hardLimitTokens: 48_000,
      workloadSize: "M",
      requiredValidations: ["functional"],
      maxTurns: 3,
      blockedDiagnosticTokenReserve: 24_000,
    });

    expect(result.state).toBe("turn-limit");
    expect(result.checkpointCount).toBe(0);
    expect(prompts[1]).toContain('"hardLimitTokens":24000');
  });

  it("does not admit another ordinary turn that would consume the held token reserve", async () => {
    let calls = 0;
    const client = {
      startThread: () => ({
        id: "thread-1",
        run: async () => {
          calls += 1;
          return turnResult(
            20_000,
            workflowStatus("running", undefined, {
              hardLimitTokens: 48_000,
              publication: "draft",
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
      hardLimitTokens: 48_000,
      workloadSize: "M",
      requiredValidations: ["functional"],
      maxTurns: 3,
      blockedDiagnosticTokenReserve: 24_000,
    });

    expect(result.state).toBe("turn-limit");
    expect(result.turnCount).toBe(1);
    expect(calls).toBe(1);
  });

  it("releases held diagnostic tokens when a draft Run completes", async () => {
    let calls = 0;
    const client = {
      startThread: () => ({
        id: "thread-1",
        run: async () => {
          calls += 1;
          return turnResult(
            30_000,
            workflowStatus("completed", undefined, {
              hardLimitTokens: 48_000,
              publication: "draft",
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
      outputSchema: { type: "object" },
      hardLimitTokens: 48_000,
      workloadSize: "M",
      requiredValidations: ["functional"],
      maxTurns: 2,
      blockedDiagnosticTokenReserve: 24_000,
    });

    expect(result.state).toBe("completed");
    expect(result.outputFormatting).toBe("applied");
    expect(result.turnCount).toBe(2);
    expect(calls).toBe(2);
  });

  it("runs blocked publication before optional output formatting", async () => {
    const prompts: string[] = [];
    let calls = 0;
    const client = {
      startThread: () => ({
        id: "thread-1",
        run: async (prompt: string) => {
          prompts.push(prompt);
          calls += 1;
          return turnResult(
            1_000,
            workflowStatus("blocked", undefined, {
              hardLimitTokens: 48_000,
              publication: "draft",
              blockerKind: "verification",
              ...(calls === 1
                ? {}
                : {
                    diagnosticPublication: {
                      host: "github" as const,
                      url: "https://github.com/example/repo/pull/42",
                      number: "42",
                      created: true,
                      updated: false,
                      publishResultArtifactId: "artifact_publish_12345678",
                    },
                  }),
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
      outputSchema: { type: "object" },
      hardLimitTokens: 48_000,
      workloadSize: "M",
      requiredValidations: ["functional"],
      maxTurns: 3,
      blockedDiagnosticTokenReserve: 24_000,
      inspectBlockedDiagnosticPreflight: () => ({
        eligible: true,
        sourceBranch: "codex/checkout",
        targetBranch: "main",
        remoteName: "origin",
      }),
    });

    expect(result.outputFormatting).toBe("applied");
    expect(prompts[1]).toContain('intent: "blocked-diagnostic"');
    expect(prompts[2]).toContain("Format the final result");
  });

  it("gives a blocked draft Run at most one bounded diagnostic-finalization turn", async () => {
    const prompts: string[] = [];
    let calls = 0;
    const initialBlockedStatus = workflowStatus("blocked", undefined, {
      publication: "draft",
      blockerKind: "verification",
    });
    const client = {
      startThread: () => ({
        id: "thread-1",
        run: async (prompt: string) => {
          prompts.push(prompt);
          calls += 1;
          return turnResult(
            1_000,
            calls === 1
              ? initialBlockedStatus
              : workflowStatus("blocked", undefined, {
                  publication: "draft",
                  blockerKind: "verification",
                  diagnosticPublication: {
                    host: "github" as const,
                    url: "https://github.com/example/repo/pull/42",
                    number: "42",
                    created: true,
                    updated: false,
                    publishResultArtifactId: "artifact_publish_12345678",
                  },
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
      workloadSize: "M",
      requiredValidations: ["functional"],
      maxTurns: 8,
      inspectBlockedDiagnosticPreflight: () => ({
        eligible: true,
        sourceBranch: "codex/checkout",
        targetBranch: "main",
        remoteName: "origin",
      }),
    });

    expect(result.state).toBe("blocked");
    expect(result.turnCount).toBe(2);
    expect(calls).toBe(2);
    expect(prompts[1]).toBe(
      buildBlockedDiagnosticFinalizationPrompt(initialBlockedStatus, {
        eligible: true,
        sourceBranch: "codex/checkout",
        targetBranch: "main",
        remoteName: "origin",
      }),
    );
    expect(prompts[1]).toContain('intent: "blocked-diagnostic"');
    expect(prompts[1]).toContain("committed delta");
    expect(prompts[1]).toContain("clean branch");
    expect(prompts[1]).toContain("supported remote");
    expect(prompts[1]).toContain("credentials");
    expect(prompts[1]).toContain('sourceBranch: "codex/checkout"');
  });

  it("preserves the local diagnostic when git or credential preflight is not already ready", async () => {
    let calls = 0;
    const client = {
      startThread: () => ({
        id: "thread-1",
        run: async () => {
          calls += 1;
          return turnResult(
            1_000,
            workflowStatus("blocked", undefined, {
              publication: "draft",
              blockerKind: "verification",
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
      hardLimitTokens: 48_000,
      workloadSize: "M",
      requiredValidations: ["functional"],
      maxTurns: 2,
      blockedDiagnosticTokenReserve: 24_000,
      inspectBlockedDiagnosticPreflight: () => ({
        eligible: false,
        reason: "working-tree-not-clean",
      }),
    });

    expect(result.state).toBe("blocked");
    expect(result.turnCount).toBe(1);
    expect(calls).toBe(1);
  });

  it("does not format a blocked result after ineligible diagnostic publication preflight", async () => {
    let calls = 0;
    const client = {
      startThread: () => ({
        id: "thread-1",
        run: async () => {
          calls += 1;
          return turnResult(
            1_000,
            workflowStatus("blocked", undefined, {
              publication: "draft",
              blockerKind: "verification",
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
      outputSchema: { type: "object" },
      hardLimitTokens: 48_000,
      workloadSize: "M",
      requiredValidations: ["functional"],
      maxTurns: 2,
      blockedDiagnosticTokenReserve: 24_000,
      inspectBlockedDiagnosticPreflight: () => ({
        eligible: false,
        reason: "working-tree-not-clean",
      }),
    });

    expect(result.state).toBe("blocked");
    expect(result.outputFormatting).toBe("budget-skipped");
    expect(result.turnCount).toBe(1);
    expect(calls).toBe(1);
  });

  it("does not add a diagnostic-finalization turn for publication none", async () => {
    let calls = 0;
    let inspections = 0;
    const client = {
      startThread: () => ({
        id: "thread-1",
        run: async () => {
          calls += 1;
          return turnResult(
            1_000,
            workflowStatus("blocked", undefined, {
              publication: "none",
              blockerKind: "verification",
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
      workloadSize: "M",
      requiredValidations: ["functional"],
      maxTurns: 8,
      inspectBlockedDiagnosticPreflight: () => {
        inspections += 1;
        return {
          eligible: true,
          sourceBranch: "codex/checkout",
          targetBranch: "main",
          remoteName: "origin",
        };
      },
    });

    expect(result.state).toBe("blocked");
    expect(result.turnCount).toBe(1);
    expect(calls).toBe(1);
    expect(inspections).toBe(0);
  });

  it("does not recurse on a publish-precondition blocker", async () => {
    let calls = 0;
    let inspections = 0;
    const client = {
      startThread: () => ({
        id: "thread-1",
        run: async () => {
          calls += 1;
          return turnResult(
            1_000,
            workflowStatus("blocked", undefined, {
              publication: "draft",
              blockerKind: "publish-precondition",
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
      workloadSize: "M",
      requiredValidations: ["functional"],
      maxTurns: 8,
      inspectBlockedDiagnosticPreflight: () => {
        inspections += 1;
        return {
          eligible: true,
          sourceBranch: "codex/checkout",
          targetBranch: "main",
          remoteName: "origin",
        };
      },
    });

    expect(result.state).toBe("blocked");
    expect(result.turnCount).toBe(1);
    expect(calls).toBe(1);
    expect(inspections).toBe(0);
  });

  it("does not inspect or finalize after the hard token limit is reached", async () => {
    let calls = 0;
    let inspections = 0;
    const client = {
      startThread: () => ({
        id: "thread-1",
        run: async () => {
          calls += 1;
          return turnResult(
            100_000,
            workflowStatus("blocked", undefined, {
              publication: "draft",
              blockerKind: "verification",
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
      workloadSize: "M",
      requiredValidations: ["functional"],
      maxTurns: 8,
      inspectBlockedDiagnosticPreflight: () => {
        inspections += 1;
        return {
          eligible: true,
          sourceBranch: "codex/checkout",
          targetBranch: "main",
          remoteName: "origin",
        };
      },
    });

    expect(result.state).toBe("blocked");
    expect(result.turnCount).toBe(1);
    expect(calls).toBe(1);
    expect(inspections).toBe(0);
  });

  it("never exceeds maxTurns to finalize or format a blocked Run", async () => {
    let calls = 0;
    const client = {
      startThread: () => ({
        id: "thread-1",
        run: async () => {
          calls += 1;
          return turnResult(
            99_999,
            workflowStatus("blocked", undefined, {
              publication: "draft",
              blockerKind: "verification",
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
      outputSchema: { type: "object" },
      hardLimitTokens: 100_000,
      workloadSize: "M",
      requiredValidations: ["functional"],
      maxTurns: 1,
    });

    expect(result.state).toBe("blocked");
    expect(result.turnCount).toBe(1);
    expect(result.outputFormatting).toBe("budget-skipped");
    expect(calls).toBe(1);
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
      recordedAtEpochMs: Date.now(),
      prompt: "must-not-be-persisted",
      sourcePath: "/secret/repo",
    } as never);

    const raw = await readFile(filePath, "utf8");
    expect(raw).not.toContain("must-not-be-persisted");
    expect(raw).not.toContain("/secret/repo");
    await expect(store.read()).resolves.toHaveLength(1);
  });

  it("bounds retained history by size and record count", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-usage-bounds-"));
    const filePath = path.join(directory, "usage.jsonl");
    const store = new UsageCalibrationStore(filePath);

    for (let index = 0; index < 300; index += 1) {
      await store.record(calibrationSample({ recordedAtEpochMs: Date.now() + index }));
    }

    const samples = await store.read();
    const raw = await readFile(filePath, "utf8");
    expect(samples.length).toBeLessThanOrEqual(256);
    expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(1_048_576);
  });

  it("serializes concurrent history records without losing samples", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-usage-concurrent-"));
    const store = new UsageCalibrationStore(path.join(directory, "usage.jsonl"));
    const recordedAtEpochMs = Date.now();

    await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        store.record(calibrationSample({ recordedAtEpochMs: recordedAtEpochMs + index })),
      ),
    );

    await expect(store.read()).resolves.toHaveLength(50);
  });

  it("rejects repository-local history before creating its parent directory", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-usage-location-"));
    const repositoryRoot = path.join(directory, "repo");
    const historyDirectory = path.join(repositoryRoot, ".codex", "spec-to-pr");
    await mkdir(repositoryRoot);
    const store = new UsageCalibrationStore(path.join(historyDirectory, "usage.jsonl"), {
      excludedRoot: repositoryRoot,
    });

    await expect(recordCalibrationBestEffort(store, calibrationSample())).resolves.toBe(
      "unavailable",
    );
    await expect(access(historyDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("revalidates the history file before mutation and refuses a hard-link swap", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-usage-swap-"));
    const protectedFile = path.join(directory, "protected.jsonl");
    const filePath = path.join(directory, "usage.jsonl");
    await writeFile(protectedFile, "protected\n", "utf8");
    await writeFile(filePath, "", "utf8");
    const store = new UsageCalibrationStore(filePath);

    await unlink(filePath);
    await link(protectedFile, filePath);

    await expect(recordCalibrationBestEffort(store, calibrationSample())).resolves.toBe(
      "unavailable",
    );
    await expect(readFile(protectedFile, "utf8")).resolves.toBe("protected\n");
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

  it("does not calibrate from legacy caller-overridden hard limits", () => {
    const samples = Array.from({ length: 10 }, (_, index) =>
      calibrationSample({
        hardLimitTokens: 1_000_000,
        inputTokens: 780_000 + index * 1_000,
        outputTokens: 20_000,
        totalTokens: 800_000 + index * 1_000,
        recordedAtEpochMs: Date.now() + index,
      }),
    );

    expect(
      calibrateTokenRange({
        mode: "feature",
        workloadSize: "M",
        fallback: { min: 90_000, max: 180_000 },
        samples,
      }),
    ).toMatchObject({
      min: 90_000,
      max: 180_000,
      sampleCount: 0,
      source: "intake",
    });
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
  status: "running" | "blocked" | "completed",
  nextKind?: string,
  options: {
    runId?: string;
    size?: "XS" | "S" | "M" | "L" | "XL";
    hardLimitTokens?: number;
    requiredValidations?: string[];
    publication?: "draft" | "none";
    blockerKind?:
      | "missing-input"
      | "missing-tool"
      | "policy"
      | "verification"
      | "publish-precondition"
      | "budget-split"
      | "unexpected";
    diagnosticPublication?: {
      host: "github" | "gitlab";
      url: string;
      number: string;
      created: boolean;
      updated: boolean;
      publishResultArtifactId: string;
    };
  } = {},
): BoundaryWorkflowStatus {
  const size = options.size ?? "M";
  const hardLimitTokens = options.hardLimitTokens ?? 180_000;
  return {
    view: "action",
    runId: options.runId ?? "run_12345678",
    revision: 7,
    status,
    ...(status === "completed" ? {} : { currentStage: "contracts" }),
    stages: [{ name: "intake", status: "passed" }],
    nextActions: nextKind === undefined ? [] : [{ kind: nextKind, runId: "run_12345678" }],
    deliveryProfile: {
      publication: options.publication ?? "draft",
      recommendedSkills: [],
    },
    delegationPolicy: {
      singleWriter: true as const,
      allowNested: false as const,
      maxReadOnlyScouts: size === "M" ? 1 : size === "L" || size === "XL" ? 2 : 0,
      parallelReviewers: size === "L" || size === "XL",
    },
    blockers: options.blockerKind === undefined ? [] : ["Workflow blocked"],
    blockerDetails:
      options.blockerKind === undefined
        ? []
        : [
            {
              stage: "implementation",
              code: "BLOCKED_TEST",
              kind: options.blockerKind,
              summary: "Workflow blocked",
              retryable: false,
              resumable: true,
              completedWork: ["Contracts accepted"],
              evidencePaths: ["contracts/requirements.json"],
              attemptedRecovery: ["Retried once"],
              unrunValidations: ["functional"],
              exactUnblockAction: "Provide the missing verification dependency.",
            },
          ],
    ...(options.diagnosticPublication === undefined
      ? {}
      : { diagnosticPublication: options.diagnosticPublication }),
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

function calibrationSample(
  overrides: Partial<Parameters<UsageCalibrationStore["record"]>[0]> = {},
): Parameters<UsageCalibrationStore["record"]>[0] {
  return {
    version: 1,
    mode: "feature",
    workloadSize: "M",
    estimatedMinTokens: 90_000,
    estimatedMaxTokens: 180_000,
    hardLimitTokens: 180_000,
    inputTokens: 80_000,
    cachedInputTokens: 40_000,
    outputTokens: 20_000,
    reasoningOutputTokens: 5_000,
    totalTokens: 100_000,
    turnCount: 4,
    checkpointCount: 0,
    completed: true,
    recordedAtEpochMs: Date.now(),
    ...overrides,
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
