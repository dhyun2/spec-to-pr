import { spawn } from "node:child_process";

import { QualityGateExecutionSchema } from "./quality-gate-model.js";
import type {
  PlannedQualityGate,
  QualityGateExecution,
  QualityGatePlanItem,
} from "./quality-gate-model.js";

const MAX_OUTPUT_CHARS = 1_000_000;

export async function executeQualityGate(
  gate: QualityGatePlanItem,
  now: () => string = () => new Date().toISOString(),
): Promise<QualityGateExecution> {
  if (gate.status === "skipped") {
    return QualityGateExecutionSchema.parse({
      gate: gate.gate,
      kind: gate.kind,
      status: "skipped",
      stdout: "",
      stderr: "",
      summary: `${gate.gate} skipped.`,
      skipReason: gate.skipReason,
    });
  }

  return executePlannedGate(gate, now);
}

export function skippedByFailFast(gate: QualityGatePlanItem): QualityGateExecution {
  return QualityGateExecutionSchema.parse({
    gate: gate.gate,
    kind: gate.kind,
    status: "skipped",
    stdout: "",
    stderr: "",
    summary: `${gate.gate} skipped.`,
    skipReason: "Skipped because failFast stopped after a failed gate.",
  });
}

async function executePlannedGate(
  gate: PlannedQualityGate,
  now: () => string,
): Promise<QualityGateExecution> {
  const startedAt = now();
  const startedMs = Date.now();

  const result = await runProcess(gate);
  const completedAt = now();
  const durationMs = Math.max(0, Date.now() - startedMs);
  const status =
    result.exitCode === 0 && !result.timedOut && result.spawnError === undefined
      ? "passed"
      : "failed";
  const failureReason =
    status === "failed"
      ? result.timedOut
        ? `Command timed out after ${gate.timeoutMs}ms.`
        : (result.spawnError ?? `Command exited with code ${result.exitCode ?? "unknown"}.`)
      : undefined;

  return QualityGateExecutionSchema.parse({
    gate: gate.gate,
    kind: gate.kind,
    status,
    command: gate.command,
    args: gate.args,
    cwd: gate.cwd,
    ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
    startedAt,
    completedAt,
    durationMs,
    stdout: result.stdout,
    stderr: result.stderr,
    summary: `${gate.gate} ${status}.`,
    ...(failureReason === undefined ? {} : { failureReason }),
  });
}

function runProcess(gate: PlannedQualityGate): Promise<{
  exitCode?: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
}> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const child = spawn(gate.command, gate.args, {
      cwd: gate.cwd,
      shell: false,
      env: {
        ...process.env,
        CI: process.env.CI ?? "1",
      },
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, gate.timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (chunk: string) => {
      stdout = appendCapped(stdout, chunk);
    });

    child.stderr?.on("data", (chunk: string) => {
      stderr = appendCapped(stderr, chunk);
    });

    child.on("error", (error) => {
      if (settled) return;

      settled = true;
      clearTimeout(timer);

      resolve({
        stdout,
        stderr,
        timedOut,
        spawnError: error.message,
      });
    });

    child.on("close", (code) => {
      if (settled) return;

      settled = true;
      clearTimeout(timer);

      resolve({
        ...(code === null && !timedOut ? {} : { exitCode: code ?? 1 }),
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

function appendCapped(current: string, chunk: string): string {
  if (current.length >= MAX_OUTPUT_CHARS) {
    return current;
  }

  const remaining = MAX_OUTPUT_CHARS - current.length;

  return `${current}${chunk.slice(0, remaining)}`;
}
