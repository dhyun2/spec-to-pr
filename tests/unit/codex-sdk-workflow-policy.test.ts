import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  buildResumeSpecToPrPrompt,
  buildSpecToPrPrompt,
  validateSpecToPrRunInput,
} from "../../packages/codex-sdk/src/spec-to-pr-runner.js";
import {
  buildCodexReviewAgentInstructions,
  CODEX_REVIEW_AGENT_PROFILES,
  CODEX_WORKFLOW_TOOL_NAMES,
} from "../../packages/codex-sdk/src/workflow-policy.js";

const cliRuns = vi.hoisted(() => ({ inputs: [] as unknown[] }));

vi.mock("../../packages/codex-sdk/src/spec-to-pr-runner.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../packages/codex-sdk/src/spec-to-pr-runner.js")>();
  return {
    ...actual,
    runSpecToPrWithCodex: vi.fn(async (input: unknown) => {
      cliRuns.inputs.push(input);
      return {};
    }),
  };
});

const legacyToolNames = [
  "generate_pr_report",
  "publish_review_request",
  "plan_visual_regression",
  "capture_browser_screenshots",
  "compare_visual_snapshots",
  "evaluate_visual_repair_loop",
];

describe("Codex SDK workflow policy", () => {
  it("uses only the seven workflow facade tools", () => {
    expect(CODEX_WORKFLOW_TOOL_NAMES).toEqual([
      "workflow_info",
      "workflow_start",
      "workflow_advance",
      "workflow_submit",
      "workflow_status",
      "workflow_publish",
      "workflow_archive",
    ]);

    const prompt = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      prompt: "Implement the API endpoint from the brief.",
      openApiPath: "docs/openapi.yaml",
    });

    for (const toolName of CODEX_WORKFLOW_TOOL_NAMES) {
      expect(prompt).toContain(toolName);
    }
    for (const toolName of legacyToolNames) {
      expect(prompt).not.toContain(toolName);
    }
  });

  it("requests only functional review for non-UI code scope", () => {
    const prompt = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      prompt: "Implement a database migration and API endpoint.",
    });

    expect(CODEX_REVIEW_AGENT_PROFILES.map((profile) => profile.name)).toEqual([
      "functional-reviewer",
      "design-reviewer",
    ]);
    expect(prompt).toContain("functional-reviewer");
    expect(prompt).not.toContain("design-reviewer");
  });

  it("adds design review for applicable UI scope", () => {
    const prompt = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      prompt: "Implement the responsive account settings screen.",
      figmaUrl: "https://figma.com/design/example",
    });

    expect(prompt).toContain("functional-reviewer");
    expect(prompt).toContain("design-reviewer");
    expect(buildCodexReviewAgentInstructions({ includeDesignReview: true })).toContain(
      "design-reviewer",
    );
  });

  it("keeps API and UI work in one context and requires mocks before UI completion", () => {
    const prompt = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      prompt: "Implement the API-backed dashboard.",
      figmaUrl: "https://figma.com/design/example",
      openApiPath: "docs/openapi.yaml",
    });

    expect(prompt).toContain("one implementation context");
    expect(prompt).toContain('kind: "api-ready"');
    expect(prompt).toContain("apiArtifacts");
    expect(prompt).toContain("contractTests");
    expect(prompt).toContain("mocks");
    expect(prompt.indexOf("mocks")).toBeLessThan(prompt.indexOf("UI completion"));
  });

  it("passes explicit brief and legacy delivery profiles to workflow_start", () => {
    const brief = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      deliveryMode: "brief",
      changeKind: "feature",
      publication: "draft",
      briefPath: "docs/brief.md",
    });
    const legacy = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      deliveryMode: "legacy",
      changeKind: "fix",
      publication: "draft",
      prompt: "Fix only the affected parser behavior.",
    });

    expect(brief).toContain('mode: "brief"');
    expect(brief).toContain('briefPath: "docs/brief.md"');
    expect(brief).not.toContain("design-reviewer");
    expect(brief).toContain("workflow_status snapshot");
    expect(legacy).toContain('mode: "legacy"');
    expect(legacy).toContain("focused baseline");
  });

  it("normalizes legacy and plural sources into deduplicated workflow_start arrays", () => {
    const prompt = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      deliveryMode: "feature",
      prompt: "Implement checkout from the supplied brief.",
      briefPath: "docs/checkout.md",
      docsPath: "docs/business-rules.md",
      docsPaths: ["docs/./business-rules.md", "docs/error-cases.md"],
      openApiPath: "docs/openapi.yaml",
      openApiPaths: ["docs/openapi.yaml", "docs/admin-openapi.yaml"],
      guidancePaths: ["AGENTS.md", "AGENTS.md", "docs/architecture/ARCHITECTURE.md"],
      skillHints: ["react-best-practices", "react-best-practices", "api-generator"],
    });

    expect(prompt).toContain('mode: "feature"');
    expect(prompt).toContain('briefPath: "docs/checkout.md"');
    expect(prompt).toContain('docsPaths: ["docs/business-rules.md","docs/error-cases.md"]');
    expect(prompt).toContain('openApiPaths: ["docs/openapi.yaml","docs/admin-openapi.yaml"]');
    expect(prompt).toContain('guidancePaths: ["AGENTS.md","docs/architecture/ARCHITECTURE.md"]');
    expect(prompt).toContain('skillHints: ["react-best-practices","api-generator"]');
    expect(prompt.match(/^- Docs: docs\/business-rules\.md$/gm)).toHaveLength(1);
    expect(prompt.match(/^- OpenAPI: docs\/openapi\.yaml$/gm)).toHaveLength(1);
    expect(prompt).toContain("- Project guidance: AGENTS.md");
    expect(prompt).toContain("- Project guidance: docs/architecture/ARCHITECTURE.md");
    expect(prompt).toContain("- Optional skill hint: react-best-practices");
    expect(prompt).toContain("- Optional skill hint: api-generator");
    expect(prompt).toContain("Feature mode:");
    expect(prompt).not.toContain("Brief mode:");
  });

  it("treats skill hints as optional availability checks and states guidance precedence", () => {
    const prompt = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      prompt: "Implement the requested API-backed UI.",
      guidancePaths: ["AGENTS.md"],
      skillHints: ["react-best-practices", "not-installed"],
    });

    expect(prompt).toContain("only when it is installed and applicable");
    expect(prompt).toContain("Missing optional skills do not block the Run");
    expect(prompt).toContain(
      "current user request > explicit project guidance > automatically discovered project guidance > applicable installed skills > SpecToPR defaults",
    );
  });

  it("matches runtime deduplication and twenty-item input bounds", () => {
    const twentyPaths = Array.from({ length: 20 }, (_, index) => `docs/source-${index}.md`);
    const twentySkills = Array.from({ length: 20 }, (_, index) => `skill-${index}`);

    expect(() =>
      validateSpecToPrRunInput({
        workingDirectory: "/tmp/project",
        docsPath: twentyPaths[0]!,
        docsPaths: ["docs/./source-0.md", ...twentyPaths.slice(1)],
        guidancePaths: twentyPaths,
        skillHints: twentySkills,
      }),
    ).not.toThrow();
    expect(() =>
      validateSpecToPrRunInput({
        workingDirectory: "/tmp/project",
        docsPath: "docs/legacy.md",
        docsPaths: twentyPaths,
      }),
    ).toThrow(/20 distinct paths/);
    expect(() =>
      validateSpecToPrRunInput({
        workingDirectory: "/tmp/project",
        guidancePaths: [...twentyPaths, "docs/overflow.md"],
      }),
    ).toThrow(/guidancePaths.*20/i);
    expect(() =>
      validateSpecToPrRunInput({
        workingDirectory: "/tmp/project",
        skillHints: [...twentySkills, "skill-overflow"],
      }),
    ).toThrow(/skillHints.*20/i);
  });

  it("preserves every repeated CLI source and keeps an explicit feature mode", async () => {
    const originalArgv = process.argv;
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    cliRuns.inputs.length = 0;
    process.argv = [
      "node",
      "spec-to-pr-codex",
      "--cwd",
      "/tmp/project",
      "--mode",
      "feature",
      "--prompt",
      "Implement checkout",
      "--brief",
      "docs/checkout.md",
      "--docs",
      "docs/business-rules.md",
      "--docs",
      "docs/error-cases.md",
      "--openapi",
      "docs/openapi.yaml",
      "--openapi",
      "docs/admin-openapi.yaml",
      "--guidance",
      "AGENTS.md",
      "--guidance",
      "docs/architecture/ARCHITECTURE.md",
      "--skill",
      "react-best-practices",
      "--skill",
      "api-generator",
    ];

    try {
      await import("../../packages/codex-sdk/src/cli.js");
    } finally {
      process.argv = originalArgv;
      consoleLog.mockRestore();
    }

    expect(cliRuns.inputs).toEqual([
      expect.objectContaining({
        workingDirectory: "/tmp/project",
        deliveryMode: "feature",
        briefPath: "docs/checkout.md",
        docsPaths: ["docs/business-rules.md", "docs/error-cases.md"],
        openApiPaths: ["docs/openapi.yaml", "docs/admin-openapi.yaml"],
        guidancePaths: ["AGENTS.md", "docs/architecture/ARCHITECTURE.md"],
        skillHints: ["react-best-practices", "api-generator"],
      }),
    ]);
  });

  it("does not preactivate UI validation for a backend-only brief", () => {
    const prompt = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      deliveryMode: "brief",
      briefPath: "docs/backend-brief.md",
      prompt: "Implement a database migration and API endpoint.",
    });

    expect(prompt).toContain("functional-reviewer");
    expect(prompt).not.toContain("design-reviewer");
  });

  it("rejects incomplete mode-specific SDK inputs before starting Codex", () => {
    expect(() =>
      buildSpecToPrPrompt({
        workingDirectory: "/tmp/project",
        deliveryMode: "brief",
      }),
    ).toThrow(/briefPath/);
    expect(() =>
      buildSpecToPrPrompt({
        workingDirectory: "/tmp/project",
        deliveryMode: "figma",
      }),
    ).toThrow(/figmaUrl/);
    expect(() =>
      buildSpecToPrPrompt({
        workingDirectory: "/tmp/project",
        deliveryMode: "legacy",
      }),
    ).toThrow(/concrete prompt/);
    expect(() =>
      buildSpecToPrPrompt({
        workingDirectory: "/tmp/project",
        deliveryMode: "feature",
      }),
    ).toThrow(/concrete prompt/);
  });

  it("limits feature validation to one targeted E2E and one video", () => {
    const prompt = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      deliveryMode: "feature",
      changeKind: "feature",
      publication: "draft",
      prompt: "Add user-facing checkout.",
    });

    expect(prompt).toContain('mode: "feature"');
    expect(prompt).toContain("exactly one .webm or .mp4");
    expect(prompt).toContain("Never run the full-project E2E suite by default");
    expect(prompt).toContain("featureEvidence");
    expect(prompt).toContain("positive testCount");
    expect(prompt).toContain("non-target codex/<short-slug>");
    expect(prompt).toContain("commit all intended changes");
  });

  it("uses connected Figma intake and does not publish by default for Figma-only delivery", () => {
    const prompt = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      deliveryMode: "figma",
      changeKind: "design",
      figmaUrl: "https://figma.com/design/example",
    });

    expect(prompt).toContain('mode: "figma"');
    expect(prompt).toContain('publication: "none"');
    expect(prompt).toContain("connected Figma capability");
    expect(prompt).toContain("figma-bundle");
    expect(prompt).toContain("before contracts");
  });

  it("resumes the durable run without starting intake again", () => {
    const prompt = buildResumeSpecToPrPrompt();

    expect(prompt).toContain("workflow_status");
    expect(prompt).toContain("existing Run");
    expect(prompt).toContain("one external action group");
    expect(prompt).not.toContain("workflow_start");
    expect(prompt).not.toContain("workflow_info");
    expect(() =>
      validateSpecToPrRunInput({
        workingDirectory: "/tmp/project",
        resumeThreadId: "thread-existing",
        deliveryMode: "feature",
      }),
    ).not.toThrow();
  });

  it("keeps calibration history outside the target repository", () => {
    expect(() =>
      validateSpecToPrRunInput({
        workingDirectory: "/tmp/project",
        usageHistoryPath: "/tmp/project/.spec-to-pr/usage.jsonl",
      }),
    ).toThrow(/outside the target repository/i);
    expect(() =>
      validateSpecToPrRunInput({
        workingDirectory: "/tmp/project",
        usageHistoryPath: "/tmp/project/.spec-to-pr/usage.jsonl",
        usageCalibration: false,
      }),
    ).not.toThrow();
  });

  it("uses the enclosing git worktree root when the SDK runs from a nested package", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-history-git-root-"));
    const repository = path.join(root, "repository");
    const nestedPackage = path.join(repository, "packages", "app");

    try {
      await mkdir(path.join(repository, ".git"), { recursive: true });
      await mkdir(nestedPackage, { recursive: true });

      expect(() =>
        validateSpecToPrRunInput({
          workingDirectory: nestedPackage,
          prompt: "Implement a feature",
          usageHistoryPath: path.join(repository, ".history", "usage.jsonl"),
        }),
      ).toThrow("usageHistoryPath must stay outside the target repository");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an outside history path whose symlink resolves inside the repository", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-history-path-"));
    const repository = path.join(root, "repository");
    const internalHistoryDirectory = path.join(repository, ".history");
    const externalDirectory = path.join(root, "external");
    const externalLink = path.join(externalDirectory, "history-link");

    try {
      await mkdir(internalHistoryDirectory, { recursive: true });
      await mkdir(externalDirectory, { recursive: true });
      await symlink(internalHistoryDirectory, externalLink, "dir");

      expect(() =>
        validateSpecToPrRunInput({
          workingDirectory: repository,
          prompt: "Implement a feature",
          usageHistoryPath: path.join(externalLink, "usage.jsonl"),
        }),
      ).toThrow("usageHistoryPath must stay outside the target repository");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an outside history file hard-linked to a repository file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-history-hardlink-"));
    const repository = path.join(root, "repository");
    const internalHistoryFile = path.join(repository, "tracked-history.jsonl");
    const externalDirectory = path.join(root, "external");
    const externalHistoryFile = path.join(externalDirectory, "usage.jsonl");

    try {
      await mkdir(repository, { recursive: true });
      await mkdir(externalDirectory, { recursive: true });
      await writeFile(internalHistoryFile, "", "utf8");
      await link(internalHistoryFile, externalHistoryFile);

      expect(() =>
        validateSpecToPrRunInput({
          workingDirectory: repository,
          prompt: "Implement a feature",
          usageHistoryPath: externalHistoryFile,
        }),
      ).toThrow("usageHistoryPath must not be a hard-linked file");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
