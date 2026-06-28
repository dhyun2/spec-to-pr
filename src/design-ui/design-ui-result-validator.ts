import { readFile } from "node:fs/promises";
import path from "node:path";

import { minimatch } from "minimatch";

import type { ImplementationAgentResult } from "../runtime/agent-result.js";
import { AgentResultSchema } from "../runtime/agent-result.js";
import type { DesignUiAllowedFiles, DesignUiForbiddenImports } from "./design-ui-context.js";

export type DesignUiValidationIssue = {
  path: string;
  message: string;
};

export type DesignUiValidationResult = {
  valid: boolean;
  issues: DesignUiValidationIssue[];
};

export async function validateDesignUiAgentResult(input: {
  result: unknown;
  allowedFiles: DesignUiAllowedFiles;
  forbiddenImports: DesignUiForbiddenImports;
  worktreePath?: string;
}): Promise<DesignUiValidationResult> {
  const issues: DesignUiValidationIssue[] = [];
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
      message: "Design/UI Agent must submit an implementation result.",
    });

    return {
      valid: false,
      issues,
    };
  }

  if (result.agent !== "design-ui") {
    issues.push({
      path: "agent",
      message: "Design/UI Agent result must use agent=design-ui.",
    });
  }

  validateChangedFiles({
    allowedFiles: input.allowedFiles,
    result,
    issues,
  });

  if (input.worktreePath !== undefined) {
    await validateForbiddenImports({
      worktreePath: input.worktreePath,
      result,
      forbiddenImports: input.forbiddenImports,
      issues,
    });
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

function validateChangedFiles(input: {
  allowedFiles: DesignUiAllowedFiles;
  result: ImplementationAgentResult;
  issues: DesignUiValidationIssue[];
}): void {
  for (const file of input.result.changedFiles) {
    const forbidden = input.allowedFiles.forbiddenGlobs.some((glob) =>
      minimatch(file, glob, { dot: true }),
    );

    if (forbidden) {
      input.issues.push({
        path: `changedFiles.${file}`,
        message: `Design/UI agent changed forbidden file: ${file}`,
      });
      continue;
    }

    const allowed = input.allowedFiles.writableGlobs.some((glob) =>
      minimatch(file, glob, { dot: true }),
    );

    if (!allowed) {
      input.issues.push({
        path: `changedFiles.${file}`,
        message: `Changed file is outside Design/UI writable globs: ${file}`,
      });
    }
  }
}

async function validateForbiddenImports(input: {
  worktreePath: string;
  result: ImplementationAgentResult;
  forbiddenImports: DesignUiForbiddenImports;
  issues: DesignUiValidationIssue[];
}): Promise<void> {
  const patterns = input.forbiddenImports.forbiddenPatterns.map((pattern) => new RegExp(pattern));

  for (const file of input.result.changedFiles) {
    const absolutePath = path.join(input.worktreePath, file);
    const relative = path.relative(input.worktreePath, absolutePath);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      input.issues.push({
        path: `changedFiles.${file}`,
        message: `Changed file resolves outside Design/UI worktree: ${file}`,
      });
      continue;
    }

    const content = await readOptionalText(absolutePath);

    if (content === undefined) {
      continue;
    }

    if (patterns.some((pattern) => pattern.test(content))) {
      input.issues.push({
        path: `changedFiles.${file}`,
        message: input.forbiddenImports.message,
      });
    }
  }
}

async function readOptionalText(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return undefined;
    }

    throw error;
  }
}
