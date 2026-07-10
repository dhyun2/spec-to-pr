import { z } from "zod";

import { GitProfileSchema } from "./contracts.js";
import type { ProjectProbe } from "./probe.js";

export type GitProfile = z.infer<typeof GitProfileSchema>;

export async function detectGit(probe: ProjectProbe): Promise<GitProfile> {
  const topLevel = await probe.run("git", ["rev-parse", "--show-toplevel"]);

  if (!topLevel.ok) {
    return GitProfileSchema.parse({
      isGitRepository: false,
    });
  }

  const head = await probe.run("git", ["rev-parse", "HEAD"]);
  const branch = await probe.run("git", ["branch", "--show-current"]);
  const dirty = await probe.run("git", ["status", "--porcelain"]);
  const shallow = await probe.run("git", ["rev-parse", "--is-shallow-repository"]);

  return GitProfileSchema.parse({
    isGitRepository: true,
    root: topLevel.stdout.trim(),
    ...(head.ok ? { headCommit: head.stdout.trim() } : {}),
    ...(branch.ok && branch.stdout.trim() !== "" ? { currentBranch: branch.stdout.trim() } : {}),
    ...(dirty.ok ? { isDirty: dirty.stdout.trim().length > 0 } : {}),
    ...(shallow.ok ? { isShallow: shallow.stdout.trim() === "true" } : {}),
  });
}
