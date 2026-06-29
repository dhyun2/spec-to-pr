export type CodexReviewAgentProfile = {
  name: string;
  focus: string;
  output: string;
};

export type CodexVisualRepairPolicy = {
  minPassingScore: number;
  maxAttempts: number;
};

export const DEFAULT_CODEX_VISUAL_REPAIR_POLICY: CodexVisualRepairPolicy = {
  minPassingScore: 0.9,
  maxAttempts: 3,
};

export const CODEX_REVIEW_AGENT_PROFILES: CodexReviewAgentProfile[] = [
  {
    name: "visual-regression-reviewer",
    focus:
      "Figma baseline, browser screenshot, diff, overlay, masks, and design-contract evidence.",
    output:
      "Visual mismatch findings with target IDs, artifact IDs, severity, owner, and repair notes.",
  },
  {
    name: "accessibility-reviewer",
    focus: "WCAG 2.1 AA, keyboard flow, semantics, focus order, and manual review requirements.",
    output: "Accessibility findings with automated/manual evidence separated.",
  },
  {
    name: "performance-reviewer",
    focus:
      "Lighthouse, bundle budgets, Web Vitals readiness, route coverage, and lab-vs-field wording.",
    output: "Performance findings with metric thresholds and route-level evidence.",
  },
  {
    name: "security-hardening-reviewer",
    focus: "XSS, URL injection, local storage, unsafe navigation, and secret handling.",
    output: "Security findings with concrete file or behavior references.",
  },
  {
    name: "observability-reviewer",
    focus: "Telemetry, log correlation, trace propagation, and production-claim accuracy.",
    output: "Observability findings and missing instrumentation notes.",
  },
  {
    name: "pr-report-reviewer",
    focus: "PR report consistency with Run artifacts, checks, gaps, and blocked decision policy.",
    output: "PR report findings that prevent misleading or unsupported review requests.",
  },
];

export function buildCodexReviewAgentInstructions(
  profiles: CodexReviewAgentProfile[] = CODEX_REVIEW_AGENT_PROFILES,
): string {
  return [
    "Spawn Codex subagents for review when the environment supports subagent workflows.",
    "Use one subagent per review lane and wait for every result before generating or publishing the PR report.",
    "If subagents are unavailable, perform the same lanes sequentially and label each result with the lane name.",
    "",
    "Review lanes:",
    ...profiles.map(
      (profile) => `- ${profile.name}: focus=${profile.focus} output=${profile.output}`,
    ),
    "",
    "Every review lane must cite artifact IDs, file paths, or check IDs. Do not mark missing evidence as passed.",
  ].join("\n");
}

export function buildCodexVisualRepairInstructions(
  policy: Partial<CodexVisualRepairPolicy> = {},
): string {
  const resolved = {
    ...DEFAULT_CODEX_VISUAL_REPAIR_POLICY,
    ...policy,
  };

  return [
    "Run a bounded Figma-vs-implementation visual repair loop when Figma screenshots or design contracts are present.",
    `Minimum visual score: ${(resolved.minPassingScore * 100).toFixed(2)}%.`,
    `Maximum repair attempts: ${resolved.maxAttempts} attempt(s).`,
    "",
    "Loop:",
    "1. Run or refresh the Design/UI implementation attempt.",
    "2. Run visual regression: plan_visual_regression, capture_browser_screenshots, compare_visual_snapshots.",
    "3. Call evaluate_visual_repair_loop with the current attempt, minPassingScore, and maxAttempts.",
    "4. If the decision is retry, pass failingTargetIds, diff/overlay artifacts, and repair notes back to the Design/UI lane, then repeat.",
    "5. If the decision is failed, stop and report the human-review blocker.",
    "6. If the decision is passed, continue to review council and PR report generation.",
    "",
    "Do not publish, request review, or describe the implementation as review-ready while evaluate_visual_repair_loop returns retry or failed.",
  ].join("\n");
}

export function buildCodexPublishInstructions(): string {
  return [
    "Publish policy:",
    "- If the PR report decision is not blocked and the user asked for an end-to-end run or review request, do not stop at plan_review_request_publish.",
    "- Call publish_review_request with confirm: true after the publish plan is valid.",
    "- Publishing means creating or updating a draft PR/MR with the generated PR report artifact as the body.",
    "- Do not merge, approve, close, or mark ready for review unless the user explicitly asks.",
  ].join("\n");
}
