import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const PluginManifestSchema = z.object({
  name: z.literal("spec-to-pr"),
  version: z.string().min(1),
  skills: z.string().min(1),
  mcpServers: z.string().min(1),
});

const MarketplaceSchema = z.object({
  name: z.literal("spec-to-pr"),
  version: z.string().min(1),
  plugins: z
    .array(
      z.object({
        name: z.literal("spec-to-pr"),
        version: z.string().min(1),
        source: z.object({
          source: z.literal("github"),
          repo: z.literal("dhyun2/spec-to-pr"),
          ref: z.literal("spec-to-pr--v0.1.0"),
        }),
      }),
    )
    .length(1),
});

const McpConfigSchema = z.object({
  mcpServers: z.object({
    "spec-to-pr": z.object({
      command: z.literal("node"),
      args: z.array(z.string().min(1)).min(1),
    }),
  }),
});

describe("plugin layout", () => {
  const root = process.cwd();

  it("declares valid plugin manifest paths", () => {
    const manifestPath = path.join(root, ".claude-plugin", "plugin.json");
    const manifest = PluginManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));

    expect(manifest.skills).toBe("./skills/");
    expect(manifest.mcpServers).toBe("./.mcp.json");

    expect(existsSync(path.join(root, manifest.skills))).toBe(true);
    expect(existsSync(path.join(root, manifest.mcpServers))).toBe(true);
  });

  it("declares a marketplace entry for the release tag", () => {
    const manifestPath = path.join(root, ".claude-plugin", "plugin.json");
    const manifest = PluginManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
    const marketplacePath = path.join(root, ".claude-plugin", "marketplace.json");
    const marketplace = MarketplaceSchema.parse(JSON.parse(readFileSync(marketplacePath, "utf8")));
    const plugin = marketplace.plugins[0]!;

    expect(plugin.version).toBe(manifest.version);
    expect(plugin.source.ref).toBe(`${manifest.name}--v${manifest.version}`);
  });

  it("points the MCP server at the production bundle", () => {
    const mcpConfigPath = path.join(root, ".mcp.json");
    const mcpConfig = McpConfigSchema.parse(JSON.parse(readFileSync(mcpConfigPath, "utf8")));

    const server = mcpConfig.mcpServers["spec-to-pr"];

    expect(server.command).toBe("node");
    expect(server.args).toEqual(["${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.js"]);

    expect(existsSync(path.join(root, "dist", "mcp", "server.js"))).toBe(true);
  });

  it("contains the doctor skill", () => {
    expect(existsSync(path.join(root, "skills", "doctor", "SKILL.md"))).toBe(true);
  });
});
