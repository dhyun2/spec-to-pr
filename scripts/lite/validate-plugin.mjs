import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const packageJson = readJson("package.json");
const version = packageJson.version;

const codex = readJson(".codex-plugin/plugin.json");
const claude = readJson(".claude-plugin/plugin.json");
const marketplace = readJson(".claude-plugin/marketplace.json");

assert(codex.name === "spec-to-pr", "Codex plugin name must be spec-to-pr");
assert(codex.version === version, "Codex plugin version must match package.json");
assert(codex.skills === "./skills/", "Codex plugin must expose the skills directory");
assert(!("mcpServers" in codex), "Codex Lite plugin must not declare an MCP server");
assert(claude.name === "spec-to-pr", "Claude plugin name must be spec-to-pr");
assert(claude.version === version, "Claude plugin version must match package.json");
assert(claude.skills === "./skills/", "Claude plugin must expose the skills directory");
assert(!("mcpServers" in claude), "Claude Lite plugin must not declare an MCP server");
assert(marketplace.version === version, "Claude marketplace version must match package.json");
assert(
  marketplace.plugins?.[0]?.version === version,
  "Claude marketplace plugin version must match package.json",
);

const skillDirectories = readdirSync(path.join(root, "skills"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
assert(
  JSON.stringify(skillDirectories) === JSON.stringify(["spec-to-pr"]),
  `Lite plugin must ship one public skill; found ${skillDirectories.join(", ") || "none"}`,
);

for (const file of [
  "skills/spec-to-pr/SKILL.md",
  "skills/spec-to-pr/references/cases.md",
  "skills/spec-to-pr/references/openspec.md",
  "skills/spec-to-pr/assets/pr-template.md",
  "skills/spec-to-pr/scripts/compare-images.cjs",
  "skills/spec-to-pr/scripts/check-gitlab-mr.cjs",
]) {
  assert(existsSync(path.join(root, file)), `Required Lite plugin file is missing: ${file}`);
}

const skill = readFileSync(path.join(root, "skills/spec-to-pr/SKILL.md"), "utf8");
for (const caseName of ["brief", "feature", "figma", "legacy"]) {
  assert(skill.includes(`\`${caseName}\``), `Main skill must describe ${caseName}`);
}
assert(!skill.includes("workflow_"), "Lite skill must not mention legacy workflow tools");
assert(!skill.includes("Run ID"), "Lite skill must not use Run IDs");
assert(
  skill.includes("변경 기능만 고르는 E2E") && skill.includes("영상 한 개"),
  "Feature delivery must require targeted E2E and one user-flow video",
);
assert(
  skill.includes("최대 3회") && skill.includes("세 번째도 92% 미만"),
  "Visual comparison must allow at most three valid attempts",
);
assert(
  skill.includes("openspec.md") &&
    skill.includes("`brief`와 `feature`") &&
    skill.includes("test: on") &&
    skill.includes("서브에이전트 사용"),
  "Brief and feature delivery must prepare OpenSpec documents with optional TDD",
);
assert(
  skill.includes("check-gitlab-mr.cjs") && skill.includes("ready-to-attempt"),
  "GitLab delivery must perform a read-only Draft MR preflight",
);

const template = readFileSync(path.join(root, "skills/spec-to-pr/assets/pr-template.md"), "utf8");
assert(
  template.includes("{{FEATURE_E2E_VIDEO_SECTION}}"),
  "PR template must support the feature E2E video section",
);

console.log("SpecToPR Lite plugin validation passed");

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
