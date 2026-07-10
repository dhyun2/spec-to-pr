import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import { RELEASE_FORBIDDEN_PATTERNS } from "./release-manifest.js";

const DEFAULT_RUNTIME_SMOKE_TIMEOUT_MS = 10_000;
const RUNTIME_SMOKE_ECHO = "release-smoke";

export const ReleaseVerificationResultSchema = z
  .object({
    status: z.enum(["passed", "failed"]),
    failures: z.array(z.string()).default([]),
    checkedFiles: z.array(z.string()).default([]),
    runtimeSmoke: z
      .object({
        status: z.enum(["passed", "failed"]),
        failures: z.array(z.string()).default([]),
        kernelInfo: z.record(z.string(), z.unknown()).optional(),
        kernelPing: z.record(z.string(), z.unknown()).optional(),
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
    kernelInfo: z.record(z.string(), z.unknown()).optional(),
    kernelPing: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type ReleaseRuntimeVerificationResult = z.infer<
  typeof ReleaseRuntimeVerificationResultSchema
>;

export const REQUIRED_RELEASE_FILES = [
  ".agents/plugins/marketplace.json",
  ".claude-plugin/marketplace.json",
  ".claude-plugin/plugin.json",
  ".codex/agents/spec-to-pr-design-ui-repair.toml",
  ".codex/agents/spec-to-pr-review-council.toml",
  ".codex/agents/spec-to-pr-visual-regression-reviewer.toml",
  ".codex-plugin/plugin.json",
  ".mcp.json",
  "CHANGELOG.md",
  "dist/mcp/server.js",
  "package.json",
] as const;

export function verifyReleasePackageFiles(files: string[]): ReleaseVerificationResult {
  const failures: string[] = [];
  const normalizedFiles = files.map((file) => file.split("\\").join("/")).sort();

  for (const file of normalizedFiles) {
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

  return ReleaseVerificationResultSchema.parse({
    status: failures.length === 0 ? "passed" : "failed",
    failures,
    checkedFiles: normalizedFiles,
  });
}

export async function verifyReleasePackageRuntime(input: {
  projectRoot: string;
  includedFiles: string[];
  dataDirectory?: string;
  nodePath?: string;
  timeoutMs?: number;
}): Promise<ReleaseRuntimeVerificationResult> {
  const normalizedFiles = input.includedFiles.map((file) => file.split("\\").join("/")).sort();

  if (!normalizedFiles.includes("dist/mcp/server.js")) {
    return ReleaseRuntimeVerificationResultSchema.parse({
      status: "failed",
      failures: ["Runtime smoke skipped because dist/mcp/server.js is missing."],
    });
  }

  const stagingDirectory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-release-smoke-"));

  try {
    await copyReleaseFiles({
      projectRoot: input.projectRoot,
      stagingDirectory,
      includedFiles: normalizedFiles,
    });

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
      kernelInfo: smoke.kernelInfo,
      kernelPing: smoke.kernelPing,
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
  files: string[];
  dataDirectory?: string;
  nodePath?: string;
  timeoutMs?: number;
}): Promise<ReleaseVerificationResult> {
  const fileVerification = verifyReleasePackageFiles(input.files);
  const runtimeSmoke = await verifyReleasePackageRuntime({
    projectRoot: input.projectRoot,
    includedFiles: fileVerification.checkedFiles,
    ...(input.dataDirectory === undefined ? {} : { dataDirectory: input.dataDirectory }),
    ...(input.nodePath === undefined ? {} : { nodePath: input.nodePath }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  });
  const failures = [...fileVerification.failures, ...runtimeSmoke.failures];

  return ReleaseVerificationResultSchema.parse({
    status:
      fileVerification.status === "passed" && runtimeSmoke.status === "passed"
        ? "passed"
        : "failed",
    failures,
    checkedFiles: fileVerification.checkedFiles,
    runtimeSmoke,
  });
}

async function copyReleaseFiles(input: {
  projectRoot: string;
  stagingDirectory: string;
  includedFiles: string[];
}): Promise<void> {
  for (const file of input.includedFiles) {
    const sourcePath = path.join(input.projectRoot, file);
    const destinationPath = path.join(input.stagingDirectory, file);

    await mkdir(path.dirname(destinationPath), {
      recursive: true,
    });
    await copyFile(sourcePath, destinationPath);
  }
}

async function runMcpKernelSmoke(input: {
  serverPath: string;
  cwd: string;
  dataDirectory: string;
  nodePath?: string;
  timeoutMs?: number;
}): Promise<{
  kernelInfo: Record<string, unknown>;
  kernelPing: Record<string, unknown>;
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

    const kernelInfoResult = await client.request("tools/call", {
      name: "kernel_info",
      arguments: {},
    });
    const kernelPingResult = await client.request("tools/call", {
      name: "kernel_ping",
      arguments: {
        echo: RUNTIME_SMOKE_ECHO,
      },
    });

    return {
      kernelInfo: extractStructuredContent(kernelInfoResult, "kernel_info"),
      kernelPing: extractStructuredContent(kernelPingResult, "kernel_ping"),
    };
  } finally {
    await client.close();
  }
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
