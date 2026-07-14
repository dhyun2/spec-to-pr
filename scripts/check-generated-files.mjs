import { spawnSync } from "node:child_process";

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error("Usage: node scripts/check-generated-files.mjs <path> [...path]");
  process.exit(2);
}

const result = spawnSync(
  "git",
  ["status", "--porcelain=v1", "--untracked-files=all", "--", ...paths],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
  },
);

if (result.error !== undefined) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stderr ?? "Generated-file status check failed.\n");
  process.exit(result.status ?? 1);
}

const changes = (result.stdout ?? "").trim();
if (changes.length > 0) {
  console.error("Generated files are not synchronized:");
  console.error(changes);
  process.exit(1);
}
