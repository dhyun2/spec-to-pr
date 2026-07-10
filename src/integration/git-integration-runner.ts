import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitExecResult = {
  command: string;
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type GitExecInput = {
  cwd: string;
  args: string[];
  allowFailure?: boolean;
};

export class GitCommandRunner {
  public async exec(input: GitExecInput): Promise<GitExecResult> {
    const command = `git ${input.args.join(" ")}`;

    try {
      const { stdout, stderr } = await execFileAsync("git", input.args, {
        cwd: input.cwd,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      });

      return {
        command,
        cwd: input.cwd,
        exitCode: 0,
        stdout,
        stderr,
      };
    } catch (error: unknown) {
      const execError = error as {
        stdout?: string;
        stderr?: string;
        code?: number;
      };
      const result = {
        command,
        cwd: input.cwd,
        exitCode: typeof execError.code === "number" ? execError.code : 1,
        stdout: execError.stdout ?? "",
        stderr: execError.stderr ?? "",
      };

      if (input.allowFailure === true) {
        return result;
      }

      throw new Error(`Git command failed: ${command}\n${result.stderr}`);
    }
  }
}

export async function detectConflictedFiles(cwd: string, git: GitCommandRunner) {
  const result = await git.exec({
    cwd,
    args: ["diff", "--name-only", "--diff-filter=U"],
    allowFailure: true,
  });
  const files = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const reports = [];

  for (const file of files) {
    const content = await readFile(path.join(cwd, file), "utf8").catch(() => "");
    const conflictMarkersDetected =
      content.includes("<<<<<<<") && content.includes("=======") && content.includes(">>>>>>>");

    reports.push({
      path: file,
      reason: "git-conflict",
      conflictMarkersDetected,
    });
  }

  return reports;
}
