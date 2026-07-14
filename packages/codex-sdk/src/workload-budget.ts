import type { RunResult } from "@openai/codex-sdk";

export type WorkloadSize = "XS" | "S" | "M" | "L" | "XL";
export type DeliveryMode = "auto" | "brief" | "legacy" | "feature" | "figma";

export type SdkWorkloadEstimate = {
  size: WorkloadSize;
  confidence: "low" | "medium" | "high";
  source: "intake" | "contracts" | "calibrated";
  tokenRange: { min: number; max: number };
  sampleCount: number;
};

export type AggregatedUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  observedTurns: number;
  missingTurns: number;
  availability: "complete" | "partial" | "unavailable";
};

const TOKEN_RANGES: Record<WorkloadSize, { min: number; max: number }> = {
  XS: { min: 20_000, max: 50_000 },
  S: { min: 45_000, max: 100_000 },
  M: { min: 90_000, max: 180_000 },
  L: { min: 160_000, max: 320_000 },
  XL: { min: 280_000, max: 600_000 },
};

export function defaultTokenRangeForWorkload(size: WorkloadSize): { min: number; max: number } {
  return { ...TOKEN_RANGES[size] };
}

export function effectiveHardLimitForWorkload(size: WorkloadSize): number {
  return TOKEN_RANGES[size].max;
}

export function estimateSdkWorkload(input: {
  deliveryMode: DeliveryMode;
  promptLength: number;
  hasBrief: boolean;
  hasFigma: boolean;
  hasOpenApi: boolean;
}): SdkWorkloadEstimate {
  const modeScore: Record<DeliveryMode, number> = {
    auto: 0,
    brief: 4,
    legacy: 8,
    feature: 6,
    figma: 5,
  };
  const score =
    modeScore[input.deliveryMode] +
    Math.min(100, Math.ceil(Math.max(0, input.promptLength) / 500)) +
    (input.hasBrief ? 6 : 0) +
    (input.hasFigma ? 8 : 0) +
    (input.hasOpenApi ? 8 : 0) +
    4;
  const size = sizeForScore(score);

  return {
    size,
    confidence: "low",
    source: "intake",
    tokenRange: defaultTokenRangeForWorkload(size),
    sampleCount: 0,
  };
}

export function accumulateUsage(
  current: AggregatedUsage | null,
  usage: RunResult["usage"],
): AggregatedUsage {
  const previous = current ?? {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    observedTurns: 0,
    missingTurns: 0,
    availability: "unavailable" as const,
  };
  if (usage === null) {
    return {
      ...previous,
      missingTurns: previous.missingTurns + 1,
      availability: previous.observedTurns === 0 ? "unavailable" : "partial",
    };
  }

  const observedTurns = previous.observedTurns + 1;

  return {
    inputTokens: previous.inputTokens + usage.input_tokens,
    cachedInputTokens: previous.cachedInputTokens + usage.cached_input_tokens,
    outputTokens: previous.outputTokens + usage.output_tokens,
    reasoningOutputTokens: previous.reasoningOutputTokens + usage.reasoning_output_tokens,
    totalTokens: previous.totalTokens + usage.input_tokens + usage.output_tokens,
    observedTurns,
    missingTurns: previous.missingTurns,
    availability: previous.missingTurns === 0 ? "complete" : "partial",
  };
}

export function decideBudgetAction(input: {
  usedTokens: number;
  hardLimitTokens: number;
  checkpointed: boolean;
  workloadSize: WorkloadSize;
  requiredValidations: readonly string[];
}): {
  action: "continue" | "checkpoint" | "split-required";
  requiredValidations: string[];
  thresholdTokens: number;
  shortfallTokens: number;
} {
  if (
    !Number.isFinite(input.hardLimitTokens) ||
    input.hardLimitTokens <= 0 ||
    !Number.isFinite(input.usedTokens) ||
    input.usedTokens < 0
  ) {
    throw new Error("Token usage must be finite and non-negative, and hard limit must be positive");
  }
  const thresholdTokens = Math.floor(input.hardLimitTokens * 0.8);
  const requiredValidations = [...input.requiredValidations];
  if (input.usedTokens >= input.hardLimitTokens) {
    return {
      action: "split-required",
      requiredValidations,
      thresholdTokens,
      shortfallTokens: Math.max(1, input.usedTokens - input.hardLimitTokens + 1),
    };
  }
  if (!input.checkpointed && input.usedTokens >= thresholdTokens) {
    return { action: "checkpoint", requiredValidations, thresholdTokens, shortfallTokens: 0 };
  }
  return { action: "continue", requiredValidations, thresholdTokens, shortfallTokens: 0 };
}

function sizeForScore(score: number): WorkloadSize {
  if (score <= 8) return "XS";
  if (score <= 24) return "S";
  if (score <= 50) return "M";
  if (score <= 90) return "L";
  return "XL";
}
