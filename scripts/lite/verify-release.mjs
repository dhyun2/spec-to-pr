import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const allowedFiles = new Set([
  ".agents/plugins/marketplace.json",
  ".claude-plugin/marketplace.json",
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  "CHANGELOG.md",
  "LICENSE",
  "README.ko.md",
  "README.md",
  "package.json",
  "website/docusaurus.config.ts",
  "website/package.json",
  "website/pnpm-lock.yaml",
  "website/docs/intro.md",
  "website/docs/getting-started/gitlab.md",
  "website/docs/usage/index.mdx",
  "website/docs/usage/legacy.mdx",
  "website/docs/concepts/pipeline.md",
  "website/docs/concepts/visual-verification.mdx",
  "website/docs/reference/skills.md",
  "website/docs/troubleshooting.md",
  ".github/workflows/deploy-docs.yml",
  "skills/spec-to-pr/SKILL.md",
  "skills/spec-to-pr/assets/pr-templates/README.md",
  "skills/spec-to-pr/assets/pr-templates/legacy-migration.md",
  "skills/spec-to-pr/assets/pr-templates/brief-delivery.md",
  "skills/spec-to-pr/assets/pr-templates/feature-flow.md",
  "skills/spec-to-pr/assets/pr-templates/figma-ui.md",
  "skills/spec-to-pr/references/cases.md",
  "skills/spec-to-pr/references/model-routing.md",
  "skills/spec-to-pr/references/openspec.md",
  "skills/spec-to-pr/scripts/compare-images.cjs",
  "skills/spec-to-pr/scripts/legacy-visual-evidence.cjs",
  "skills/spec-to-pr/scripts/legacy-source-inventory.cjs",
  "skills/spec-to-pr/scripts/check-gitlab-mr.cjs",
]);

const files = [...allowedFiles].filter((file) => {
  try {
    readFileSync(path.join(root, file));
    return true;
  } catch {
    return false;
  }
});
if (files.length !== allowedFiles.size) {
  const missing = [...allowedFiles].filter((file) => !files.includes(file));
  throw new Error(`Lite release is missing: ${missing.join(", ")}`);
}

const skills = readdirSync(path.join(root, "skills"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
if (skills.length !== 1 || skills[0] !== "spec-to-pr") {
  throw new Error(`Lite release must contain one skill; found ${skills.join(", ") || "none"}`);
}

for (const retiredPath of [
  ".mcp.json",
  "agents",
  "benchmarks",
  "dist",
  "docs",
  "schemas",
  "src",
  "packages/codex-sdk",
]) {
  if (existsSync(path.join(root, retiredPath))) {
    throw new Error(`Lite release must not contain retired runtime path: ${retiredPath}`);
  }
}

for (const manifestPath of [".codex-plugin/plugin.json", ".claude-plugin/plugin.json"]) {
  const manifest = JSON.parse(readFileSync(path.join(root, manifestPath), "utf8"));
  if ("mcpServers" in manifest) {
    throw new Error(`${manifestPath} must not include mcpServers`);
  }
}

console.log(`Lite release inventory verified (${files.length} files).`);
