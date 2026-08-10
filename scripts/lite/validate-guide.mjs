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
  "SpecToPR",
  "네 가지 케이스",
  "화면 비교",
  "Gap",
  "사용자 흐름 영상 한 개",
  "최대 3회",
  "OpenSpec",
  "test: on",
  "test: off",
  "TDD",
  "GitLab MR 사전 진단",
  "legacy-visual-evidence",
  "Computer Use",
  "보존 이관",
  "NOT VERIFIED",
  "targetPaths",
  "brief",
  "feature",
  "figma",
  "legacy",
]) {
  if (!guide.includes(requiredText)) {
    throw new Error(`Guide must include: ${requiredText}`);
  }
}

for (const retiredText of ["workflow_start", "workflow_advance", "실행 상태를 보존하는 단계"]) {
  if (guide.includes(retiredText)) {
    throw new Error(`Guide must not include retired workflow content: ${retiredText}`);
  }
}

const templateRoot = path.join(root, "skills/spec-to-pr/assets/pr-templates");
for (const template of [
  "legacy-migration.md",
  "brief-delivery.md",
  "feature-flow.md",
  "figma-ui.md",
]) {
  if (!existsSync(path.join(templateRoot, template))) {
    throw new Error(`Guide must ship case-specific PR template: ${template}`);
  }
}

console.log("Korean Lite guide validation passed");

function collectTextFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? collectTextFiles(entryPath) : [entryPath];
  });
}
