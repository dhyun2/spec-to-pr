import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import { z } from "zod";

const root = process.cwd();
const packageJson = z
  .object({
    version: z.string().min(1),
  })
  .parse(readJson(path.join(root, "package.json")));

const CodexPluginManifestSchema = z
  .object({
    name: z.literal("spec-to-pr"),
    version: z.literal(packageJson.version),
    description: z.string().min(1),
    author: z.object({
      name: z.string().min(1),
      email: z.string().email().optional(),
      url: z.string().url().optional(),
    }),
    license: z.literal("MIT"),
    skills: z.literal("./skills/"),
    mcpServers: z.object({
      "spec-to-pr": z.object({
        command: z.literal("node"),
        args: z.array(z.string().min(1)).min(1),
      }),
    }),
    interface: z.object({
      displayName: z.literal("Spec to PR"),
      shortDescription: z.string().min(1),
      longDescription: z.string().min(1),
      developerName: z.string().min(1),
      category: z.string().min(1),
      capabilities: z.array(z.string().min(1)).min(1),
      defaultPrompt: z.array(z.string().min(1)).min(1).max(3),
    }),
  })
  .passthrough();

const CodexMarketplaceSchema = z.object({
  name: z.literal("spec-to-pr-local"),
  interface: z.object({
    displayName: z.literal("Spec to PR Local"),
  }),
  plugins: z
    .array(
      z.object({
        name: z.literal("spec-to-pr"),
        source: z.object({
          source: z.literal("local"),
          path: z.literal("./"),
        }),
        policy: z.object({
          installation: z.literal("AVAILABLE"),
          authentication: z.literal("ON_INSTALL"),
        }),
        category: z.literal("Developer Tools"),
      }),
    )
    .length(1),
});

const manifest = CodexPluginManifestSchema.parse(
  readJson(path.join(root, ".codex-plugin", "plugin.json")),
);
CodexMarketplaceSchema.parse(readJson(path.join(root, ".agents", "plugins", "marketplace.json")));

const mcpArgs = manifest.mcpServers["spec-to-pr"].args;
for (const arg of mcpArgs) {
  if (arg.includes("dist/mcp/server.js") && !existsSync(path.join(root, arg))) {
    throw new Error(`Codex MCP server bundle is missing: ${arg}`);
  }
}

for (const skillName of readdirSync(path.join(root, "skills"))) {
  const skillPath = path.join(root, "skills", skillName, "SKILL.md");
  if (!existsSync(skillPath)) {
    continue;
  }
  const frontmatter = readSkillFrontmatter(skillPath);
  if (frontmatter["disable-model-invocation"] === true) {
    throw new Error(`Codex skill ${skillName} must not disable model invocation`);
  }
  if (typeof frontmatter.name !== "string") {
    throw new Error(`Codex skill ${skillName} is missing name`);
  }
  if (typeof frontmatter.description !== "string") {
    throw new Error(`Codex skill ${skillName} is missing description`);
  }
  const allowedTools = frontmatter["allowed-tools"];
  if (typeof allowedTools === "string" && allowedTools.includes("mcp__spec-to-pr__")) {
    for (const tool of allowedTools
      .split(/\s+/)
      .filter((token) => token.startsWith("mcp__spec-to-pr__"))) {
      const codexTool = tool.replace("mcp__spec-to-pr__", "mcp__spec_to_pr__");
      if (!allowedTools.includes(codexTool)) {
        throw new Error(`Codex skill ${skillName} is missing Codex MCP alias ${codexTool}`);
      }
    }
  }
  const contents = readFileSync(skillPath, "utf8");
  if (contents.includes("mcp__spec-to-pr__") && !contents.includes("mcp__spec_to_pr__")) {
    throw new Error(`Codex skill ${skillName} references Claude MCP tools without Codex aliases`);
  }
}

console.log("Codex plugin validation passed");

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

function readSkillFrontmatter(filePath: string): Record<string, unknown> {
  const contents = readFileSync(filePath, "utf8");
  const match = /^---\n([\s\S]*?)\n---/.exec(contents);

  if (match === null) {
    throw new Error(`Skill frontmatter missing: ${filePath}`);
  }

  const parsed = parseDocument(match[1] ?? "").toJS();
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Skill frontmatter must be an object: ${filePath}`);
  }

  return parsed as Record<string, unknown>;
}
