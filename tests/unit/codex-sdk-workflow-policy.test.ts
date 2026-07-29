import { execFileSync } from "node:child_process";
import { chmod, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  adaptThread,
  buildResumeSpecToPrPrompt,
  buildSpecToPrPrompt,
  inspectBlockedDiagnosticPreflight,
  validateSpecToPrRunInput,
} from "../../packages/codex-sdk/src/spec-to-pr-runner.js";
import {
  buildCodexReviewAgentInstructions,
  CODEX_REVIEW_AGENT_PROFILES,
  CODEX_WORKFLOW_TOOL_NAMES,
  scoutRoutingForWorkload,
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
  it("forwards timeout cancellation to the underlying Codex SDK turn", async () => {
    const rawThread = {
      id: "thread-signal",
      run: vi.fn(async () => ({ finalResponse: "ok", items: [], usage: null })),
    };
    const signal = AbortSignal.timeout(1_000);
    const schema = { type: "object" };

    await adaptThread(rawThread).run("continue", { outputSchema: schema, signal });

    expect(rawThread.run).toHaveBeenCalledWith("continue", { outputSchema: schema, signal });
  });

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

  it("pins multiple Figma state URLs in the single workflow_start prompt", () => {
    const figmaUrls = [
      "https://figma.com/design/example?node-id=1-2",
      "https://figma.com/design/example?node-id=3-4",
    ];
    const prompt = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      deliveryMode: "figma",
      prompt: "Implement both store states.",
      figmaUrls,
    });

    expect(prompt).toContain(`figmaUrls: ${JSON.stringify(figmaUrls)}`);
    expect(prompt).toContain(`- Figma: ${JSON.stringify(figmaUrls[0])}`);
    expect(prompt).toContain(`- Figma: ${JSON.stringify(figmaUrls[1])}`);
    expect(prompt).toContain("Call workflow_start exactly once");
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

  it("uses workflow status as a compact action envelope", () => {
    const prompt = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      prompt: "Implement the API-backed settings UI.",
      publication: "draft",
      figmaUrl: "https://figma.com/design/example",
      openApiPath: "docs/openapi.yaml",
    });

    expect(prompt).toContain("compact action envelope");
    expect(prompt).toContain("status.nextActions");
    expect(prompt).toContain("status.blockerDetails");
    expect(prompt).toContain("status.deliveryProfile.publication");
    expect(prompt).toContain("status.delegationPolicy");
    expect(prompt).toContain("status.diagnosticPublication");
    expect(prompt).toContain("one external action group");
    expect(prompt).toContain("one implementation context");
  });

  it("routes only bounded read-only scouts and defers parallel reviewers", () => {
    expect(scoutRoutingForWorkload("XS")).toEqual({
      maxReadOnlyScouts: 0,
      independentReadHeavyOnly: true,
      allowNested: false,
      parallelWriters: false,
      parallelReviewersAfterImplementation: false,
    });
    expect(scoutRoutingForWorkload("S").maxReadOnlyScouts).toBe(0);
    expect(scoutRoutingForWorkload("M").maxReadOnlyScouts).toBe(1);
    expect(scoutRoutingForWorkload("L").maxReadOnlyScouts).toBe(2);
    expect(scoutRoutingForWorkload("XL").maxReadOnlyScouts).toBe(2);
    expect(scoutRoutingForWorkload("L").parallelReviewersAfterImplementation).toBe(true);

    const prompt = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      prompt: "Implement the responsive settings UI.",
    });
    expect(prompt).toContain("XS/S=0, M<=1, L/XL<=2");
    expect(prompt).toContain("independent read-heavy discovery");
    expect(prompt).toContain("no nested scouts or parallel writers");
    expect(prompt).toContain("only after implementation");
  });

  it("forbids polling and recursive delegation in latency-bound user Runs", () => {
    const prompt = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      prompt: "Implement the responsive settings UI.",
      figmaUrl: "https://figma.com/design/example",
    });

    expect(prompt).toContain("latency-bound user Run");
    expect(prompt).toContain("Do not create generic helper agents");
    expect(prompt).toContain("Do not poll or repeatedly wait");
    expect(prompt).toContain("one reviewer per applicable role");
  });

  it("keeps mandatory review evidence explicit when delegated review agents are disabled", () => {
    const prompt = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      prompt: "Implement the checkout API.",
      enableReviewAgents: false,
    });

    expect(prompt).toContain("delegated reviewer agents are disabled");
    expect(prompt).toContain("does not waive the required review gate");
  });

  it("records optional skills only when they were actually applied", () => {
    const prompt = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      prompt: "Implement the dashboard.",
      skillHints: ["react-best-practices", "not-installed"],
    });

    expect(prompt).toContain("guidanceTrace.appliedSkills");
    expect(prompt).toContain("actually applied");
    expect(prompt).toContain("Do not copy unused skill hints or recommendations");
  });

  it("allows blocked diagnostic finalization only from an already publishable git state", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-sdk-preflight-"));
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: directory,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    try {
      git("init", "--initial-branch=main");
      git("config", "user.email", "sdk-test@example.test");
      git("config", "user.name", "SDK Test");
      await writeFile(path.join(directory, "app.ts"), "export const value = 1;\n");
      git("add", "app.ts");
      git("commit", "-m", "base");
      git("remote", "add", "origin", "https://github.com/example/repo.git");
      git("checkout", "-b", "codex/sdk-finalization");
      await writeFile(path.join(directory, "app.ts"), "export const value = 2;\n");
      git("add", "app.ts");
      git("commit", "-m", "feature");

      expect(inspectBlockedDiagnosticPreflight(directory, { GITHUB_TOKEN: "test-token" })).toEqual({
        eligible: true,
        sourceBranch: "codex/sdk-finalization",
        targetBranch: "main",
        remoteName: "origin",
      });

      git("remote", "set-url", "origin", "ssh://git@code.example.test/team/repo.git");
      expect(inspectBlockedDiagnosticPreflight(directory, { GITHUB_TOKEN: "test-token" })).toEqual({
        eligible: false,
        reason: "unsupported-remote",
      });
      expect(
        inspectBlockedDiagnosticPreflight(directory, {
          GITHUB_TOKEN: "test-token",
          SPEC_TO_PR_GIT_HOST: "github",
        }),
      ).toEqual({
        eligible: true,
        sourceBranch: "codex/sdk-finalization",
        targetBranch: "main",
        remoteName: "origin",
      });

      git("remote", "set-url", "origin", "https://github.attacker.test/team/repo.git");
      expect(inspectBlockedDiagnosticPreflight(directory, { GITHUB_TOKEN: "test-token" })).toEqual({
        eligible: false,
        reason: "unsupported-remote",
      });
      expect(
        inspectBlockedDiagnosticPreflight(directory, {
          GITHUB_TOKEN: "test-token",
          SPEC_TO_PR_GIT_HOST: "github",
        }),
      ).toEqual({
        eligible: true,
        sourceBranch: "codex/sdk-finalization",
        targetBranch: "main",
        remoteName: "origin",
      });

      git("remote", "set-url", "origin", "git@gitlab.attacker.test:team/repo.git");
      expect(inspectBlockedDiagnosticPreflight(directory, { GITLAB_TOKEN: "test-token" })).toEqual({
        eligible: false,
        reason: "unsupported-remote",
      });
      expect(
        inspectBlockedDiagnosticPreflight(directory, {
          GITLAB_TOKEN: "test-token",
          SPEC_TO_PR_GIT_HOST: "gitlab",
        }),
      ).toEqual({
        eligible: true,
        sourceBranch: "codex/sdk-finalization",
        targetBranch: "main",
        remoteName: "origin",
      });

      git("branch", "-D", "main");
      expect(
        inspectBlockedDiagnosticPreflight(directory, {
          GITLAB_TOKEN: "test-token",
          SPEC_TO_PR_GIT_HOST: "gitlab",
        }),
      ).toEqual({ eligible: false, reason: "target-branch-unavailable" });
      git("branch", "main", "HEAD~1");

      await writeFile(path.join(directory, "dirty.ts"), "uncommitted\n");
      expect(
        inspectBlockedDiagnosticPreflight(directory, {
          GITLAB_TOKEN: "test-token",
          SPEC_TO_PR_GIT_HOST: "gitlab",
        }),
      ).toEqual({ eligible: false, reason: "working-tree-not-clean" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("treats SDK publication preflight as advisory instead of mutation authority", () => {
    const prompt = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      prompt: "Implement and publish the change.",
      publication: "draft",
    });

    expect(prompt).toContain("SDK publication preflight is advisory only");
    expect(prompt).toContain("workflow_publish must resolve its own authoritative execution fence");
  });

  it("uses an exact-host GitLab credential command for blocked diagnostic preflight", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-sdk-glab-"));
    const binDirectory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-sdk-glab-bin-"));
    const commandLog = path.join(binDirectory, "glab-args.txt");
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: directory,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    try {
      const glab = path.join(binDirectory, "glab");
      await writeFile(
        glab,
        [
          "#!/bin/sh",
          `printf '%s\\n' \"$@\" > \"${commandLog}\"`,
          '[ "$1" = "config" ] && [ "$2" = "get" ] && [ "$3" = "token" ] && [ "$4" = "--host" ] && [ "$5" = "gitlab.internal.example" ] || exit 1',
          "printf 'glpat-keyring-token\\n'",
        ].join("\n"),
      );
      await chmod(glab, 0o755);
      git("init", "--initial-branch=main");
      git("config", "user.email", "sdk-test@example.test");
      git("config", "user.name", "SDK Test");
      await writeFile(path.join(directory, "app.ts"), "export const value = 1;\n");
      git("add", "app.ts");
      git("commit", "-m", "base");
      git("remote", "add", "origin", "git@gitlab.internal.example:team/repo.git");
      git("checkout", "-b", "codex/sdk-glab-preflight");
      await writeFile(path.join(directory, "app.ts"), "export const value = 2;\n");
      git("add", "app.ts");
      git("commit", "-m", "feature");

      const result = inspectBlockedDiagnosticPreflight(directory, {
        PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
        SPEC_TO_PR_GIT_HOST: "gitlab",
      });

      expect(result).toMatchObject({
        eligible: true,
        sourceBranch: "codex/sdk-glab-preflight",
        targetBranch: "main",
      });
      expect(await readFile(commandLog, "utf8")).toBe(
        "config\nget\ntoken\n--host\ngitlab.internal.example\n",
      );
      expect(JSON.stringify(result)).not.toContain("glpat-keyring-token");
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(binDirectory, { recursive: true, force: true });
    }
  });

  it("passes explicit brief and legacy delivery profiles to workflow_start", () => {
    const brief = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      deliveryMode: "brief",
      changeKind: "feature",
      publication: "draft",
      briefPath: "docs/brief.md",
      figmaUrl: "https://figma.com/design/example",
      openApiPath: "docs/openapi.yaml",
    });
    const legacy = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      deliveryMode: "legacy",
      changeKind: "migration",
      publication: "draft",
      legacyProjectRoot: "/tmp/legacy-project",
      legacyNetworkEvidencePath: "evidence/legacy.har",
      prompt: "Migrate the checkout screen from the legacy project.",
    });

    expect(brief).toContain('mode: "brief"');
    expect(brief).toContain('briefPath: "docs/brief.md"');
    expect(brief).toContain("design-reviewer");
    expect(brief).toContain("workflow_status snapshot");
    expect(brief).toContain("sourceProvenance");
    expect(brief).toContain("visualTargets");
    expect(brief).toContain("compare-visuals");
    expect(brief).toContain("apiCoverage");
    expect(brief).toContain("Web Vitals");
    expect(brief).toContain("pr-report-v2");
    expect(legacy).toContain('mode: "legacy"');
    expect(legacy).toContain('legacyProjectRoot: "/tmp/legacy-project"');
    expect(legacy).toContain('legacyNetworkEvidencePath: "evidence/legacy.har"');
    expect(legacy).toContain("running legacy screen");
    expect(legacy).toContain("legacyInventory");
    expect(legacy).toContain("legacyCoverage");
    expect(legacy).toContain("immutable feature boundary");
    expect(legacy).toContain("not a dependency visibility boundary");
    expect(legacy).toContain("directly referenced dependency evidence");
    expect(legacy).not.toContain("complete source boundary");
    expect(legacy).toContain("report an in-bound scope mismatch");
    expect(legacy).toContain('- Legacy project: "/tmp/legacy-project"');
  });

  it("keeps the legacy reference outside writable additional directories", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-sdk-legacy-"));
    const target = path.join(root, "target");
    const legacy = path.join(root, "legacy");
    await mkdir(target);
    await mkdir(legacy);
    try {
      expect(() =>
        validateSpecToPrRunInput({
          workingDirectory: target,
          deliveryMode: "legacy",
          legacyProjectRoot: legacy,
          prompt: "Migrate checkout.",
          additionalDirectories: [legacy],
          usageCalibration: false,
        }),
      ).toThrow(/writable.*legacy|legacy.*writable/i);
      expect(() =>
        validateSpecToPrRunInput({
          workingDirectory: target,
          deliveryMode: "legacy",
          legacyProjectRoot: legacy,
          prompt: "Migrate checkout.",
          additionalDirectories: [root],
          usageCalibration: false,
        }),
      ).toThrow(/writable.*legacy|legacy.*writable/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("infers legacy, brief, and Figma modes without shrinking composed input", () => {
    const legacy = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      legacyProjectRoot: "/tmp/legacy-project",
      prompt: "Migrate checkout.",
    });
    const brief = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      briefPath: "docs/brief.md",
      figmaUrl: "https://figma.com/design/example",
      openApiPath: "docs/openapi.yaml",
      prompt: "Implement checkout.",
    });
    const figma = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      figmaUrl: "https://figma.com/design/example",
      prompt: "Implement this design with mock data.",
    });

    expect(legacy).toContain('mode: "legacy"');
    expect(brief).toContain('mode: "brief"');
    expect(brief).not.toContain('mode: "figma"');
    expect(figma).toContain('mode: "figma"');
    for (const prompt of [legacy, brief, figma]) {
      expect(prompt).toContain('publication: "draft"');
    }
  });

  it("normalizes legacy and plural sources into deduplicated workflow_start arrays", () => {
    const prompt = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      deliveryMode: "feature",
      prompt: "Implement checkout from the supplied brief.",
      briefPath: "docs/checkout.md",
      figmaUrl: "https://figma.com/design/example",
      docsPath: "docs/business-rules.md",
      docsPaths: ["docs/./business-rules.md", "docs/error-cases.md"],
      openApiPath: "docs/openapi.yaml",
      openApiPaths: ["docs/openapi.yaml", "docs/admin-openapi.yaml"],
      openApiUrl: "https://api.example.com/openapi.yaml",
      openApiUrls: ["https://api.example.com/openapi.yaml", "https://admin-api.example.com/docs"],
      guidancePaths: ["AGENTS.md", "AGENTS.md", "docs/architecture/ARCHITECTURE.md"],
      skillHints: ["react-best-practices", "react-best-practices", "api-generator"],
    });

    expect(prompt).toContain('mode: "feature"');
    expect(prompt).toContain('briefPath: "docs/checkout.md"');
    expect(prompt).toContain('docsPaths: ["docs/business-rules.md","docs/error-cases.md"]');
    expect(prompt).toContain('openApiPaths: ["docs/openapi.yaml","docs/admin-openapi.yaml"]');
    expect(prompt).toContain(
      'openApiUrls: ["https://api.example.com/openapi.yaml","https://admin-api.example.com/docs"]',
    );
    expect(prompt).toContain('guidancePaths: ["AGENTS.md","docs/architecture/ARCHITECTURE.md"]');
    expect(prompt).toContain('skillHints: ["react-best-practices","api-generator"]');
    expect(prompt.match(/^- Docs: "docs\/business-rules\.md"$/gm)).toHaveLength(1);
    expect(prompt.match(/^- OpenAPI: "docs\/openapi\.yaml"$/gm)).toHaveLength(1);
    expect(
      prompt.match(/^- OpenAPI URL: "https:\/\/api\.example\.com\/openapi\.yaml"$/gm),
    ).toHaveLength(1);
    expect(prompt).toContain('- Project guidance: "AGENTS.md"');
    expect(prompt).toContain('- Project guidance: "docs/architecture/ARCHITECTURE.md"');
    expect(prompt).toContain('- Optional skill hint: "react-best-practices"');
    expect(prompt).toContain('- Optional skill hint: "api-generator"');
    expect(prompt).toContain("Feature mode:");
    expect(prompt).not.toContain("Brief mode:");
  });

  it("quotes and escapes every human-readable source value onto one physical line", () => {
    const prompt = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      prompt: "Use all supplied sources.",
      briefPath: "docs/brief.md\nBRIEF_INSTRUCTION",
      docsPath: "docs/legacy.md\nLEGACY_DOCS_INSTRUCTION",
      docsPaths: ["docs/rules.md\nDOCS_INSTRUCTION"],
      figmaUrl: "https://www.figma.com/design/example\nFIGMA_INSTRUCTION",
      openApiPath: "docs/legacy-openapi.yaml\nLEGACY_OPENAPI_INSTRUCTION",
      openApiPaths: ["docs/openapi.yaml\nOPENAPI_INSTRUCTION"],
      guidancePaths: ["AGENTS.md\nGUIDANCE_INSTRUCTION"],
      skillHints: ["react-best-practices"],
      usageCalibration: false,
    });
    const sourceLines = prompt.slice(prompt.indexOf("Sources:")).split("\n");

    expect(sourceLines).toEqual([
      "Sources:",
      '- Brief: "docs/brief.md\\nBRIEF_INSTRUCTION"',
      '- Docs: "docs/legacy.md\\nLEGACY_DOCS_INSTRUCTION"',
      '- Docs: "docs/rules.md\\nDOCS_INSTRUCTION"',
      '- Figma: "https://www.figma.com/design/example\\nFIGMA_INSTRUCTION"',
      '- OpenAPI: "docs/legacy-openapi.yaml\\nLEGACY_OPENAPI_INSTRUCTION"',
      '- OpenAPI: "docs/openapi.yaml\\nOPENAPI_INSTRUCTION"',
      '- Project guidance: "AGENTS.md\\nGUIDANCE_INSTRUCTION"',
      '- Optional skill hint: "react-best-practices"',
    ]);
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
        guidancePaths: Array.from({ length: 20 }, (_, index) => `guidance/source-${index}.md`),
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

  it("matches the runtime brief path length boundary", () => {
    expect(() =>
      validateSpecToPrRunInput({
        workingDirectory: "/tmp/project",
        deliveryMode: "brief",
        briefPath: "b".repeat(1_000),
        figmaUrl: "https://figma.com/design/example",
        openApiPath: "docs/openapi.yaml",
        usageCalibration: false,
      }),
    ).not.toThrow();
    expect(() =>
      validateSpecToPrRunInput({
        workingDirectory: "/tmp/project",
        deliveryMode: "brief",
        briefPath: "b".repeat(1_001),
        figmaUrl: "https://figma.com/design/example",
        openApiPath: "docs/openapi.yaml",
        usageCalibration: false,
      }),
    ).toThrow(/briefPath.*1000/i);
  });

  it("accepts HTTPS OpenAPI URLs for full delivery and rejects secret-bearing URLs", () => {
    expect(() =>
      validateSpecToPrRunInput({
        workingDirectory: "/tmp/project",
        deliveryMode: "brief",
        briefPath: "docs/brief.md",
        figmaUrl: "https://figma.com/design/example",
        openApiUrl: "https://api.example.com/docs",
        usageCalibration: false,
      }),
    ).not.toThrow();

    for (const openApiUrl of [
      "http://api.example.com/openapi.yaml",
      "https://user:secret@api.example.com/openapi.yaml",
      "https://api.example.com/openapi.yaml?token=secret",
    ]) {
      expect(() =>
        validateSpecToPrRunInput({
          workingDirectory: "/tmp/project",
          openApiUrl,
          usageCalibration: false,
        }),
      ).toThrow(/openApiUrls|HTTPS|credentials|secret/i);
    }
  });

  it("rejects normalized source aliases reused across intake roles", () => {
    const conflicts = [
      {
        briefPath: "docs/shared.md",
        docsPaths: ["docs/./shared.md"],
      },
      {
        docsPath: "docs/shared.md",
        openApiPaths: ["docs/nested/../shared.md"],
      },
      {
        openApiPath: "docs/shared.md",
        guidancePaths: ["docs/./shared.md"],
      },
    ];

    for (const conflict of conflicts) {
      expect(() =>
        validateSpecToPrRunInput({
          workingDirectory: "/tmp/project",
          ...conflict,
        }),
      ).toThrow(/Source path conflicts with/);
    }
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
      "--figma",
      "https://figma.com/design/example?node-id=1-2",
      "--figma",
      "https://figma.com/design/example?node-id=3-4",
      "--openapi",
      "docs/openapi.yaml",
      "--openapi",
      "docs/admin-openapi.yaml",
      "--openapi-url",
      "https://api.example.com/openapi.yaml",
      "--guidance",
      "AGENTS.md",
      "--guidance",
      "docs/architecture/ARCHITECTURE.md",
      "--skill",
      "react-best-practices",
      "--skill",
      "api-generator",
      "--blocked-diagnostic-token-reserve",
      "24000",
      "--turn-timeout-seconds",
      "30",
      "--run-timeout-seconds",
      "600",
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
        figmaUrls: [
          "https://figma.com/design/example?node-id=1-2",
          "https://figma.com/design/example?node-id=3-4",
        ],
        openApiPaths: ["docs/openapi.yaml", "docs/admin-openapi.yaml"],
        openApiUrls: ["https://api.example.com/openapi.yaml"],
        guidancePaths: ["AGENTS.md", "docs/architecture/ARCHITECTURE.md"],
        skillHints: ["react-best-practices", "api-generator"],
        blockedDiagnosticTokenReserve: 24_000,
        turnTimeoutMs: 30_000,
        runTimeoutMs: 600_000,
      }),
    ]);
  });

  it("rejects a draft run without a finalization turn before Codex starts", () => {
    expect(() =>
      validateSpecToPrRunInput({
        workingDirectory: "/tmp/project",
        publication: "draft",
        maxTurns: 1,
      }),
    ).toThrow(/draft publication requires maxTurns to be at least 2/);
  });

  it("requires a bounded positive blocked-diagnostic reserve", () => {
    for (const blockedDiagnosticTokenReserve of [0, 24_000.5, 50_000]) {
      expect(() =>
        validateSpecToPrRunInput({
          workingDirectory: "/tmp/project",
          publication: "none",
          blockedDiagnosticTokenReserve,
        }),
      ).toThrow(/blockedDiagnosticTokenReserve/);
    }
  });

  it("always activates UI validation for the full brief contract", () => {
    const prompt = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      deliveryMode: "brief",
      briefPath: "docs/backend-brief.md",
      figmaUrl: "https://figma.com/design/example",
      openApiPath: "docs/openapi.yaml",
      prompt: "Implement the API-backed checkout screen.",
    });

    expect(prompt).toContain("functional-reviewer");
    expect(prompt).toContain("design-reviewer");
  });

  it("rejects incomplete mode-specific SDK inputs before starting Codex", () => {
    expect(() =>
      buildSpecToPrPrompt({
        workingDirectory: "/tmp/project",
        deliveryMode: "brief",
        briefPath: "docs/brief.md",
      }),
    ).toThrow(/figmaUrl/);
    expect(() =>
      buildSpecToPrPrompt({
        workingDirectory: "/tmp/project",
        deliveryMode: "brief",
        briefPath: "docs/brief.md",
        figmaUrl: "https://figma.com/design/example",
      }),
    ).toThrow(/OpenAPI/);
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
        prompt: "Migrate checkout.",
      }),
    ).toThrow(/legacyProjectRoot/);
    expect(() =>
      buildSpecToPrPrompt({
        workingDirectory: "/tmp/project",
        deliveryMode: "feature",
        prompt: "Implement checkout.",
      }),
    ).toThrow(/briefPath/);
  });

  it("limits feature validation to one targeted E2E and one video", () => {
    const prompt = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      deliveryMode: "feature",
      changeKind: "feature",
      publication: "draft",
      prompt: "Add user-facing checkout.",
      briefPath: "docs/checkout.md",
      figmaUrl: "https://figma.com/design/example",
      openApiPath: "docs/openapi.yaml",
    });

    expect(prompt).toContain('mode: "feature"');
    expect(prompt).toContain("exactly one .webm or .mp4");
    expect(prompt).toContain("Never run the full-project E2E suite by default");
    expect(prompt).toContain("featureEvidence");
    expect(prompt).toContain("pr-report-v2");
    expect(prompt).toContain("positive testCount");
    expect(prompt).toContain("non-target codex/<short-slug>");
    expect(prompt).toContain("commit all intended changes");
  });

  it("uses connected Figma intake and publishes a draft by default for Figma-only delivery", () => {
    const prompt = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      deliveryMode: "figma",
      changeKind: "design",
      figmaUrl: "https://figma.com/design/example",
    });

    expect(prompt).toContain('mode: "figma"');
    expect(prompt).toContain('publication: "draft"');
    expect(prompt).toContain("connected Figma capability");
    expect(prompt).toContain("figma-bundle");
    expect(prompt).toContain("before contracts");
    expect(prompt).toContain("deterministic mock data");
    expect(prompt).toContain("92%");
    expect(prompt).toContain("compare-visuals");
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
