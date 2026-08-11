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
  "skills/spec-to-pr/references/model-routing.md",
  "skills/spec-to-pr/references/openspec.md",
  "skills/spec-to-pr/assets/pr-templates/README.md",
  "skills/spec-to-pr/assets/pr-templates/legacy-migration.md",
  "skills/spec-to-pr/assets/pr-templates/brief-delivery.md",
  "skills/spec-to-pr/assets/pr-templates/feature-flow.md",
  "skills/spec-to-pr/assets/pr-templates/figma-ui.md",
  "skills/spec-to-pr/scripts/compare-images.cjs",
  "skills/spec-to-pr/scripts/legacy-visual-evidence.cjs",
  "skills/spec-to-pr/scripts/legacy-source-inventory.cjs",
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
  skill.includes("OpenSpec은 사용자가 준비해야 하는 전제 조건이 아닙니다") &&
    skill.includes("API·binding·인증·증빙 분석의 실패") &&
    skill.includes("skipped") &&
    skill.includes("targetPaths"),
  "Core delivery must keep OpenSpec optional, record analysis gaps, and bind legacy paths exactly",
);
assert(
  skill.includes("check-gitlab-mr.cjs") && skill.includes("발행 Gap"),
  "GitLab delivery must diagnose publication readiness without blocking safe implementation",
);
assert(
  skill.includes("legacy-visual-evidence.cjs") &&
    skill.includes("legacy-source-inventory.cjs") &&
    skill.includes("모든 사용자 노출 route·대표 상태") &&
    skill.includes("Computer Use") &&
    skill.includes("routeChecks") &&
    skill.includes("targetCodeProfile") &&
    skill.includes("실제 fixture") &&
    skill.includes("API 필요 여부") &&
    skill.includes("진단 실행 여부") &&
    skill.includes("@frontend/ui") &&
    skill.includes("Unicode glyph"),
  "Legacy delivery must prefer Computer Use, verify routes, assets, CSS, runtime UI, and preserve legacy UI without replacements",
);

const templateRoot = path.join(root, "skills/spec-to-pr/assets/pr-templates");
const templates = {
  legacy: readFileSync(path.join(templateRoot, "legacy-migration.md"), "utf8"),
  brief: readFileSync(path.join(templateRoot, "brief-delivery.md"), "utf8"),
  feature: readFileSync(path.join(templateRoot, "feature-flow.md"), "utf8"),
  figma: readFileSync(path.join(templateRoot, "figma-ui.md"), "utf8"),
};
assert(
  templates.legacy.includes("좌우 이미지 비교") &&
    templates.legacy.includes("라우트 동작 확인") &&
    templates.legacy.includes("Vue 3 규격 이관") &&
    templates.legacy.indexOf("GAP_SECTION_IF_ANY") < templates.legacy.indexOf("이관 범위") &&
    templates.legacy.includes("LEGACY_VISUAL_PAIRS_WITH_DIFF_LINKS") &&
    !templates.legacy.includes("## 화면 비교"),
  "Legacy template must show baseline and Vue 3 images side by side without a duplicate matrix",
);
assert(
  templates.brief.includes("요구사항 충족"),
  "Brief template must show requirement fulfillment",
);
assert(
  templates.feature.includes("사용자 흐름 영상"),
  "Feature template must require user-flow video",
);
assert(templates.figma.includes("Figma 상태 매핑"), "Figma template must map Figma states");

console.log("SpecToPR Lite plugin validation passed");

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
