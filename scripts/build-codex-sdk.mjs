import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sdkRoot = path.join(projectRoot, "packages", "codex-sdk");

await rm(path.join(sdkRoot, "dist"), { recursive: true, force: true });

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(command, ["exec", "tsc", "-p", "tsconfig.json"], {
  cwd: sdkRoot,
  stdio: "inherit",
  shell: false,
});

if (result.error !== undefined) throw result.error;
process.exitCode = result.status ?? 1;
