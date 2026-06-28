import { minimatch } from "minimatch";

import type { ImplementationAgentResult } from "../runtime/agent-result.js";
import { AgentResultSchema } from "../runtime/agent-result.js";
import type { ApiContractAgentContext } from "./api-contract-agent-contracts.js";

export type ApiContractAgentValidationIssue = {
  path: string;
  message: string;
};

export type ApiContractAgentValidationResult = {
  valid: boolean;
  issues: ApiContractAgentValidationIssue[];
};

export function validateApiContractAgentResult(input: {
  context: ApiContractAgentContext;
  result: unknown;
}): ApiContractAgentValidationResult {
  const issues: ApiContractAgentValidationIssue[] = [];
  const parsed = AgentResultSchema.safeParse(input.result);

  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }

  const result = parsed.data;

  if (result.kind !== "implementation") {
    issues.push({
      path: "kind",
      message: "API Contract Agent must submit an implementation result.",
    });

    return {
      valid: false,
      issues,
    };
  }

  if (result.agent !== "api-contract") {
    issues.push({
      path: "agent",
      message: "API Contract Agent result must use agent=api-contract.",
    });
  }

  validateChangedFiles({
    context: input.context,
    result,
    issues,
  });

  if (result.status === "passed" && result.commitSha === undefined) {
    issues.push({
      path: "commitSha",
      message: "Passed API Contract Agent result requires commitSha.",
    });
  }

  if (result.status === "passed" && result.checks.some((check) => check.status === "failed")) {
    issues.push({
      path: "checks",
      message: "Passed API Contract Agent result cannot include failed checks.",
    });
  }

  if (result.status === "blocked" && result.gapIds.length === 0) {
    issues.push({
      path: "gapIds",
      message: "Blocked API Contract Agent result must reference at least one API gap.",
    });
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

function validateChangedFiles(input: {
  context: ApiContractAgentContext;
  result: ImplementationAgentResult;
  issues: ApiContractAgentValidationIssue[];
}): void {
  for (const file of input.result.changedFiles) {
    const allowed = input.context.allowedWriteGlobs.some((glob) =>
      minimatch(file, glob, { dot: true }),
    );

    if (!allowed) {
      input.issues.push({
        path: `changedFiles.${file}`,
        message: `Changed file is outside API Contract Agent allowed globs: ${file}`,
      });
    }

    const forbidden = input.context.forbiddenWriteGlobs.some((glob) =>
      minimatch(file, glob, { dot: true }),
    );

    if (forbidden) {
      input.issues.push({
        path: `changedFiles.${file}`,
        message: `Changed file matches forbidden API Contract Agent glob: ${file}`,
      });
    }
  }
}
