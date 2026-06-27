import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  IntakeManifestSchema,
  ProjectProfileSchema,
  type IntakeManifest,
  type ProjectProfile,
} from "./contracts.js";

export class JsonProfileStore {
  public constructor(private readonly directory: string) {}

  public async saveManifest(manifest: IntakeManifest): Promise<void> {
    await mkdir(this.directory, {
      recursive: true,
      mode: 0o700,
    });

    await writeFile(
      path.join(this.directory, `${manifest.runId}.intake.json`),
      `${JSON.stringify(IntakeManifestSchema.parse(manifest), null, 2)}\n`,
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
  }

  public async getManifest(runId: string): Promise<IntakeManifest> {
    const text = await readFile(path.join(this.directory, `${runId}.intake.json`), "utf8");

    return IntakeManifestSchema.parse(JSON.parse(text));
  }

  public async saveProfile(profile: ProjectProfile): Promise<void> {
    await mkdir(this.directory, {
      recursive: true,
      mode: 0o700,
    });

    await writeFile(
      path.join(this.directory, `${profile.runId}.profile.json`),
      `${JSON.stringify(ProjectProfileSchema.parse(profile), null, 2)}\n`,
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
  }

  public async getProfile(runId: string): Promise<ProjectProfile> {
    const text = await readFile(path.join(this.directory, `${runId}.profile.json`), "utf8");

    return ProjectProfileSchema.parse(JSON.parse(text));
  }

  public async listProfiles(): Promise<ProjectProfile[]> {
    await mkdir(this.directory, {
      recursive: true,
      mode: 0o700,
    });

    const files = await readdir(this.directory);
    const profileFiles = files.filter((file) => file.endsWith(".profile.json"));

    const profiles = await Promise.all(
      profileFiles.map(async (file) => {
        const text = await readFile(path.join(this.directory, file), "utf8");

        return ProjectProfileSchema.parse(JSON.parse(text));
      }),
    );

    return profiles.sort((left, right) => right.profiledAt.localeCompare(left.profiledAt));
  }
}
