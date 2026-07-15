import type { WorkflowBlocker } from "../workflow/workflow-contracts.js";

export interface ReadyWorkflowReportInput {
  runId: string;
  reviewPacket: {
    id: string;
    revision: number;
    baseSha?: string | null;
    headSha?: string | null;
    evidenceDigest: string;
    diffDigest: string;
    changedFiles: readonly string[];
  };
  guidanceTrace: {
    explicit: readonly string[];
    discovered: readonly string[];
    skillHints: readonly string[];
    appliedSkills: readonly string[];
  };
  requirementManifest: readonly {
    id: string;
    title: string;
    acceptanceCriteria: readonly string[];
  }[];
  legacyBaseline?: {
    scope: string;
    checks: readonly {
      status: string;
      command: string;
      resultPath: string;
    }[];
  };
  evidencePaths: readonly string[];
  reviews: readonly {
    kind: "functional-review" | "design-review";
    requirements: readonly {
      id: string;
      verdict: string;
    }[];
    gateResults: readonly {
      id: string;
      status: string;
      evidencePaths: readonly string[];
    }[];
    findings: readonly {
      severity: string;
      title: string;
    }[];
  }[];
  featureVideoPath?: string;
}

export interface BlockedWorkflowReportInput {
  runId: string;
  projectRoot: string;
  blocker: WorkflowBlocker;
}

export function renderReadyWorkflowReport(input: ReadyWorkflowReportInput): string {
  const verdictFor = (requirementId: string) =>
    input.reviews
      .flatMap((review) => review.requirements)
      .filter((requirement) => requirement.id === requirementId)
      .map((requirement) => requirement.verdict)
      .join(", ");
  const gateLines = input.reviews.flatMap((review) =>
    review.gateResults.map(
      (gate) => `- ${review.kind}/${gate.id}: ${gate.status} (${gate.evidencePaths.join(", ")})`,
    ),
  );
  const riskLines = input.reviews.flatMap((review) =>
    review.findings.map((finding) => `- ${finding.severity}: ${finding.title}`),
  );
  const appliedSkills = uniqueValues([
    ...input.guidanceTrace.skillHints,
    ...input.guidanceTrace.appliedSkills,
  ]);

  return [
    `# SpecToPR Run ${input.runId}`,
    "",
    "## Decision",
    "",
    "Ready for draft review.",
    "",
    "## Review packet",
    "",
    `- ID: ${input.reviewPacket.id}`,
    `- Revision: ${input.reviewPacket.revision}`,
    `- Base: ${input.reviewPacket.baseSha ?? "unavailable"}`,
    `- Head: ${input.reviewPacket.headSha ?? "unavailable"}`,
    `- Evidence digest: ${input.reviewPacket.evidenceDigest}`,
    `- Diff digest: ${input.reviewPacket.diffDigest}`,
    "",
    "## Project guidance",
    "",
    "### Explicit",
    "",
    ...(input.guidanceTrace.explicit.length === 0
      ? ["- None."]
      : input.guidanceTrace.explicit.map((guidancePath) => `- ${markdownListValue(guidancePath)}`)),
    "",
    "### Automatically discovered",
    "",
    ...(input.guidanceTrace.discovered.length === 0
      ? ["- None."]
      : input.guidanceTrace.discovered.map(
          (guidancePath) => `- ${markdownListValue(guidancePath)}`,
        )),
    "",
    "## Applied optional skills",
    "",
    ...(appliedSkills.length === 0 ? ["- None."] : appliedSkills.map((skill) => `- ${skill}`)),
    "",
    "## Requirement traceability",
    "",
    "| Requirement | Acceptance criteria | Review verdict |",
    "| --- | --- | --- |",
    ...input.requirementManifest.map(
      (requirement) =>
        `| ${markdownTableCell(`${requirement.id}: ${requirement.title}`)} | ${markdownTableCell(requirement.acceptanceCriteria.join("\n"))} | ${markdownTableCell(verdictFor(requirement.id))} |`,
    ),
    ...(input.legacyBaseline === undefined
      ? []
      : [
          "",
          "## Focused legacy baseline",
          "",
          `- Scope: ${input.legacyBaseline.scope}`,
          ...input.legacyBaseline.checks.map(
            (check) => `- ${check.status}: \`${check.command}\` → ${check.resultPath}`,
          ),
        ]),
    "",
    "## Changed files",
    "",
    ...(input.reviewPacket.changedFiles.length === 0
      ? ["- No changed files declared."]
      : input.reviewPacket.changedFiles.map((file) => `- ${file}`)),
    "",
    "## Evidence",
    "",
    ...input.evidencePaths.map((evidencePath) => `- ${evidencePath}`),
    "",
    "## Validation gates",
    "",
    ...(gateLines.length === 0 ? ["- No gates recorded."] : gateLines),
    "",
    "## Risks",
    "",
    ...(riskLines.length === 0 ? ["- No known review findings."] : riskLines),
    ...(input.featureVideoPath === undefined
      ? []
      : ["", "## Feature E2E video", "", `- ${input.featureVideoPath}`]),
    "",
  ].join("\n");
}

