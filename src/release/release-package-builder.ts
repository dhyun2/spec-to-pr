import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
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
};

type ZipEntry = {
  name: string;
  content: Buffer;
  crc32: number;
  offset: number;
};

const FIXED_DOS_TIME = 0;
const FIXED_DOS_DATE = 33;

export class ReleasePackageBuilder {
  public constructor(private readonly projectRoot: string) {}

  public async build(input: {
    version: string;
    outputDirectory: string;
  }): Promise<ReleasePackageBuildResult> {
    await mkdir(input.outputDirectory, {
      recursive: true,
    });

    const includedFiles = await this.collectReleaseFiles();
    const packagePath = path.join(input.outputDirectory, `spec-to-pr-${input.version}.zip`);
    const zipBuffer = await createDeterministicZip({
      projectRoot: this.projectRoot,
      files: includedFiles,
    });

    await writeFile(packagePath, zipBuffer);

    return {
      packagePath,
      sha256: sha256Buffer(zipBuffer),
      includedFiles,
    };
  }

  private async collectReleaseFiles(): Promise<string[]> {
    const allFiles = await walk(this.projectRoot);

    return allFiles
      .map((file) => path.relative(this.projectRoot, file).split(path.sep).join("/"))
      .filter((file) => isAllowedReleaseFile(file))
      .filter((file) => !isForbiddenReleaseFile(file))
      .sort();
  }
}

export function isAllowedReleaseFile(file: string): boolean {
  if ((RELEASE_FILE_ALLOWLIST as readonly string[]).includes(file)) {
    return true;
  }

  return RELEASE_DIRECTORY_ALLOWLIST.some((prefix) => file.startsWith(prefix));
}

export function isForbiddenReleaseFile(file: string): boolean {
  return RELEASE_FORBIDDEN_PATTERNS.some((pattern) => file.includes(pattern));
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, {
    withFileTypes: true,
  });
  const files: string[] = [];

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walk(absolute)));
      continue;
    }

    if (entry.isFile()) {
      files.push(absolute);
    }
  }

  return files;
}

async function createDeterministicZip(input: {
  projectRoot: string;
  files: string[];
}): Promise<Buffer> {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  const entries: ZipEntry[] = [];
  let offset = 0;

  for (const file of input.files) {
    const content = await readFile(path.join(input.projectRoot, file));
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
