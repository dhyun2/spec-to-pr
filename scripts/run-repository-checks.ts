import { spawn } from "node:child_process";

import {
  buildRepositoryCheckPlan,
  type RepositoryCheckCommand,
} from "../src/release/repository-check-plan.js";

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

try {
  const plan = buildRepositoryCheckPlan();
  await runConcurrent(
    plan.buildLanes.map(async (lane) => {
      for (const command of lane.commands) await run(command);
    }),
  );
  await runConcurrent(plan.readOnlyCommands.map(run));
  await run(plan.testCommand);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function run([command, args]: RepositoryCheckCommand): Promise<void> {
  const executable = command === "pnpm" ? pnpmCommand : command;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed (${signal ?? code ?? "unknown"})`));
    });
  });
}

async function runConcurrent(operations: readonly Promise<void>[]): Promise<void> {
  const results = await Promise.allSettled(operations);
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure !== undefined) throw failure.reason;
}
