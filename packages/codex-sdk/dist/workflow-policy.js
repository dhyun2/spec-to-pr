import { parallelReviewersForWorkload } from "./generated/delivery-mode-policy.js";
export const CODEX_WORKFLOW_TOOL_NAMES = [
    "workflow_info",
    "workflow_start",
    "workflow_advance",
    "workflow_submit",
    "workflow_status",
    "workflow_publish",
    "workflow_archive",
];
export const CODEX_REVIEW_AGENT_PROFILES = [
    {
        name: "functional-reviewer",
        focus: "Requirement fidelity, API contracts, tests, architecture, security, and unresolved functional gaps.",
        output: "An explicit approved, changes-requested, or blocked verdict with findings and evidence handles.",
    },
    {
        name: "design-reviewer",
        focus: "Figma or legacy visual fidelity, design-system usage, supported UI states, interaction accessibility, and visual evidence.",
        output: "An explicit approved, changes-requested, or blocked verdict with findings and evidence handles.",
    },
];
export function scoutRoutingForWorkload(workloadSize) {
    return {
        maxReadOnlyScouts: workloadSize === "M" ? 1 : workloadSize === "L" || workloadSize === "XL" ? 2 : 0,
        independentReadHeavyOnly: true,
        allowNested: false,
        parallelWriters: false,
        parallelReviewersAfterImplementation: parallelReviewersForWorkload(workloadSize),
    };
}
export function buildCodexActionEnvelopeInstructions(options) {
    const reviewers = options.includeReviewAgents
        ? options.includeDesignReview
            ? "functional-reviewer and design-reviewer"
            : "functional-reviewer"
        : "delegated reviewer agents are disabled; this does not waive the required review gate, so submit the applicable read-only review evidence in this context";
    return [
        "Treat each fresh workflow_status as the compact action envelope: use status.nextActions, status.blockerDetails, status.deliveryProfile.publication, status.delegationPolicy, status.diagnosticPublication, status.requiredValidations, and status.resumeContext instead of restating workflow policy.",
        "Complete only one external action group and stop after its fresh status. Keep API and UI work in one implementation context.",
        "Scout routing is XS/S=0, M<=1, L/XL<=2, and only for independent read-heavy discovery; no nested scouts or parallel writers. Independent functional/design reviewers may run in parallel only when status.delegationPolicy.parallelReviewers is true and only after implementation.",
        "This is a latency-bound user Run. Do not create generic helper agents for planning, intake, status polling, progress narration, or re-checking completed work. Do not poll or repeatedly wait for an agent. Use the one writer, only the status-authorized scout count, and one reviewer per applicable role; do not retry or replace a reviewer that returns blocked, missing evidence, or times out.",
        `Applicable review route: ${reviewers}. Give each reviewer the immutable workflow_status snapshot, accepted contracts, diff, and evidence paths; reviewers neither edit implementation nor call workflow tools.`,
        options.publication === "draft"
            ? "Draft publication uses an actual non-target codex/<short-slug> branch: commit all intended changes only, require a clean tree and at least one commit beyond the target, and pass actual branches; workflow_publish never merges or marks ready."
            : "Publication is none: do not create a publication-only branch or call workflow_publish.",
    ].join("\n");
}
export function buildCodexReviewAgentInstructions(options = {}) {
    const includeFunctionalReview = options.includeFunctionalReview ?? true;
    const includeDesignReview = options.includeDesignReview ?? false;
    const profiles = CODEX_REVIEW_AGENT_PROFILES.filter((profile) => (profile.name === "functional-reviewer" && includeFunctionalReview) ||
        (profile.name === "design-reviewer" && includeDesignReview));
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
        ...profiles.map((profile) => `- ${profile.name}: focus=${profile.focus} output=${profile.output}`),
    ].join("\n");
}
export function buildCodexPublishInstructions() {
    return [
        "Publishing policy:",
        "- Use workflow_status to confirm that required implementation evidence and applicable reviewer verdicts are complete.",
        "- Work on a non-target codex/* source branch. Before publishing, commit only intended changes, require a clean tree, and verify at least one commit beyond the target branch.",
        "- Use workflow_publish only when the user requested publication and the workflow reports publish readiness.",
        "- Publication creates or updates a draft PR/MR; it never merges, approves, closes, or marks it ready for review.",
        "- Use workflow_archive only after merge evidence exists and the user explicitly requests archival.",
    ].join("\n");
}
