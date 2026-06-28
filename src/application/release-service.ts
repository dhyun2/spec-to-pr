import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  defaultFeatureStatuses,
  EvalRunner,
  EvalSuiteReportSchema,
  ReleaseManifestSchema,
  ReleasePackageBuilder,
  ReleaseVerificationResultSchema,
  renderReleaseNotes,
  SecurityHardeningReportSchema,
  SecurityHardeningRunner,
  verifyReleasePackageFiles,
} from "../release/index.js";

const DEFAULT_RELEASE_OUTPUT_DIRECTORY = "artifacts/releases";

export const ListEvalSuitesResultSchema = z
  .object({
    suites: z.array(
      z
        .object({
          id: z.string().trim().min(1),
          caseCount: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();

export const RunEvalSuiteInputSchema = z
  .object({
    suiteId: z.string().trim().min(1).optional(),
    outputDirectory: z.string().trim().min(1).default(DEFAULT_RELEASE_OUTPUT_DIRECTORY),
  })
  .strict();

export const RunEvalSuiteResultSchema = z
  .object({
    report: EvalSuiteReportSchema,
    reportPath: z.string().trim().min(1),
  })
  .strict();

export const RunSecurityHardeningSuiteInputSchema = z
  .object({
    outputDirectory: z.string().trim().min(1).default(DEFAULT_RELEASE_OUTPUT_DIRECTORY),
  })
  .strict();

export const RunSecurityHardeningSuiteResultSchema = z
  .object({
    report: SecurityHardeningReportSchema,
    reportPath: z.string().trim().min(1),
  })
  .strict();

export const BuildReleasePackageInputSchema = z
  .object({
    version: z.string().trim().min(1),
    outputDirectory: z.string().trim().min(1).default(DEFAULT_RELEASE_OUTPUT_DIRECTORY),
  })
  .strict();

export const BuildReleasePackageResultSchema = z
  .object({
    build: z
      .object({
        packagePath: z.string().trim().min(1),
        sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        includedFiles: z.array(z.string()),
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
  private latestEvalReport: z.infer<typeof EvalSuiteReportSchema> | undefined;
  private latestSecurityReport: z.infer<typeof SecurityHardeningReportSchema> | undefined;
  private latestManifest: z.infer<typeof ReleaseManifestSchema> | undefined;
  private latestManifestPath: string | undefined;

  public constructor(
    private readonly projectRoot: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public listEvalSuites() {
    return ListEvalSuitesResultSchema.parse({
      suites: new EvalRunner({ now: this.now }).listSuites(),
    });
  }

  public async runEvalSuite(rawInput: unknown = {}) {
    const input = RunEvalSuiteInputSchema.parse(rawInput);
    const outputDirectory = this.resolveOutputDirectory(input.outputDirectory);
    const report = await new EvalRunner({ now: this.now }).runSuite(input.suiteId);
    const reportPath = path.join(outputDirectory, `${report.suiteId}.eval-report.json`);

    await mkdir(outputDirectory, {
      recursive: true,
    });
    await writeJson(reportPath, report);

    this.latestEvalReport = report;

    return RunEvalSuiteResultSchema.parse({
      report,
      reportPath,
    });
  }

  public async runSecurityHardeningSuite(rawInput: unknown = {}) {
    const input = RunSecurityHardeningSuiteInputSchema.parse(rawInput);
    const outputDirectory = this.resolveOutputDirectory(input.outputDirectory);
    const report = await new SecurityHardeningRunner(this.now).run();
    const reportPath = path.join(outputDirectory, "security-hardening-report.json");

    await mkdir(outputDirectory, {
      recursive: true,
    });
    await writeJson(reportPath, report);

    this.latestSecurityReport = report;

    return RunSecurityHardeningSuiteResultSchema.parse({
      report,
      reportPath,
    });
  }

  public async buildReleasePackage(rawInput: unknown) {
    const input = BuildReleasePackageInputSchema.parse(rawInput);
    const outputDirectory = this.resolveOutputDirectory(input.outputDirectory);
    const builder = new ReleasePackageBuilder(this.projectRoot);
    const build = await builder.build({
      version: input.version,
      outputDirectory,
    });
    const verification = verifyReleasePackageFiles(build.includedFiles);
    const manifest = ReleaseManifestSchema.parse({
      name: "spec-to-pr",
      version: input.version,
      builtAt: this.now(),
      nodeVersion: process.version,
      packagePath: build.packagePath,
      packageSha256: build.sha256,
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
      evalStatus: this.latestEvalReport?.status ?? "not-run",
      securityStatus: this.latestSecurityReport?.status ?? "not-run",
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

    const verification = verifyReleasePackageFiles(manifest.includedFiles);

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
