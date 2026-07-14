import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  defaultFeatureStatuses,
  ReleaseManifestSchema,
  ReleasePackageBuilder,
  ReleaseVerificationResultSchema,
  renderReleaseNotes,
  verifyReleasePackageFilesAndRuntime,
} from "../release/index.js";

const DEFAULT_RELEASE_OUTPUT_DIRECTORY = "artifacts/releases";

export const BuildReleasePackageInputSchema = z
  .object({
    version: z
      .string()
      .regex(
        /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
      ),
    outputDirectory: z.string().trim().min(1).default(DEFAULT_RELEASE_OUTPUT_DIRECTORY),
    allowDirty: z.boolean().default(false),
  })
  .strict();

export const BuildReleasePackageResultSchema = z
  .object({
    build: z
      .object({
        packagePath: z.string().trim().min(1),
        sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        includedFiles: z.array(z.string()),
        gitCommit: z.string().regex(/^[a-f0-9]{40}$/),
      })
      .strict(),
    verification: ReleaseVerificationResultSchema,
    manifest: ReleaseManifestSchema,
    manifestPath: z.string().trim().min(1),
    notesPath: z.string().trim().min(1),
    checksumPath: z.string().trim().min(1),
  })
  .strict();

export const VerifyReleasePackageInputSchema = z
  .object({
    manifestPath: z.string().trim().min(1).optional(),
  })
  .strict();

export const VerifyReleasePackageResultSchema = z
  .object({
    verification: ReleaseVerificationResultSchema,
    manifestPath: z.string().trim().min(1).optional(),
  })
  .strict();

export const GenerateReleaseNotesInputSchema = z
  .object({
    manifestPath: z.string().trim().min(1).optional(),
    outputDirectory: z.string().trim().min(1).default(DEFAULT_RELEASE_OUTPUT_DIRECTORY),
  })
  .strict();

export const GenerateReleaseNotesResultSchema = z
  .object({
    notesPath: z.string().trim().min(1),
    manifestPath: z.string().trim().min(1).optional(),
    content: z.string().min(1),
  })
  .strict();

export class ReleaseService {
  private latestManifest: z.infer<typeof ReleaseManifestSchema> | undefined;
  private latestManifestPath: string | undefined;

  public constructor(
    private readonly projectRoot: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async buildReleasePackage(rawInput: unknown) {
    const input = BuildReleasePackageInputSchema.parse(rawInput);
    const outputDirectory = this.resolveOutputDirectory(input.outputDirectory);
    const builder = new ReleasePackageBuilder(this.projectRoot);
    const build = await builder.build({
      version: input.version,
      outputDirectory,
      allowDirty: input.allowDirty,
    });
    const verification = await verifyReleasePackageFilesAndRuntime({
      projectRoot: this.projectRoot,
      packagePath: build.packagePath,
      sha256: build.sha256,
      gitCommit: build.gitCommit,
      version: input.version,
      files: build.includedFiles,
    });
    const manifest = ReleaseManifestSchema.parse({
      name: "spec-to-pr",
      version: input.version,
      builtAt: this.now(),
      nodeVersion: process.version,
      packagePath: build.packagePath,
      packageSha256: build.sha256,
      gitCommit: build.gitCommit,
      includedFiles: build.includedFiles,
      excludedPatterns: [
        "node_modules/",
        ".git/",
        "__MACOSX/",
        ".env",
        ".sqlite",
        ".db",
        "coverage/",
        "tmp/",
      ],
      pluginValidationStatus: "skipped",
      features: defaultFeatureStatuses(),
    });
    const manifestPath = path.join(
      outputDirectory,
      `spec-to-pr-${input.version}.release-manifest.json`,
    );
    const notesPath = path.join(outputDirectory, `spec-to-pr-${input.version}.release-notes.md`);
    const checksumPath = path.join(outputDirectory, `spec-to-pr-${input.version}.sha256.txt`);

    await writeJson(manifestPath, manifest);
    await writeFile(notesPath, renderReleaseNotes(manifest), "utf8");
    await writeFile(checksumPath, `${build.sha256}  ${path.basename(build.packagePath)}\n`, "utf8");

    this.latestManifest = manifest;
    this.latestManifestPath = manifestPath;

    return BuildReleasePackageResultSchema.parse({
      build,
      verification,
      manifest,
      manifestPath,
      notesPath,
      checksumPath,
    });
  }

  public async verifyReleasePackage(rawInput: unknown = {}) {
    const input = VerifyReleasePackageInputSchema.parse(rawInput);
    const manifestPath = input.manifestPath ?? this.latestManifestPath;
    const manifest =
      manifestPath === undefined ? this.latestManifest : await readManifestFromPath(manifestPath);

    if (manifest === undefined) {
      throw new Error("No release manifest available. Build a release package first.");
    }

    const archiveVerification = await verifyReleasePackageFilesAndRuntime({
      projectRoot: this.projectRoot,
      packagePath: manifest.packagePath,
      sha256: manifest.packageSha256,
      gitCommit: manifest.gitCommit,
      version: manifest.version,
      files: manifest.includedFiles,
    });
    const checksumPath = path.join(
      path.dirname(manifestPath ?? manifest.packagePath),
      `spec-to-pr-${manifest.version}.sha256.txt`,
    );
    const expectedChecksum = `${manifest.packageSha256}  ${path.basename(manifest.packagePath)}\n`;
    let checksumMatches = false;

    try {
      checksumMatches = (await readFile(checksumPath, "utf8")) === expectedChecksum;
    } catch {
      checksumMatches = false;
    }

    const failures = [
      ...archiveVerification.failures,
      ...(checksumMatches
        ? []
        : ["Release checksum sidecar does not match the manifest and package name."]),
    ];
    const verification = ReleaseVerificationResultSchema.parse({
      ...archiveVerification,
      status: failures.length === 0 ? "passed" : "failed",
      failures,
    });

    return VerifyReleasePackageResultSchema.parse({
      verification,
      ...(manifestPath === undefined ? {} : { manifestPath }),
    });
  }

  public async generateReleaseNotes(rawInput: unknown = {}) {
    const input = GenerateReleaseNotesInputSchema.parse(rawInput);
    const manifestPath = input.manifestPath ?? this.latestManifestPath;
    const manifest =
      manifestPath === undefined ? this.latestManifest : await readManifestFromPath(manifestPath);

    if (manifest === undefined) {
      throw new Error("No release manifest available. Build a release package first.");
    }

    const outputDirectory = this.resolveOutputDirectory(input.outputDirectory);
    const notesPath = path.join(outputDirectory, `spec-to-pr-${manifest.version}.release-notes.md`);
    const content = renderReleaseNotes(manifest);

    await mkdir(outputDirectory, {
      recursive: true,
    });
    await writeFile(notesPath, content, "utf8");

    return GenerateReleaseNotesResultSchema.parse({
      notesPath,
      ...(manifestPath === undefined ? {} : { manifestPath }),
      content,
    });
  }

  private resolveOutputDirectory(outputDirectory: string): string {
    return path.isAbsolute(outputDirectory)
      ? outputDirectory
      : path.resolve(this.projectRoot, outputDirectory);
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readManifestFromPath(
  filePath: string,
): Promise<z.infer<typeof ReleaseManifestSchema>> {
  return ReleaseManifestSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
}
