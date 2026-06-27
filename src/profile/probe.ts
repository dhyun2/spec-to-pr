import { execFile } from "node:child_process";
import { access, readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode?: number;
};

export type ProjectProbe = {
  root: string;
  realRoot: string;
  exists(relativePath: string): Promise<boolean>;
  readText(relativePath: string, maxBytes?: number): Promise<string | undefined>;
  readJson(relativePath: string, maxBytes?: number): Promise<unknown | undefined>;
  list(relativePath: string): Promise<string[]>;
  run(command: string, args: string[], options?: { timeoutMs?: number }): Promise<CommandResult>;
  toRelative(absolutePath: string): string;
  resolveInside(relativePath: string): Promise<string>;
};

export async function createProjectProbe(projectRoot: string): Promise<ProjectProbe> {
  const realRoot = await realpath(projectRoot);
  const metadata = await stat(realRoot);

  if (!metadata.isDirectory()) {
    throw new Error(`Project root is not a directory: ${realRoot}`);
  }

  async function resolveInside(relativePath: string): Promise<string> {
    const candidate = path.resolve(realRoot, relativePath);
    const realCandidate = await realpathOrParent(candidate);

    if (!isInside(realRoot, realCandidate)) {
      throw new Error(`Path escapes project root: ${relativePath}`);
    }

    return candidate;
  }

  const probe: ProjectProbe = {
    root: projectRoot,
    realRoot,

    async exists(relativePath: string): Promise<boolean> {
      const absolute = await resolveInside(relativePath);

      try {
        await access(absolute);
        return true;
      } catch {
        return false;
      }
    },

    async readText(relativePath: string, maxBytes = 1024 * 1024): Promise<string | undefined> {
      const absolute = await resolveInside(relativePath);

      try {
        const metadata = await stat(absolute);

        if (!metadata.isFile() || metadata.size > maxBytes) {
          return undefined;
        }

        return await readFile(absolute, "utf8");
      } catch {
        return undefined;
      }
    },

    async readJson(relativePath: string, maxBytes = 1024 * 1024): Promise<unknown | undefined> {
      const text = await probe.readText(relativePath, maxBytes);

      if (text === undefined) {
        return undefined;
      }

      try {
        return JSON.parse(text);
      } catch {
        return undefined;
      }
    },

    async list(relativePath: string): Promise<string[]> {
      const absolute = await resolveInside(relativePath);

      try {
        return await readdir(absolute);
      } catch {
        return [];
      }
    },

    async run(command: string, args: string[], options = {}): Promise<CommandResult> {
      try {
        const result = await execFileAsync(command, args, {
          cwd: realRoot,
          timeout: options.timeoutMs ?? 5_000,
          maxBuffer: 1024 * 1024,
          shell: false,
        });

        return {
          ok: true,
          stdout: result.stdout,
          stderr: result.stderr,
        };
      } catch (error: unknown) {
        const err = error as {
          stdout?: string;
          stderr?: string;
          code?: number;
        };

        return {
          ok: false,
          stdout: err.stdout ?? "",
          stderr: err.stderr ?? "",
          ...(typeof err.code === "number" ? { exitCode: err.code } : {}),
        };
      }
    },

    toRelative(absolutePath: string): string {
      return normalizeRelative(path.relative(realRoot, absolutePath));
    },

    resolveInside,
  };

  return probe;
}

function normalizeRelative(value: string): string {
  return value.split(path.sep).join("/");
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);

  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function realpathOrParent(candidate: string): Promise<string> {
  let current = candidate;

  while (current !== path.dirname(current)) {
    try {
      return await realpath(current);
    } catch {
      current = path.dirname(current);
    }
  }

  try {
    return await realpath(current);
  } catch {
    return current;
  }
}
