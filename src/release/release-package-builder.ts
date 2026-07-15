import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  RELEASE_DIRECTORY_ALLOWLIST,
  RELEASE_FILE_ALLOWLIST,
  RELEASE_FORBIDDEN_PATTERNS,
} from "./release-manifest.js";

export type ReleasePackageBuildResult = {
  packagePath: string;
  sha256: string;
  includedFiles: string[];
  gitCommit: string;
};

type ZipEntry = {
  name: string;
  content: Buffer;
  crc32: number;
  offset: number;
};

const FIXED_DOS_TIME = 0;
const FIXED_DOS_DATE = 33;
const MAINTAINER_ONLY_SKILL_PATHS = [
  ".agents/skills/prepare-release/",
  "skills/prepare-release/",
] as const;

export class ReleasePackageBuilder {
  public constructor(private readonly projectRoot: string) {}

  public async build(input: {
    version: string;
    outputDirectory: string;
    allowDirty?: boolean;
  }): Promise<ReleasePackageBuildResult> {
    if (input.allowDirty !== true) {
      const status = (
        await runGit(this.projectRoot, ["status", "--porcelain=v1", "--untracked-files=all"])
      )
        .toString("utf8")
        .trim();

      if (status.length > 0) {
        throw new Error(
          `Release build requires a clean worktree. Commit or remove these paths first:\n${status}`,
        );
      }
    }

    const snapshot = await this.collectReleaseSnapshot();
    const includedFiles = [...snapshot.files.keys()].sort();
    await mkdir(input.outputDirectory, { recursive: true });
    const packagePath = path.join(input.outputDirectory, `spec-to-pr-${input.version}.zip`);
    const zipBuffer = await createDeterministicZip({
      files: snapshot.files,
    });

    await writeFile(packagePath, zipBuffer);

    return {
      packagePath,
      sha256: sha256Buffer(zipBuffer),
      includedFiles,
      gitCommit: snapshot.gitCommit,
    };
  }

  private async collectReleaseSnapshot(): Promise<{
    gitCommit: string;
    files: Map<string, Buffer>;
  }> {
    const gitCommit = (await runGit(this.projectRoot, ["rev-parse", "HEAD"]))
      .toString("utf8")
      .trim();
    const tree = (await runGit(this.projectRoot, ["ls-tree", "-r", "-z", "--full-tree", gitCommit]))
      .toString("utf8")
      .split("\0")
      .filter((entry) => entry.length > 0);
    const files = new Map<string, Buffer>();

    for (const entry of tree) {
      const match = /^(\d{6})\s+blob\s+[a-f0-9]+\t(.+)$/u.exec(entry);

      if (match === null) {
        continue;
      }

      const mode = match[1]!;
      const file = match[2]!.split(path.sep).join("/");

      if (!isAllowedReleaseFile(file) || isForbiddenReleaseFile(file)) {
        continue;
      }
      if (mode !== "100644" && mode !== "100755") {
        throw new Error(`Release file must be a regular tracked file: ${file}`);
      }

      files.set(file, await runGit(this.projectRoot, ["show", `${gitCommit}:${file}`]));
    }

    return { gitCommit, files };
  }
}

export function isAllowedReleaseFile(file: string): boolean {
  if (MAINTAINER_ONLY_SKILL_PATHS.some((prefix) => file.startsWith(prefix))) {
    return false;
  }

  if ((RELEASE_FILE_ALLOWLIST as readonly string[]).includes(file)) {
    return true;
  }

  return RELEASE_DIRECTORY_ALLOWLIST.some((prefix) => file.startsWith(prefix));
}

export function isForbiddenReleaseFile(file: string): boolean {
  return RELEASE_FORBIDDEN_PATTERNS.some((pattern) => file.includes(pattern));
}

async function createDeterministicZip(input: { files: Map<string, Buffer> }): Promise<Buffer> {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  const entries: ZipEntry[] = [];
  let offset = 0;

  for (const [file, content] of [...input.files.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const crc = crc32(content);
    const name = Buffer.from(file, "utf8");
    const localHeader = Buffer.alloc(30);

    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(FIXED_DOS_TIME, 10);
    localHeader.writeUInt16LE(FIXED_DOS_DATE, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, name, content);
    entries.push({
      name: file,
      content,
      crc32: crc,
      offset,
    });
    offset += localHeader.length + name.length + content.length;
  }

  const centralDirectoryOffset = offset;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const centralHeader = Buffer.alloc(46);

    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(FIXED_DOS_TIME, 12);
    centralHeader.writeUInt16LE(FIXED_DOS_DATE, 14);
    centralHeader.writeUInt32LE(entry.crc32, 16);
    centralHeader.writeUInt32LE(entry.content.length, 20);
    centralHeader.writeUInt32LE(entry.content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(entry.offset, 42);

    centralParts.push(centralHeader, name);
    offset += centralHeader.length + name.length;
  }

  const centralDirectorySize = offset - centralDirectoryOffset;
  const end = Buffer.alloc(22);

  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectorySize, 12);
  end.writeUInt32LE(centralDirectoryOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

async function runGit(cwd: string, args: string[]): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
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

      reject(
        new Error(
          `git ${args[0] ?? "command"} failed (${String(code)}): ${Buffer.concat(stderr).toString("utf8").trim()}`,
        ),
      );
    });
  });
}

function sha256Buffer(buffer: Buffer): string {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff]!;
  }

  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;

  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }

  return value >>> 0;
});
