import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { allow, deny, type PolicyDecision } from "./policy.js";

export const PathAccessModeSchema = z.enum(["read", "write", "create"]);

export const ValidateWorkspacePathInputSchema = z
  .object({
    workspaceRoot: z.string().trim().min(1),
    candidatePath: z.string().trim().min(1),
    mode: PathAccessModeSchema.default("read"),
  })
  .strict();

export const ValidatedWorkspacePathSchema = z
  .object({
    workspaceRoot: z.string().trim().min(1),
    workspaceRootRealPath: z.string().trim().min(1),
    candidatePath: z.string().trim().min(1),
    candidateAbsolutePath: z.string().trim().min(1),
    candidateRealPath: z.string().trim().min(1).optional(),
    mode: PathAccessModeSchema,
    decision: z.unknown(),
  })
  .strict();

export type PathAccessMode = z.infer<typeof PathAccessModeSchema>;
export type ValidateWorkspacePathInput = z.infer<typeof ValidateWorkspacePathInputSchema>;

export type ValidatedWorkspacePath = {
  workspaceRoot: string;
  workspaceRootRealPath: string;
  candidatePath: string;
  candidateAbsolutePath: string;
  candidateRealPath?: string;
  mode: PathAccessMode;
  decision: PolicyDecision;
};

export async function validateWorkspacePath(
  rawInput: ValidateWorkspacePathInput,
): Promise<ValidatedWorkspacePath> {
  const input = ValidateWorkspacePathInputSchema.parse(rawInput);

  if (hasNullByte(input.candidatePath) || hasNullByte(input.workspaceRoot)) {
    return deniedPath(input, "NULL_BYTE", "Paths must not contain null bytes.");
  }

  const workspaceRootRealPath = await realpath(path.resolve(input.workspaceRoot));
  const candidateAbsolutePath = path.resolve(workspaceRootRealPath, input.candidatePath);

  if (!isInsideOrEqual(workspaceRootRealPath, candidateAbsolutePath)) {
    return {
      workspaceRoot: input.workspaceRoot,
      workspaceRootRealPath,
      candidatePath: input.candidatePath,
      candidateAbsolutePath,
      mode: input.mode,
      decision: deny(
        "PATH_OUTSIDE_WORKSPACE",
        "Resolved candidate path is outside the workspace root.",
        "critical",
        ["path", "workspace-escape"],
      ),
    };
  }

  if (input.mode === "create") {
    return validateCreatePath(input, workspaceRootRealPath, candidateAbsolutePath);
  }

  try {
    const candidateRealPath = await realpath(candidateAbsolutePath);

    if (!isInsideOrEqual(workspaceRootRealPath, candidateRealPath)) {
      return {
        workspaceRoot: input.workspaceRoot,
        workspaceRootRealPath,
        candidatePath: input.candidatePath,
        candidateAbsolutePath,
        candidateRealPath,
        mode: input.mode,
        decision: deny(
          "SYMLINK_ESCAPE",
          "Candidate path resolves outside the workspace through a symlink.",
          "critical",
          ["path", "symlink"],
        ),
      };
    }

    const metadata = await stat(candidateRealPath);

    if (input.mode === "write" && metadata.isDirectory()) {
      return {
        workspaceRoot: input.workspaceRoot,
        workspaceRootRealPath,
        candidatePath: input.candidatePath,
        candidateAbsolutePath,
        candidateRealPath,
        mode: input.mode,
        decision: deny(
          "WRITE_DIRECTORY",
          "Write mode requires a file path, not a directory.",
          "high",
          ["path", "write"],
        ),
      };
    }

    return {
      workspaceRoot: input.workspaceRoot,
      workspaceRootRealPath,
      candidatePath: input.candidatePath,
      candidateAbsolutePath,
      candidateRealPath,
      mode: input.mode,
      decision: allow("PATH_ALLOWED", "Path is inside the workspace.", ["path"]),
    };
  } catch (error: unknown) {
    return {
      workspaceRoot: input.workspaceRoot,
      workspaceRootRealPath,
      candidatePath: input.candidatePath,
      candidateAbsolutePath,
      mode: input.mode,
      decision: deny(
        "PATH_NOT_FOUND",
        error instanceof Error ? error.message : "Path does not exist.",
        "high",
        ["path"],
      ),
    };
  }
}

async function validateCreatePath(
  input: ValidateWorkspacePathInput,
  workspaceRootRealPath: string,
  candidateAbsolutePath: string,
): Promise<ValidatedWorkspacePath> {
  const parentPath = path.dirname(candidateAbsolutePath);

  try {
    const parentRealPath = await realpath(parentPath);

    if (!isInsideOrEqual(workspaceRootRealPath, parentRealPath)) {
      return {
        workspaceRoot: input.workspaceRoot,
        workspaceRootRealPath,
        candidatePath: input.candidatePath,
        candidateAbsolutePath,
        candidateRealPath: parentRealPath,
        mode: input.mode,
        decision: deny(
          "CREATE_PARENT_OUTSIDE_WORKSPACE",
          "The parent directory resolves outside the workspace.",
          "critical",
          ["path", "create", "symlink"],
        ),
      };
    }

    return {
      workspaceRoot: input.workspaceRoot,
      workspaceRootRealPath,
      candidatePath: input.candidatePath,
      candidateAbsolutePath,
      mode: input.mode,
      decision: allow("CREATE_PATH_ALLOWED", "Create path parent is inside the workspace.", [
        "path",
        "create",
      ]),
    };
  } catch (error: unknown) {
    return {
      workspaceRoot: input.workspaceRoot,
      workspaceRootRealPath,
      candidatePath: input.candidatePath,
      candidateAbsolutePath,
      mode: input.mode,
      decision: deny(
        "CREATE_PARENT_NOT_FOUND",
        error instanceof Error ? error.message : "Parent directory does not exist.",
        "high",
        ["path", "create"],
      ),
    };
  }
}

function deniedPath(
  input: ValidateWorkspacePathInput,
  code: string,
  message: string,
): ValidatedWorkspacePath {
  return {
    workspaceRoot: input.workspaceRoot,
    workspaceRootRealPath: path.resolve(input.workspaceRoot),
    candidatePath: input.candidatePath,
    candidateAbsolutePath: path.resolve(input.workspaceRoot, input.candidatePath),
    mode: input.mode,
    decision: deny(code, message, "critical", ["path"]),
  };
}

function hasNullByte(value: string): boolean {
  return value.includes("\0");
}

function isInsideOrEqual(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);

  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
