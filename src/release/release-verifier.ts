import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import { RELEASE_FORBIDDEN_PATTERNS, validateMcpBundleFiles } from "./release-manifest.js";

const DEFAULT_RUNTIME_SMOKE_TIMEOUT_MS = 10_000;
const EXPECTED_WORKFLOW_TOOLS = [
  "workflow_advance",
  "workflow_archive",
  "workflow_info",
  "workflow_publish",
  "workflow_start",
  "workflow_status",
  "workflow_submit",
] as const;
const MAX_TOOL_SCHEMA_BYTES = 40_000;

export const ReleaseVerificationResultSchema = z
  .object({
    status: z.enum(["passed", "failed"]),
    failures: z.array(z.string()).default([]),
    checkedFiles: z.array(z.string()).default([]),
    runtimeSmoke: z
      .object({
        status: z.enum(["passed", "failed"]),
        failures: z.array(z.string()).default([]),
        workflowInfo: z.record(z.string(), z.unknown()).optional(),
        toolNames: z.array(z.string()).optional(),
        toolSchemaBytes: z.number().int().nonnegative().optional(),
        workflowStatus: z.record(z.string(), z.unknown()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ReleaseVerificationResult = z.infer<typeof ReleaseVerificationResultSchema>;

export const ReleaseRuntimeVerificationResultSchema = z
  .object({
    status: z.enum(["passed", "failed"]),
    failures: z.array(z.string()).default([]),
    workflowInfo: z.record(z.string(), z.unknown()).optional(),
    toolNames: z.array(z.string()).optional(),
    toolSchemaBytes: z.number().int().nonnegative().optional(),
    workflowStatus: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type ReleaseRuntimeVerificationResult = z.infer<
  typeof ReleaseRuntimeVerificationResultSchema
>;

export const REQUIRED_RELEASE_FILES = [
  ".agents/plugins/marketplace.json",
  ".claude-plugin/marketplace.json",
  ".claude-plugin/plugin.json",
  ".codex/agents/spec-to-pr-design-reviewer.toml",
  ".codex/agents/spec-to-pr-functional-reviewer.toml",
  ".codex-plugin/plugin.json",
  ".mcp.json",
  "CHANGELOG.md",
  "dist/mcp/server.js",
  "dist/mcp/visual-comparison-worker.js",
  "package.json",
  "packages/codex-sdk/package.json",
  "schemas/runtime/index.json",
] as const;

export const REQUIRED_RELEASE_SKILLS = [
  "skills/archive-openspec/SKILL.md",
  "skills/doctor/SKILL.md",
  "skills/implement/SKILL.md",
  "skills/intake-contracts/SKILL.md",
  "skills/publish/SKILL.md",
  "skills/review-design/SKILL.md",
  "skills/review-functional/SKILL.md",
  "skills/spec-to-pr/SKILL.md",
] as const;

export const REQUIRED_MARKDOWN_AGENTS = [
  "agents/design-reviewer.md",
  "agents/functional-reviewer.md",
] as const;

export const REQUIRED_CODEX_AGENTS = [
  ".codex/agents/spec-to-pr-design-reviewer.toml",
  ".codex/agents/spec-to-pr-functional-reviewer.toml",
] as const;

const REQUIRED_RUNTIME_SCHEMAS = [
  "schemas/runtime/agent-result.schema.json",
  "schemas/runtime/artifact-ref.schema.json",
  "schemas/runtime/check-result.schema.json",
  "schemas/runtime/decision.schema.json",
  "schemas/runtime/draft-evidence-manifest.schema.json",
  "schemas/runtime/evidence-ref.schema.json",
  "schemas/runtime/gap.schema.json",
  "schemas/runtime/index.json",
  "schemas/runtime/run-manifest.schema.json",
  "schemas/runtime/run-summary.schema.json",
  "schemas/runtime/source-ref.schema.json",
] as const;

export function verifyReleasePackageFiles(files: string[]): ReleaseVerificationResult {
  const failures: string[] = [];
  const normalizedFiles = files.map((file) => file.split("\\").join("/")).sort();

  for (const file of normalizedFiles) {
    if (file.startsWith(".agents/skills/") || file.startsWith("skills/prepare-release/")) {
      failures.push(`Maintainer-only skill included: ${file}`);
    }
    for (const pattern of RELEASE_FORBIDDEN_PATTERNS) {
      if (file.includes(pattern)) {
        failures.push(`Forbidden file included: ${file}`);
      }
    }
  }

  for (const requiredFile of REQUIRED_RELEASE_FILES) {
    if (!normalizedFiles.includes(requiredFile)) {
      failures.push(`Required file missing: ${requiredFile}`);
    }
  }

  verifyExactInventory({
    files: normalizedFiles,
    expected: REQUIRED_RELEASE_SKILLS,
    actual: normalizedFiles.filter((file) => /^skills\/[^/]+\/SKILL\.md$/u.test(file)),
    label: "skill",
    failures,
  });
  verifyExactInventory({
    files: normalizedFiles,
    expected: REQUIRED_MARKDOWN_AGENTS,
    actual: normalizedFiles.filter((file) => /^agents\/[^/]+\.md$/u.test(file)),
    label: "Markdown agent",
    failures,
  });
  verifyExactInventory({
    files: normalizedFiles,
    expected: REQUIRED_CODEX_AGENTS,
    actual: normalizedFiles.filter((file) => /^\.codex\/agents\/[^/]+\.toml$/u.test(file)),
    label: "Codex agent",
    failures,
  });
  verifyExactInventory({
    files: normalizedFiles,
    expected: REQUIRED_RUNTIME_SCHEMAS,
    actual: normalizedFiles.filter((file) => file.startsWith("schemas/runtime/")),
    label: "runtime schema",
    failures,
  });
  verifySdkRuntimeInventory(normalizedFiles, failures);
  for (const file of normalizedFiles.filter((candidate) => candidate.startsWith("dist/mcp/"))) {
    if (!/^dist\/mcp\/[^/]+\.js$/u.test(file)) {
      failures.push(`Unexpected MCP runtime file included: ${file}`);
    }
  }

  return ReleaseVerificationResultSchema.parse({
    status: failures.length === 0 ? "passed" : "failed",
    failures,
    checkedFiles: normalizedFiles,
  });
}

export async function verifyReleaseArchive(input: {
  projectRoot: string;
  packagePath: string;
  expectedSha256: string;
  expectedFiles: string[];
  expectedGitCommit: string;
  expectedVersion: string;
  runtimeSmoke?: boolean;
  dataDirectory?: string;
  nodePath?: string;
  timeoutMs?: number;
}): Promise<ReleaseVerificationResult> {
  const failures: string[] = [];
  const archiveBytes = await readFile(input.packagePath);
  const actualSha256 = sha256Buffer(archiveBytes);

  if (actualSha256 !== input.expectedSha256) {
    failures.push(
      `Release archive checksum mismatch: expected ${input.expectedSha256}; received ${actualSha256}.`,
    );
  }
  const expectedPackageName = `spec-to-pr-${input.expectedVersion}.zip`;
  if (path.basename(input.packagePath) !== expectedPackageName) {
    failures.push(
      `Release archive filename mismatch: expected ${expectedPackageName}; received ${path.basename(input.packagePath)}.`,
    );
  }

  const commitExists = await gitCommitExists(input.projectRoot, input.expectedGitCommit);
  if (!commitExists) {
    failures.push(`Release archive commit is not available: ${input.expectedGitCommit}.`);
  }

  let entries = new Map<string, Buffer>();

  try {
    entries = parseZipEntries(archiveBytes);
    const actualFiles = [...entries.keys()].sort();
    const expectedFiles = normalizeFiles(input.expectedFiles);

    if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
      failures.push(
        `Release archive entries mismatch: expected ${expectedFiles.join(", ")}; received ${actualFiles.join(", ")}.`,
      );
    }

    failures.push(...verifyReleaseVersionDeclarations(entries, input.expectedVersion));
    failures.push(...validateMcpBundleFiles(entries));

    if (commitExists) {
      failures.push(
        ...(await verifyEntriesMatchCommit({
          projectRoot: input.projectRoot,
          gitCommit: input.expectedGitCommit,
          entries,
        })),
      );
    }
  } catch (error: unknown) {
    failures.push(
      `Release archive entries could not be read: ${error instanceof Error ? error.message : "unknown ZIP error"}.`,
    );
  }

  let runtimeSmoke: ReleaseRuntimeVerificationResult | undefined;

  if (input.runtimeSmoke !== false && entries.has("dist/mcp/server.js")) {
    runtimeSmoke = await verifyReleasePackageRuntime({
      packagePath: input.packagePath,
      ...(input.dataDirectory === undefined ? {} : { dataDirectory: input.dataDirectory }),
      ...(input.nodePath === undefined ? {} : { nodePath: input.nodePath }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    });
    failures.push(...runtimeSmoke.failures);
  }

  return ReleaseVerificationResultSchema.parse({
    status: failures.length === 0 ? "passed" : "failed",
    failures,
    checkedFiles: [...entries.keys()].sort(),
    ...(runtimeSmoke === undefined ? {} : { runtimeSmoke }),
  });
}

export function verifyReleaseVersionDeclarations(
  files: ReadonlyMap<string, Buffer>,
  expectedVersion: string,
): string[] {
  const failures: string[] = [];

  if (!isSemver(expectedVersion)) {
    failures.push(`Release version must be valid semver: ${expectedVersion}`);
    return failures;
  }

  for (const file of [
    "package.json",
    "packages/codex-sdk/package.json",
    ".claude-plugin/plugin.json",
    ".codex-plugin/plugin.json",
  ]) {
    const json = readJsonObject(files, file, failures);
    if (json === undefined) continue;
    verifyDeclaredVersion(file, json["version"], expectedVersion, failures);
  }

  const marketplace = readJsonObject(files, ".claude-plugin/marketplace.json", failures);
  if (marketplace !== undefined) {
    verifyDeclaredVersion(
      ".claude-plugin/marketplace.json",
      marketplace["version"],
      expectedVersion,
      failures,
    );
    const plugins = marketplace["plugins"];
    const plugin = Array.isArray(plugins) && isRecord(plugins[0]) ? plugins[0] : undefined;
    verifyDeclaredVersion(
      ".claude-plugin/marketplace.json plugins[0]",
      plugin?.["version"],
      expectedVersion,
      failures,
    );
    const source =
      plugin !== undefined && isRecord(plugin["source"]) ? plugin["source"] : undefined;
    const expectedRef = `spec-to-pr--v${expectedVersion}`;
    if (source?.["ref"] !== expectedRef) {
      failures.push(
        `.claude-plugin/marketplace.json source ref is ${String(source?.["ref"])}; expected ${expectedRef}.`,
      );
    }
  }

  return failures;
}

export function verifyReviewerProfileParity(files: ReadonlyMap<string, Buffer>): string[] {
  const failures: string[] = [];
  const pairs = [
    {
      label: "functional reviewer",
      markdown: "agents/functional-reviewer.md",
      codex: ".codex/agents/spec-to-pr-functional-reviewer.toml",
      markers: [
        "immutable review packet",
        "token pressure",
        "scope split",
        "every required functional gate",
        "every reviewed requirement",
        "playwright",
        "25 mb",
        "read-only",
        "never edit implementation",
        "workflow mcp",
        "92%",
        "focused ui assertions",
        "baseline references",
        "renderer lineage",
        "third valid failure",
      ],
      codexAssignments: ["mcp_servers = {}"],
    },
    {
      label: "design reviewer",
      markdown: "agents/design-reviewer.md",
      codex: ".codex/agents/spec-to-pr-design-reviewer.toml",
      markers: [
        "immutable review packet",
        "token pressure",
        "scope split",
        "every required design gate",
        "every reviewed requirement",
        "visual baseline",
        "read-only",
        "never edit implementation",
        "workflow mcp",
        "92%",
        "focused ui assertions",
        "baseline references",
        "renderer lineage",
        "third valid failure",
      ],
      codexAssignments: ["mcp_servers = {}"],
    },
  ] as const;

  for (const pair of pairs) {
    const markdown = files.get(pair.markdown)?.toString("utf8").toLowerCase();
    const codex = files.get(pair.codex)?.toString("utf8").toLowerCase();

    if (markdown === undefined || codex === undefined) {
      failures.push(`Reviewer profile pair missing for ${pair.label}.`);
      continue;
    }

    for (const marker of pair.markers) {
      if (!markdown.includes(marker) || !codex.includes(marker)) {
        failures.push(`Reviewer profile parity missing '${marker}' for ${pair.label}.`);
      }
    }
    const codexLines = codex.split(/\r?\n/u).map((line) => line.trim());
    for (const assignment of pair.codexAssignments) {
      if (!codexLines.includes(assignment)) {
        failures.push(`Reviewer Codex profile missing '${assignment}' for ${pair.label}.`);
      }
    }
  }

  return failures;
}

export async function verifyReleasePackageRuntime(input: {
  packagePath: string;
  dataDirectory?: string;
  nodePath?: string;
  timeoutMs?: number;
}): Promise<ReleaseRuntimeVerificationResult> {
  const stagingDirectory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-release-smoke-"));

  try {
    const entries = parseZipEntries(await readFile(input.packagePath));

    if (!entries.has("dist/mcp/server.js")) {
      throw new Error("Runtime smoke skipped because dist/mcp/server.js is missing.");
    }

    await extractArchiveEntries(entries, stagingDirectory);

    const smoke = await runMcpKernelSmoke({
      serverPath: path.join(stagingDirectory, "dist", "mcp", "server.js"),
      cwd: stagingDirectory,
      dataDirectory: input.dataDirectory ?? path.join(stagingDirectory, ".spec-to-pr-data"),
      ...(input.nodePath === undefined ? {} : { nodePath: input.nodePath }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    });

    return ReleaseRuntimeVerificationResultSchema.parse({
      status: "passed",
      failures: [],
      workflowInfo: smoke.workflowInfo,
      toolNames: smoke.toolNames,
      toolSchemaBytes: smoke.toolSchemaBytes,
      workflowStatus: smoke.workflowStatus,
    });
  } catch (error: unknown) {
    return ReleaseRuntimeVerificationResultSchema.parse({
      status: "failed",
      failures: [error instanceof Error ? error.message : "Unknown runtime smoke failure."],
    });
  } finally {
    await rm(stagingDirectory, {
      recursive: true,
      force: true,
    });
  }
}

export async function verifyReleasePackageFilesAndRuntime(input: {
  projectRoot: string;
  packagePath: string;
  sha256: string;
  gitCommit: string;
  version: string;
  files: string[];
  dataDirectory?: string;
  nodePath?: string;
  timeoutMs?: number;
}): Promise<ReleaseVerificationResult> {
  const fileVerification = verifyReleasePackageFiles(input.files);
  const archiveVerification = await verifyReleaseArchive({
    projectRoot: input.projectRoot,
    packagePath: input.packagePath,
    expectedSha256: input.sha256,
    expectedGitCommit: input.gitCommit,
    expectedVersion: input.version,
    expectedFiles: fileVerification.checkedFiles,
    ...(input.dataDirectory === undefined ? {} : { dataDirectory: input.dataDirectory }),
    ...(input.nodePath === undefined ? {} : { nodePath: input.nodePath }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  });
  const failures = [...fileVerification.failures, ...archiveVerification.failures];

  return ReleaseVerificationResultSchema.parse({
    status: failures.length === 0 ? "passed" : "failed",
    failures,
    checkedFiles: archiveVerification.checkedFiles,
    ...(archiveVerification.runtimeSmoke === undefined
      ? {}
      : { runtimeSmoke: archiveVerification.runtimeSmoke }),
  });
}

function verifyExactInventory(input: {
  files: string[];
  expected: readonly string[];
  actual: string[];
  label: string;
  failures: string[];
}): void {
  const expected = new Set(input.expected);
  const actual = new Set(input.actual);

  for (const file of expected) {
    if (!actual.has(file)) {
      input.failures.push(`Required ${input.label} missing: ${file}`);
    }
  }
  for (const file of actual) {
    if (!expected.has(file)) {
      input.failures.push(`Unexpected ${input.label} included: ${file}`);
    }
  }
}

function verifySdkRuntimeInventory(files: string[], failures: string[]): void {
  const sdkFiles = files.filter((file) => file.startsWith("packages/codex-sdk/dist/"));
  const requiredModules = new Set([
    "boundary-runner",
    "cli",
    "generated/delivery-mode-policy",
    "model-routing",
    "spec-to-pr-runner",
    "usage-calibration",
    "workflow-policy",
    "workload-budget",
  ]);
  const modules = new Map<string, Set<"js" | "d.ts">>();

  for (const file of sdkFiles) {
    const relative = file.slice("packages/codex-sdk/dist/".length);
    const match = /^(.+)\.(d\.ts|js)$/u.exec(relative);

    if (match === null) {
      failures.push(`Unexpected Codex SDK runtime file included: ${file}`);
      continue;
    }

    const module = match[1]!;
    const extension = match[2] as "js" | "d.ts";
    const extensions = modules.get(module) ?? new Set<"js" | "d.ts">();
    extensions.add(extension);
    modules.set(module, extensions);
  }

  for (const module of requiredModules) {
    if (!modules.has(module)) {
      failures.push(`Required Codex SDK runtime module missing: ${module}`);
    }
  }
  for (const [module, extensions] of modules) {
    if (!requiredModules.has(module)) {
      failures.push(`Unexpected Codex SDK runtime module included: ${module}`);
    }
    if (!extensions.has("js") || !extensions.has("d.ts")) {
      failures.push(`Codex SDK runtime module must include JS and declarations: ${module}`);
    }
  }
}

function normalizeFiles(files: readonly string[]): string[] {
  return files.map((file) => file.split("\\").join("/")).sort();
}

function sha256Buffer(buffer: Buffer): string {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

function parseZipEntries(buffer: Buffer): Map<string, Buffer> {
  const endSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const endOffset = buffer.lastIndexOf(endSignature);

  if (endOffset < 0 || endOffset + 22 !== buffer.length) {
    throw new Error("ZIP end-of-central-directory record is missing");
  }

  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);

  if (entryCount > 10_000 || centralOffset + centralSize > endOffset) {
    throw new Error("ZIP central directory is outside the archive bounds");
  }

  const entries = new Map<string, Buffer>();
  let offset = centralOffset;
  let totalBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`ZIP central entry ${index} is invalid`);
    }

    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const expectedCrc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const nameEnd = offset + 46 + nameLength;

    if ((flags & 0x1) !== 0 || method !== 0 || compressedSize !== uncompressedSize) {
      throw new Error("ZIP entries must be unencrypted and stored without compression");
    }
    if (nameEnd > buffer.length) {
      throw new Error(`ZIP entry ${index} name is outside the archive bounds`);
    }

    const name = buffer.subarray(offset + 46, nameEnd).toString("utf8");
    assertSafeArchivePath(name);

    if (entries.has(name)) {
      throw new Error(`ZIP contains a duplicate entry: ${name}`);
    }
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`ZIP local entry is invalid: ${name}`);
    }

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    const localCrc = buffer.readUInt32LE(localOffset + 14);
    const localCompressedSize = buffer.readUInt32LE(localOffset + 18);
    const localUncompressedSize = buffer.readUInt32LE(localOffset + 22);
    const localNameStart = localOffset + 30;
    const localNameEnd = localNameStart + localNameLength;
    const dataStart = localNameEnd + localExtraLength;
    const dataEnd = dataStart + compressedSize;

    if (
      localFlags !== flags ||
      localMethod !== method ||
      localCrc !== expectedCrc ||
      localCompressedSize !== compressedSize ||
      localUncompressedSize !== uncompressedSize ||
      dataEnd > buffer.length ||
      buffer.subarray(localNameStart, localNameEnd).toString("utf8") !== name
    ) {
      throw new Error(`ZIP local entry bounds or name mismatch: ${name}`);
    }

    const content = Buffer.from(buffer.subarray(dataStart, dataEnd));
    if (crc32(content) !== expectedCrc) {
      throw new Error(`ZIP entry CRC mismatch: ${name}`);
    }

    totalBytes += content.length;
    if (totalBytes > 250 * 1024 * 1024) {
      throw new Error("ZIP extracted content exceeds the 250 MB release limit");
    }

    entries.set(name, content);
    offset = nameEnd + extraLength + commentLength;
  }

  if (offset !== centralOffset + centralSize) {
    throw new Error("ZIP central directory size does not match its entries");
  }

  return entries;
}

function assertSafeArchivePath(file: string): void {
  const segments = file.split("/");

  if (
    file.length === 0 ||
    file.includes("\\") ||
    file.startsWith("/") ||
    /^[A-Za-z]:/u.test(file) ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new Error(`ZIP entry path is unsafe: ${file}`);
  }
}

async function extractArchiveEntries(
  entries: ReadonlyMap<string, Buffer>,
  stagingDirectory: string,
): Promise<void> {
  for (const [file, content] of entries) {
    assertSafeArchivePath(file);
    const destination = path.join(stagingDirectory, ...file.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
}

async function gitCommitExists(projectRoot: string, gitCommit: string): Promise<boolean> {
  if (!/^[a-f0-9]{40}$/u.test(gitCommit)) return false;

  try {
    await runGit(projectRoot, ["cat-file", "-e", `${gitCommit}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

async function verifyEntriesMatchCommit(input: {
  projectRoot: string;
  gitCommit: string;
  entries: ReadonlyMap<string, Buffer>;
}): Promise<string[]> {
  const failures: string[] = [];

  for (const [file, content] of input.entries) {
    try {
      const committed = await runGit(input.projectRoot, ["show", `${input.gitCommit}:${file}`]);
      if (!committed.equals(content)) {
        failures.push(`Release archive file does not match commit ${input.gitCommit}: ${file}`);
      }
    } catch {
      failures.push(`Release archive file is absent from commit ${input.gitCommit}: ${file}`);
    }
  }

  return failures;
}

async function runGit(cwd: string, args: string[]): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout));
        return;
      }
      reject(new Error(Buffer.concat(stderr).toString("utf8").trim()));
    });
  });
}

function isSemver(value: string): boolean {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.test(
    value,
  );
}

function readJsonObject(
  files: ReadonlyMap<string, Buffer>,
  file: string,
  failures: string[],
): Record<string, unknown> | undefined {
  const content = files.get(file);

  if (content === undefined) {
    failures.push(`Release version declaration file missing: ${file}.`);
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(content.toString("utf8"));
    if (!isRecord(parsed)) throw new Error("expected a JSON object");
    return parsed;
  } catch (error: unknown) {
    failures.push(
      `Release version declaration is invalid JSON: ${file} (${error instanceof Error ? error.message : "unknown error"}).`,
    );
    return undefined;
  }
}

function verifyDeclaredVersion(
  label: string,
  actual: unknown,
  expected: string,
  failures: string[],
): void {
  if (actual !== expected) {
    failures.push(`${label} declares version ${String(actual)}; expected ${expected}.`);
  }
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff]!;
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

async function runMcpKernelSmoke(input: {
  serverPath: string;
  cwd: string;
  dataDirectory: string;
  nodePath?: string;
  timeoutMs?: number;
}): Promise<{
  workflowInfo: Record<string, unknown>;
  toolNames: string[];
  toolSchemaBytes: number;
  workflowStatus: Record<string, unknown>;
}> {
  await mkdir(input.dataDirectory, {
    recursive: true,
  });

  const child = spawn(input.nodePath ?? process.execPath, [input.serverPath], {
    cwd: input.cwd,
    env: {
      ...process.env,
      SPEC_TO_PR_DATA_DIR: input.dataDirectory,
      GITHUB_TOKEN: "",
      GH_TOKEN: "",
      GITLAB_TOKEN: "",
      GITLAB_PRIVATE_TOKEN: "",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const client = new RawMcpStdioClient(child, input.timeoutMs ?? DEFAULT_RUNTIME_SMOKE_TIMEOUT_MS);

  try {
    await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: {
        name: "spec-to-pr-release-smoke",
        version: "0.1.0",
      },
    });
    client.notify("notifications/initialized", {});

    const toolsResult = await client.request("tools/list", {});
    const tools = extractTools(toolsResult);
    const toolNames = tools
      .map((tool) => tool["name"])
      .filter((name): name is string => typeof name === "string")
      .sort();
    const toolSchemaBytes = Buffer.byteLength(JSON.stringify(tools), "utf8");

    if (JSON.stringify(toolNames) !== JSON.stringify(EXPECTED_WORKFLOW_TOOLS)) {
      throw new Error(
        `MCP runtime smoke expected exactly ${EXPECTED_WORKFLOW_TOOLS.join(", ")}; received ${toolNames.join(", ")}.`,
      );
    }
    if (toolSchemaBytes >= MAX_TOOL_SCHEMA_BYTES) {
      throw new Error(
        `MCP runtime smoke tool schemas use ${toolSchemaBytes} bytes; budget is below ${MAX_TOOL_SCHEMA_BYTES}.`,
      );
    }

    const workflowInfoResult = await client.request("tools/call", {
      name: "workflow_info",
      arguments: {},
    });
    const workflowInfo = extractStructuredContent(workflowInfoResult, "workflow_info");
    const workflowStartResult = await client.request("tools/call", {
      name: "workflow_start",
      arguments: {
        projectRoot: input.cwd,
        requestText: "Release runtime smoke: verify the non-UI workflow facade.",
        scope: "non-ui",
      },
    });
    const started = extractStructuredContent(workflowStartResult, "workflow_start");
    const runId = started["runId"];

    if (typeof runId !== "string") {
      throw new Error("MCP runtime smoke workflow_start result did not include a runId.");
    }

    const workflowStatusResult = await client.request("tools/call", {
      name: "workflow_status",
      arguments: { runId },
    });
    const workflowStatus = extractStructuredContent(workflowStatusResult, "workflow_status");

    if (
      workflowStatus["runId"] !== runId ||
      workflowStatus["status"] !== "needs-external-action" ||
      workflowStatus["currentStage"] !== "contracts"
    ) {
      throw new Error(
        "MCP runtime smoke workflow_status did not return the started Run at the contracts boundary.",
      );
    }

    return {
      workflowInfo,
      toolNames,
      toolSchemaBytes,
      workflowStatus,
    };
  } finally {
    await client.close();
  }
}

function extractTools(result: unknown): Record<string, unknown>[] {
  if (
    isRecord(result) &&
    Array.isArray(result["tools"]) &&
    result["tools"].every((tool) => isRecord(tool))
  ) {
    return result["tools"];
  }

  throw new Error("MCP runtime smoke tools/list result did not include a valid tools array.");
}

class RawMcpStdioClient {
  private nextId = 1;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  public constructor(
    private readonly child: ReturnType<typeof spawn>,
    private readonly timeoutMs: number,
  ) {
    child.stdout?.on("data", (chunk: Buffer) => this.handleStdout(chunk));
    child.stderr?.on("data", (chunk: Buffer) => {
      this.stderrBuffer += chunk.toString("utf8");
    });
    child.on("error", (error) => this.rejectAll(error));
    child.on("exit", (code, signal) => {
      if (this.pending.size > 0) {
        this.rejectAll(
          new Error(
            `MCP runtime smoke server exited before responding (code=${String(code)}, signal=${String(signal)}).${this.formatStderr()}`,
          ),
        );
      }
    });
  }

  public request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `MCP runtime smoke timed out while waiting for ${method}.${this.formatStderr()}`,
          ),
        );
      }, this.timeoutMs);

      this.pending.set(id, {
        resolve,
        reject,
        timer,
      });
      this.write(payload);
    });
  }

  public notify(method: string, params: Record<string, unknown>): void {
    this.write({
      jsonrpc: "2.0",
      method,
      params,
    });
  }

  public async close(): Promise<void> {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
    }
    this.pending.clear();

    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      return;
    }

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 500);

      this.child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
      this.child.kill("SIGTERM");
    });
  }

  private write(payload: Record<string, unknown>): void {
    this.child.stdin?.write(`${JSON.stringify(payload)}\n`);
  }

  private handleStdout(chunk: Buffer): void {
    this.stdoutBuffer += chunk.toString("utf8");

    for (;;) {
      const newlineIndex = this.stdoutBuffer.indexOf("\n");

      if (newlineIndex === -1) {
        return;
      }

      const line = this.stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, "");
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);

      if (line.trim().length === 0) {
        continue;
      }

      this.handleMessage(line);
    }
  }

  private handleMessage(line: string): void {
    let message: unknown;

    try {
      message = JSON.parse(line);
    } catch (error: unknown) {
      this.rejectAll(
        new Error(
          `MCP runtime smoke emitted invalid JSON on stdout: ${String(line)}. ${
            error instanceof Error ? error.message : ""
          }`,
        ),
      );
      return;
    }

    if (!isJsonRpcResponse(message)) {
      return;
    }

    const pending = this.pending.get(message.id);

    if (pending === undefined) {
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(message.id);

    if (message.error !== undefined) {
      pending.reject(new Error(`MCP runtime smoke request failed: ${message.error.message}`));
      return;
    }

    pending.resolve(message.result);
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private formatStderr(): string {
    const stderr = this.stderrBuffer.trim();

    return stderr.length === 0 ? "" : ` stderr: ${stderr}`;
  }
}

function extractStructuredContent(result: unknown, toolName: string): Record<string, unknown> {
  if (isRecord(result) && isRecord(result["structuredContent"])) {
    return result["structuredContent"];
  }

  throw new Error(`MCP runtime smoke ${toolName} result did not include structuredContent.`);
}

function isJsonRpcResponse(message: unknown): message is {
  id: number;
  result?: unknown;
  error?: {
    message: string;
  };
} {
  return (
    isRecord(message) &&
    typeof message["id"] === "number" &&
    (message["result"] !== undefined ||
      (isRecord(message["error"]) && typeof message["error"]["message"] === "string"))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
