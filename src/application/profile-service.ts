import { z } from "zod";

import {
  IntakeManifestSchema,
  IntakeSourceInputSchema,
  ProjectProfileSchema,
} from "../profile/contracts.js";
import { profileProject } from "../profile/project-profiler.js";
import { JsonProfileStore } from "../profile/profile-store.js";
import { RunIdSchema } from "../runtime/ids.js";
import { GitObjectIdSchema } from "../runtime/scalars.js";

export const CreateIntakeManifestInputSchema = z
  .object({
    runId: RunIdSchema,
    projectRoot: z.string().trim().min(1),
    baseCommit: GitObjectIdSchema.optional(),
    targetWorkspace: z.string().trim().min(1).optional(),
    language: z.enum(["ko", "en"]).default("ko"),
    requestedScope: z.string().trim().min(1).max(4_000).optional(),
    sources: z.array(IntakeSourceInputSchema).default([]),
  })
  .strict();

export const InspectProjectInputSchema = z
  .object({
    runId: RunIdSchema,
    projectRoot: z.string().trim().min(1),
  })
  .strict();

export const GetProjectProfileInputSchema = z
  .object({
    runId: RunIdSchema,
  })
  .strict();

export class ProjectProfileService {
  public constructor(
    private readonly store: JsonProfileStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async createIntakeManifest(rawInput: unknown) {
    const input = CreateIntakeManifestInputSchema.parse(rawInput);

    const manifest = IntakeManifestSchema.parse({
      ...input,
      createdAt: this.now(),
    });

    await this.store.saveManifest(manifest);

    return manifest;
  }

  public async inspectProject(rawInput: unknown) {
    const input = InspectProjectInputSchema.parse(rawInput);

    const profile = ProjectProfileSchema.parse(
      await profileProject({
        runId: input.runId,
        projectRoot: input.projectRoot,
        now: this.now(),
      }),
    );

    await this.store.saveProfile(profile);

    return profile;
  }

  public async getProjectProfile(rawInput: unknown) {
    const input = GetProjectProfileInputSchema.parse(rawInput);

    return this.store.getProfile(input.runId);
  }

  public async listProjectProfiles() {
    return this.store.listProfiles();
  }
}
