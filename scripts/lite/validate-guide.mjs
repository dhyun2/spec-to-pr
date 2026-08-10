import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const requiredFiles = [
  "website/docusaurus.config.ts",
  "website/docs/intro.md",
  "website/docs/getting-started/installation.mdx",
  "website/docs/getting-started/gitlab.md",
  "website/docs/getting-started/quickstart.md",
  "website/docs/usage/index.mdx",
  "website/docs/usage/brief.mdx",
  "website/docs/usage/feature.mdx",
  "website/docs/usage/figma.mdx",
  "website/docs/usage/legacy.mdx",
  "website/docs/concepts/pipeline.md",
  "website/docs/concepts/visual-verification.mdx",
  "website/docs/concepts/comparison.mdx",
  "website/docs/concepts/reviews.mdx",
  "website/docs/troubleshooting.md",
];

for (const relativePath of requiredFiles) {
  if (!existsSync(path.join(root, relativePath))) {
    throw new Error(`Guide file is missing: ${relativePath}`);
  }
}

const guideSources = collectTextFiles(path.join(root, "website/docs"));
const guide = guideSources.map((file) => readFileSync(file, "utf8")).join("\n");
for (const requiredText of [
  "SpecToPR Lite",
  "네 가지 케이스",
  "화면 일치율",
  "개발한 기능",
  "사용한 API",
  "Gap",
  "E2E 영상",
  "사용자 흐름 영상 한 개",
  "최대 3회",
  "3/3",
  "OpenSpec",
  "OpenSpec 문서",
  "test: on",
  "test: off",
  "TDD",
  "GitLab MR 사전 진단",
  "ready-to-attempt",
  "brief",
  "feature",
  "figma",
  "legacy",
]) {
  if (!guide.includes(requiredText)) {
    throw new Error(`Guide must include: ${requiredText}`);
  }
}

for (const retiredText of [
  "workflow_start",
  "workflow_advance",
  "functional-reviewer",
  "design-reviewer",
  "실행 상태를 보존하는 단계",
]) {
  if (guide.includes(retiredText)) {
    throw new Error(`Guide must not include retired workflow content: ${retiredText}`);
  }
}

const prExampleCount = (guide.match(/^## PR 예시$/gmu) ?? []).length;
if (prExampleCount < 4) {
  throw new Error("Guide must include a case-specific PR example for all four cases");
}

console.log("Korean Lite guide validation passed");

function collectTextFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? collectTextFiles(entryPath) : [entryPath];
  });
}
