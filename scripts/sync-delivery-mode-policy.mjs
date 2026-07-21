import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "src/workflow/delivery-mode-policy.ts");
const generatedPath = path.join(root, "packages/codex-sdk/src/generated/delivery-mode-policy.ts");
const source = await readFile(sourcePath, "utf8");
const expected = `// Generated from src/workflow/delivery-mode-policy.ts. Do not edit.\n${source}`;

if (process.argv.includes("--check")) {
  const current = await readFile(generatedPath, "utf8").catch(() => "");
  if (current !== expected) {
    process.stderr.write("Generated delivery mode policy is stale. Run pnpm policy:sync.\n");
    process.exitCode = 1;
  }
} else {
  await mkdir(path.dirname(generatedPath), { recursive: true });
  await writeFile(generatedPath, expected, "utf8");
}