export function renderBlockedWorkflowReport(input: BlockedWorkflowReportInput): string {
  const sanitizeIdentifier = (value: string) =>
    markdownInlineValue(redactDiagnosticValue(value, input.projectRoot));
  const sanitizeFreeText = (value: string) =>
    markdownNeutralValue(redactDiagnosticValue(value, input.projectRoot));
  const list = (values: readonly string[]) =>
    values.length === 0
      ? ["- None recorded."]
      : values.map((value) => `- ${sanitizeFreeText(value)}`);

  return [
    `# SpecToPR Run ${sanitizeIdentifier(input.runId)}`,
    "",
    "## Decision",
    "",
    "Blocked. Diagnostic report only.",
    "",
    "## Blocker",
    "",
    `- Stage: ${sanitizeIdentifier(input.blocker.stage)}`,
    `- Kind: ${sanitizeIdentifier(input.blocker.kind)}`,
    `- Code: ${sanitizeIdentifier(input.blocker.code)}`,
    `- Retryable: ${input.blocker.retryable ? "yes" : "no"}`,
    `- Resumable: ${input.blocker.resumable ? "yes" : "no"}`,
    `- Summary: ${sanitizeFreeText(input.blocker.summary)}`,
    "",
    "## Completed work",
    "",
    ...list(input.blocker.completedWork),
    "",
    "## Evidence",
    "",
    ...list(input.blocker.evidencePaths),
    "",
    "## Attempted recovery",
    "",
    ...list(input.blocker.attemptedRecovery),
    "",
    "## Unrun validations",
    "",
    ...list(input.blocker.unrunValidations),
    "",
    "## Exact unblock action",
    "",
    sanitizeFreeText(input.blocker.exactUnblockAction),
    "",
  ].join("\n");
}

function markdownTableCell(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replace(/\r?\n/g, "<br>");
}

const MARKDOWN_LIST_CONTROL_CHARACTERS = new Set([
  "\\",
  "`",
  "*",
  "_",
  "{",
  "}",
  "[",
  "]",
  "(",
  ")",
  "#",
  "+",
  "-",
  "!",
  "|",
  ">",
  "<",
  "&",
  "~",
  '"',
  "'",
  "=",
]);

function markdownListValue(value: string): string {
  return [...value]
    .map((character) => {
      if (character === "\r") return "&#92;r";
      if (character === "\n") return "&#92;n";
      return MARKDOWN_LIST_CONTROL_CHARACTERS.has(character)
        ? `&#${character.charCodeAt(0)};`
        : character;
    })
    .join("");
}

function uniqueValues(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function redactDiagnosticValue(value: string, projectRoot: string): string {
  let redacted = value;
  const rootVariants = [
    projectRoot,
    projectRoot.replaceAll("\\", "/"),
    projectRoot.replaceAll("/", "\\"),
  ]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  for (const root of new Set(rootVariants)) {
    redacted = redacted.replaceAll(root, "[project-root]");
  }

  redacted = redacted.replace(/\b(authorization)\s*[:=]\s*[^\r\n]*/gi, "$1: [REDACTED]");
  redacted = redacted.replace(
    /\b((?:[A-Za-z0-9]+[-_])*(?:api[-_]?key|token|secret|password|passwd|credential|private[-_]?key)(?:[-_][A-Za-z0-9]+)*)\s*([:=])\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
    "$1$2[REDACTED]",
  );
  redacted = redacted.replace(
    /\b(?:github_pat_[A-Za-z0-9_]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|sk-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{16,}|AKIA[A-Z0-9]{16})\b/g,
    "[REDACTED]",
  );
  return redacted.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/]+@/gi, "$1[REDACTED]@");
}

function markdownInlineValue(value: string): string {
  return value.replaceAll("\r", "&#92;r").replaceAll("\n", "&#92;n");
}

const BLOCKED_MARKDOWN_CONTROL_CHARACTERS = new Set([
  "\\",
  "`",
  "*",
  "{",
  "}",
  "[",
  "]",
  "(",
  ")",
  "#",
  "!",
  "|",
  ">",
  "<",
  "&",
  "~",
  "=",
]);

function markdownNeutralValue(value: string): string {
  const characters = [...value];
  const firstNonWhitespace = characters.findIndex((character) => !/\s/.test(character));
  const orderedListMatch = value.match(/^(\s*\d+)([.)])(?=\s)/);
  const orderedListDelimiter = orderedListMatch?.[1]?.length;
  const neutral = characters
    .map((character, index) => {
      if (character === "\r") return "&#92;r";
      if (character === "\n") return "&#92;n";
      const codePoint = character.codePointAt(0)!;
      if (codePoint < 32 || codePoint === 127) return `&#${codePoint};`;
      if ((character === "-" || character === "+") && index === firstNonWhitespace) {
        return `&#${codePoint};`;
      }
      if (character === "." && index === orderedListDelimiter) return "&#46;";
      if (character === "_") {
        const previous = characters[index - 1] ?? "";
        const next = characters[index + 1] ?? "";
        if (/[A-Za-z0-9]/.test(previous) && /[A-Za-z0-9]/.test(next)) return character;
        return "&#95;";
      }
      return BLOCKED_MARKDOWN_CONTROL_CHARACTERS.has(character) ? `&#${codePoint};` : character;
    })
    .join("");

  return neutral
    .replaceAll("&#91;REDACTED&#93;", "[REDACTED]")
    .replaceAll("&#91;project-root&#93;", "[project-root]");
}
