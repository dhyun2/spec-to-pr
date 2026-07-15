import type { WorkloadSize } from "./workload-budget.js";

export type CodexReviewAgentProfile = {
  name: string;
  focus: string;
  output: string;
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

export type CodexScoutRoutingPolicy = {
  maxReadOnlyScouts: 0 | 1 | 2;
  independentReadHeavyOnly: true;
  allowNested: false;
  parallelWriters: false;
  parallelReviewersAfterImplementation: boolean;
};

export function scoutRoutingForWorkload(workloadSize: WorkloadSize): CodexScoutRoutingPolicy {
  return {
    maxReadOnlyScouts:
      workloadSize === "M" ? 1 : workloadSize === "L" || workloadSize === "XL" ? 2 : 0,
    independentReadHeavyOnly: true,
    allowNested: false,
    parallelWriters: false,
    parallelReviewersAfterImplementation: workloadSize === "L" || workloadSize === "XL",
  };
}

export function buildCodexActionEnvelopeInstructions(options: {
  publication: "draft" | "none";
  includeReviewAgents: boolean;
  includeDesignReview: boolean;
}): string {
  const reviewers = options.includeReviewAgents
    ? options.includeDesignReview
      ? "functional-reviewer and design-reviewer"
      : "functional-reviewer"
    : "no independent reviewer agent";
  return [
    "Treat each fresh workflow_status as the compact action envelope: use status.nextActions, status.blockerDetails, status.deliveryProfile.publication, status.delegationPolicy, status.diagnosticPublication, status.requiredValidations, and status.resumeContext instead of restating workflow policy.",
    "Complete only one external action group and stop after its fresh status. Keep API and UI work in one implementation context.",
    "Scout routing is XS/S=0, M<=1, L/XL<=2, and only for independent read-heavy discovery; no nested scouts or parallel writers. Independent functional/design reviewers may run in parallel only when status.delegationPolicy.parallelReviewers is true and only after implementation.",
    `Applicable review route: ${reviewers}. Give each reviewer the immutable workflow_status snapshot, accepted contracts, diff, and evidence paths; reviewers neither edit implementation nor call workflow tools.`,
    options.publication === "draft"
      ? "Draft publication uses an actual non-target codex/<short-slug> branch: commit all intended changes only, require a clean tree and at least one commit beyond the target, and pass actual branches; workflow_publish never merges or marks ready."
      : "Publication is none: do not create a publication-only branch or call workflow_publish.",
  ].join("\n");
}

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
    "After implementation, the orchestrator must call workflow_status and give each reviewer an immutable review packet containing the workflow_status snapshot, accepted contracts, diff, and evidence paths.",
    "Reviewers do not call workflow tools or edit implementation; each returns a literal schema-shaped submission payload. The orchestrator validates it and submits each verdict through workflow_submit with structured gateResults and real project-local artifact paths; missing or empty evidence cannot approve a gate.",
    "",
    "Applicable reviewers:",
    ...profiles.map(
      (profile) => `- ${profile.name}: focus=${profile.focus} output=${profile.output}`,
    ),
  ].join("\n");
}

export function buildCodexPublishInstructions(): string {
  return [
    "Publishing policy:",
    "- Use workflow_status to confirm that required implementation evidence and applicable reviewer verdicts are complete.",
    "- Work on a non-target codex/* source branch. Before publishing, commit only intended changes, require a clean tree, and verify at least one commit beyond the target branch.",
    "- Use workflow_publish only when the user requested publication and the workflow reports publish readiness.",
    "- Publication creates or updates a draft PR/MR; it never merges, approves, closes, or marks it ready for review.",
    "- Use workflow_archive only after merge evidence exists and the user explicitly requests archival.",
  ].join("\n");
}
