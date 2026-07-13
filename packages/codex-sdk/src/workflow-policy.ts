export type CodexReviewAgentProfile = {
  name: string;
  focus: string;
  output: string;
};

export type CodexVisualRepairPolicy = {
  minPassingScore: number;
  maxAttempts: number;
};

export type CodexReviewAgentInstructionOptions = {
  includeFunctionalReview?: boolean;
  includeDesignReview?: boolean;
};

export const CODEX_WORKFLOW_TOOL_NAMES = [
  "workflow_info",
  "workflow_start",
  "workflow_advance",
  "workflow_submit",
  "workflow_status",
  "workflow_publish",
  "workflow_archive",
] as const;

export const DEFAULT_CODEX_VISUAL_REPAIR_POLICY: CodexVisualRepairPolicy = {
  minPassingScore: 0.98,
  maxAttempts: 3,
};

export const CODEX_REVIEW_AGENT_PROFILES: CodexReviewAgentProfile[] = [
  {
    name: "functional-reviewer",
    focus:
      "Requirement fidelity, API contracts, tests, architecture, security, and unresolved functional gaps.",
    output:
      "An explicit approved, changes-requested, or blocked verdict with findings and evidence handles.",
  },
  {
    name: "design-reviewer",
    focus:
      "Figma or legacy visual fidelity, design-system usage, supported UI states, interaction accessibility, and visual evidence.",
    output:
      "An explicit approved, changes-requested, or blocked verdict with findings and evidence handles.",
  },
];

export function buildCodexReviewAgentInstructions(
  options: CodexReviewAgentInstructionOptions = {},
): string {
  const includeFunctionalReview = options.includeFunctionalReview ?? true;
  const includeDesignReview = options.includeDesignReview ?? false;
  const profiles = CODEX_REVIEW_AGENT_PROFILES.filter(
    (profile) =>
      (profile.name === "functional-reviewer" && includeFunctionalReview) ||
      (profile.name === "design-reviewer" && includeDesignReview),
  );

  if (profiles.length === 0) {
    return "No reviewer is applicable to this scope.";
  }

  return [
    "Request only the reviewers applicable to the classified scope.",
    "Functional and design reviews are independent and may run in parallel after implementation.",
    "Submit each verdict through workflow_submit and do not treat missing or empty evidence as approval.",
    "",
    "Applicable reviewers:",
    ...profiles.map(
      (profile) => `- ${profile.name}: focus=${profile.focus} output=${profile.output}`,
    ),
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
    "When the UI scope has a Figma or legacy visual baseline, complete a bounded visual repair loop within the same implementation context.",
    `Target visual score: ${(resolved.minPassingScore * 100).toFixed(2)}%.`,
    `Maximum repair attempts: ${resolved.maxAttempts} attempt(s).`,
    "Use workflow_advance to obtain each requested action and workflow_submit to return comparison and repair evidence.",
    "Stop with the reported blocker when the attempt cap is reached; never invent passing visual evidence.",
  ].join("\n");
}

export function buildCodexPublishInstructions(): string {
  return [
    "Publishing policy:",
    "- Use workflow_status to confirm that required implementation evidence and applicable reviewer verdicts are complete.",
    "- Use workflow_publish only when the user requested publication and the workflow reports publish readiness.",
    "- Publication creates or updates a draft PR/MR; it never merges, approves, closes, or marks it ready for review.",
    "- Use workflow_archive only after merge evidence exists and the user explicitly requests archival.",
  ].join("\n");
}
