import {
  IntegrationConflictReportSchema,
  type IntegrationCandidate,
  type IntegrationConflictReport,
} from "./integration-contracts.js";
import { detectConflictedFiles, GitCommandRunner } from "./git-integration-runner.js";

export class CherryPickIntegrationRunner {
  public constructor(private readonly git: GitCommandRunner) {}

  public async applyCandidate(input: {
    runId: string;
    worktreePath: string;
    candidate: IntegrationCandidate;
    now: string;
  }): Promise<
    | { ok: true; stdout: string; stderr: string }
    | { ok: false; conflictReport: IntegrationConflictReport }
  > {
    const result = await this.git.exec({
      cwd: input.worktreePath,
      args: ["cherry-pick", input.candidate.commitSha],
      allowFailure: true,
    });

    if (result.exitCode === 0) {
      return {
        ok: true,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    }

    const conflictedFiles = await detectConflictedFiles(input.worktreePath, this.git);

    return {
      ok: false,
      conflictReport: IntegrationConflictReportSchema.parse({
        runId: input.runId,
        candidate: input.candidate,
        command: result.command,
        exitCode: result.exitCode,
        conflictedFiles,
        createdAt: input.now,
      }),
    };
  }
}
