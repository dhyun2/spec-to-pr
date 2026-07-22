import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

import { compareVisualPngs } from "../../src/visual/visual-comparator.js";

const root = process.cwd();

describe("v2 documentation", () => {
  it("publishes Korean and English guide locales with a locale dropdown", () => {
    const config = readFileSync(path.join(root, "website/docusaurus.config.ts"), "utf8");
    const navbar = JSON.parse(
      readFileSync(path.join(root, "website/i18n/en/docusaurus-theme-classic/navbar.json"), "utf8"),
    ) as Record<string, { message: string }>;
    const sidebar = JSON.parse(
      readFileSync(
        path.join(root, "website/i18n/en/docusaurus-plugin-content-docs/current.json"),
        "utf8",
      ),
    ) as Record<string, { message: string }>;
    const footer = JSON.parse(
      readFileSync(path.join(root, "website/i18n/en/docusaurus-theme-classic/footer.json"), "utf8"),
    ) as Record<string, { message: string }>;

    expect(config).toContain('defaultLocale: "ko"');
    expect(config).toContain('locales: ["ko", "en"]');
    expect(config).toContain('type: "localeDropdown"');
    expect(config).toContain('ko: { label: "한국어"');
    expect(config).toContain('en: { label: "English"');
    expect(navbar["item.label.사용법"]?.message).toBe("Usage");
    expect(sidebar["sidebar.guideSidebar.category.시작하기"]?.message).toBe("Getting started");
    expect(sidebar["sidebar.guideSidebar.category.사용법"]?.message).toBe("Usage");
    expect(sidebar["sidebar.guideSidebar.category.핵심 개념"]?.message).toBe("Core concepts");
    expect(sidebar["sidebar.guideSidebar.category.레퍼런스"]?.message).toBe("Reference");
    expect(footer["link.title.시작하기"]?.message).toBe("Get started");
    expect(footer["link.item.label.설정 · CLI"]?.message).toBe("Configuration · CLI");
    for (const [file, title] of [
      ["getting-started/prerequisites.md", "title: Prerequisites"],
      ["getting-started/installation.mdx", "title: Installation"],
      ["getting-started/quickstart.md", "title: Quickstart — first draft PR"],
      ["usage/index.mdx", "title: Choose your delivery"],
      ["concepts/reviews.mdx", "title: Agent reviews and evidence ownership"],
      ["concepts/visual-verification.mdx", "title: Visual verification"],
      ["reference/config.md", "title: Configuration · CLI · environment"],
    ] as const) {
      const translated = readFileSync(
        path.join(root, "website/i18n/en/docusaurus-plugin-content-docs/current", file),
        "utf8",
      );
      expect(translated, file).toContain(title);
    }
  });

  it("publishes a bilingual comparison route from verified primary sources", () => {
    const comparisonPaths = [
      "website/docs/concepts/comparison.mdx",
      "website/i18n/en/docusaurus-plugin-content-docs/current/concepts/comparison.mdx",
    ];
    const sidebar = readFileSync(path.join(root, "website/sidebars.ts"), "utf8");
    const allowedPrimarySources = new Set([
      "https://github.github.com/spec-kit/index.html",
      "https://github.github.com/spec-kit/quickstart.html",
      "https://github.github.com/spec-kit/reference/workflows.html",
      "https://openspec.dev/",
      "https://github.com/Fission-AI/OpenSpec/blob/main/docs/overview.md",
      "https://github.com/Fission-AI/OpenSpec/blob/main/docs/commands.md",
      "https://github.com/Fission-AI/OpenSpec/blob/main/docs/troubleshooting.md",
      "https://kiro.dev/docs/specs/",
      "https://kiro.dev/docs/cli/v3/specs/",
      "https://kiro.dev/docs/specs/correctness/",
      "https://kiro.dev/docs/web/specs/",
      "https://docs.bmad-method.org/reference/workflow-map/",
      "https://docs.bmad-method.org/tutorials/getting-started/",
      "https://docs.bmad-method.org/how-to/quick-fixes/",
      "https://learn.chatgpt.com/docs/agent-configuration/subagents.md",
      "https://learn.chatgpt.com/docs/build-skills.md",
      "https://learn.chatgpt.com/docs/extend/mcp.md",
      "https://learn.chatgpt.com/docs/browser.md",
      "https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations",
      "https://github.github.com/gh-aw/reference/safe-outputs-pull-requests/",
      "https://github.github.com/gh-aw/reference/permissions/",
      "https://code.claude.com/docs/en/sub-agents",
      "https://code.claude.com/docs/en/slash-commands",
      "https://code.claude.com/docs/en/hooks",
      "https://code.claude.com/docs/en/mcp",
      "https://code.claude.com/docs/en/chrome",
      "https://cursor.com/docs/subagents",
      "https://cursor.com/docs/rules",
      "https://docs.cursor.com/agent",
      "https://cursor.com/blog/agent-best-practices",
      "https://docs.cline.bot/features/subagents",
      "https://docs.cline.bot/mcp/mcp-overview",
      "https://docs.cline.bot/tools-reference/all-cline-tools",
      "https://docs.cline.bot/sdk/guides/multi-agent-teams",
      "https://playwright.dev/docs/test-assertions",
      "https://playwright.dev/docs/test-reporters",
      "https://playwright.dev/docs/videos",
      "https://developer.chrome.com/docs/devtools/agents/get-started",
      "https://github.com/ChromeDevTools/chrome-devtools-mcp",
      "https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md",
    ]);

    for (const concept of [
      "concepts/pipeline",
      "concepts/reviews",
      "concepts/visual-verification",
      "concepts/comparison",
    ]) {
      expect(sidebar).toContain(`"${concept}"`);
    }
    for (const file of comparisonPaths) {
      expect(existsSync(path.join(root, file)), file).toBe(true);
      const comparison = readFileSync(path.join(root, file), "utf8");
      for (const framework of ["GitHub Spec Kit", "OpenSpec", "Kiro", "BMAD"]) {
        expect(comparison, `${file}:${framework}`).toContain(framework);
      }
      for (const dimension of [
        "Intake / contracts",
        "Implementation",
        "Validation",
        "Publication",
        "Blocked / resume",
        "Best fit",
      ]) {
        expect(comparison, `${file}:${dimension}`).toContain(dimension);
      }
      for (const product of [
        "Codex",
        "GitHub Copilot",
        "GitHub Agentic Workflows",
        "Claude Code",
        "Cursor",
        "Cline",
        "Playwright",
        "Chrome DevTools MCP",
      ]) {
        expect(comparison, `${file}:${product}`).toContain(product);
      }
      const claudeRow =
        comparison.split("\n").find((line) => line.includes("| [Claude Code](")) ?? "";
      expect(claudeRow, `${file}:Claude Code version`).toContain("v2.1.172");
      expect(claudeRow, `${file}:Claude Code nesting bound`).toContain("fixed maximum depth five");
      expect(claudeRow, `${file}:Claude Code nesting is not configurable`).not.toMatch(
        /configurable/i,
      );
      expect(claudeRow, `${file}:Claude Code nesting disablement`).toContain(
        "omitting `Agent` disables nesting",
      );
      expect(claudeRow, `${file}:stale Claude Code claim`).not.toContain("no nesting");
      expect(claudeRow, `${file}:SpecToPR nesting disposition`).toContain(
        "SpecToPR rejects nesting",
      );
      expect(comparison).toContain("2026-07-15");
      expect(comparison).toContain("Adopted");
      expect(comparison).toContain("Conditional");
      expect(comparison).toContain("Rejected");
      expect(comparison).toContain("issue fallback");
      expect(comparison).toContain("heavy permanent teams");
      const links = comparison.match(/https:\/\/[^)\s]+/g) ?? [];
      expect(links.length, `${file}:primary source links`).toBeGreaterThan(10);
      for (const link of links) {
        expect(allowedPrimarySources.has(link), `${file}:non-primary ${link}`).toBe(true);
      }
    }
  });

  it("links directly to four separate usage pages", () => {
    const sidebar = readFileSync(path.join(root, "website/sidebars.ts"), "utf8");
    const config = readFileSync(path.join(root, "website/docusaurus.config.ts"), "utf8");
    const navbar = JSON.parse(
      readFileSync(path.join(root, "website/i18n/en/docusaurus-theme-classic/navbar.json"), "utf8"),
    ) as Record<string, { message: string }>;
    const maintained = [
      readFileSync(path.join(root, "README.md"), "utf8"),
      readFileSync(path.join(root, "README.ko.md"), "utf8"),
      readFileSync(path.join(root, "website/docs/intro.md"), "utf8"),
      readFileSync(path.join(root, "website/docs/getting-started/quickstart.md"), "utf8"),
      config,
    ].join("\n");

    expect(sidebar).toContain('"usage/index"');
    for (const caseName of ["brief", "legacy", "feature", "figma"]) {
      expect(sidebar).toContain(`"usage/${caseName}"`);
    }
    expect(sidebar).not.toContain('items: ["usage/recipes"]');
    expect(config).toContain('{ to: "/usage/", position: "left", label: "사용법" }');
    expect(config).toContain('{ label: "사용법", to: "/usage/" }');
    expect(navbar["item.label.사용법"]?.message).toBe("Usage");
    expect(maintained).not.toContain("/usage/recipes");
    expect(readFileSync(path.join(root, "README.md"), "utf8")).toContain(
      "https://dhyun2.github.io/spec-to-pr/en/usage/brief",
    );
    expect(readFileSync(path.join(root, "README.ko.md"), "utf8")).toContain(
      "https://dhyun2.github.io/spec-to-pr/usage/brief",
    );
  });

  it("builds a progressive guide experience around authentic runtime evidence", async () => {
    const componentDirectory = path.join(root, "website/src/components/guide");
    const expectedComponents = [
      "AgentReviewMap.tsx",
      "GuideHero.tsx",
      "ModeChooser.tsx",
      "NextStep.tsx",
      "RunPipeline.tsx",
      "VisualProof.tsx",
      "guide.module.css",
    ];
    expect(readdirSync(componentDirectory).sort()).toEqual(expectedComponents);

    const localizedPages = [
      [
        "ko",
        "website/docs/intro.md",
        "website/docs/usage/index.mdx",
        "website/docs/concepts/pipeline.md",
        "website/docs/concepts/reviews.mdx",
        "website/docs/concepts/visual-verification.mdx",
      ],
      [
        "en",
        "website/i18n/en/docusaurus-plugin-content-docs/current/intro.md",
        "website/i18n/en/docusaurus-plugin-content-docs/current/usage/index.mdx",
        "website/i18n/en/docusaurus-plugin-content-docs/current/concepts/pipeline.md",
        "website/i18n/en/docusaurus-plugin-content-docs/current/concepts/reviews.mdx",
        "website/i18n/en/docusaurus-plugin-content-docs/current/concepts/visual-verification.mdx",
      ],
    ] as const;

    for (const [locale, ...files] of localizedPages) {
      const contents = files.map((file) => readFileSync(path.join(root, file), "utf8")).join("\n");
      for (const component of [
        "GuideHero",
        "ModeChooser",
        "RunPipeline",
        "AgentReviewMap",
        "VisualProof",
        "NextStep",
      ]) {
        expect(contents, `${locale}:${component}`).toContain(component);
      }
      for (const fact of [
        "pngjs",
        "RGBA",
        "0.02",
        "98%",
        "20%",
        "functional reviewer",
        "design reviewer",
      ]) {
        expect(contents, `${locale}:${fact}`).toContain(fact);
      }
      expect(contents, `${locale}:three comparisons`).toMatch(
        locale === "ko" ? /비교 총 3회/ : /three total comparisons/,
      );
      expect(contents, `${locale}:immutable packet`).toMatch(
        locale === "ko" ? /immutable packet|불변 packet/ : /immutable packet/,
      );
      expect(contents, `${locale}:one writer`).toMatch(
        locale === "ko"
          ? /implementation writer 한 명|한 명의 implementation writer/
          : /one implementation writer/,
      );
    }

    const pipelineComponent = readFileSync(
      path.join(componentDirectory, "RunPipeline.tsx"),
      "utf8",
    );
    expect(pipelineComponent).toContain("aria-pressed={activeStage === stage.id}");
    expect(pipelineComponent).toContain('data-testid="run-pipeline"');
    expect(pipelineComponent).toContain('data-testid="pipeline-noscript"');
    expect(pipelineComponent).toContain("action:");
    expect(pipelineComponent).toContain("passCondition:");
    expect(readFileSync(path.join(componentDirectory, "guide.module.css"), "utf8")).toContain(
      "prefers-reduced-motion",
    );

    const visualDirectory = path.join(root, "website/static/img/guide/visual-proof");
    const visualDigests: Record<string, string> = {};
    for (const file of ["baseline.png", "actual.png", "diff.png", "overlay.png"]) {
      const content = readFileSync(path.join(visualDirectory, file));
      expect(content.length, file).toBeGreaterThan(100);
      expect(() => PNG.sync.read(content), file).not.toThrow();
      visualDigests[file] = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    }
    const metrics = JSON.parse(
      readFileSync(path.join(visualDirectory, "metrics.json"), "utf8"),
    ) as {
      schemaVersion: string;
      status: string;
      attempt: number;
      metrics: {
        width: number;
        height: number;
        comparedPixelCount: number;
        maskedPixelCount: number;
        maskedAreaRatio: number;
        exactMatchRatio: number;
        reviewMatchRatio: number;
        meanDistance: number;
        maxDistance: number;
        pixelTolerance: number;
        threshold: number;
      };
      maskReasons: string[];
      files: Record<string, { path: string; digest: string }>;
    };
    expect(metrics.schemaVersion).toBe("guide-visual-proof-v1");
    expect(metrics.status).toBe("passed");
    expect(metrics.attempt).toBe(1);
    expect(metrics.metrics.reviewMatchRatio).toBeGreaterThanOrEqual(0.98);
    expect(metrics.metrics.pixelTolerance).toBe(0.02);
    for (const [name, file] of Object.entries(metrics.files)) {
      expect(file.path).toBe(`${name}.png`);
      expect(file.digest).toBe(visualDigests[`${name}.png`]);
    }

    const recomputed = await compareVisualPngs({
      baseline: readFileSync(path.join(visualDirectory, "baseline.png")),
      actual: readFileSync(path.join(visualDirectory, "actual.png")),
    });
    expect(recomputed.status).toBe(metrics.status);
    expect(recomputed.metrics).toEqual(metrics.metrics);
    expect(recomputed.maskReasons).toEqual(metrics.maskReasons);
    expect(recomputed.diff).toEqual(readFileSync(path.join(visualDirectory, "diff.png")));
    expect(recomputed.overlay).toEqual(readFileSync(path.join(visualDirectory, "overlay.png")));

    const visualComponent = readFileSync(path.join(componentDirectory, "VisualProof.tsx"), "utf8");
    expect(visualComponent).toContain("metrics.json");
    expect(visualComponent).toContain("reviewMatchRatio");
    expect(visualComponent).toContain("meanDistance");
    expect(visualComponent).toContain("maxDistance");

    const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts["guide:assets"]).toBe("tsx scripts/build-guide-visual-assets.ts");
    expect(readFileSync(path.join(root, "scripts/build-guide-visual-assets.ts"), "utf8")).toContain(
      "compareVisualPngs",
    );
    expect(readFileSync(path.join(root, "website/docusaurus.config.ts"), "utf8")).toContain(
      'format: "mdx"',
    );

    for (const directory of [
      path.join(root, "website", "docs"),
      path.join(root, "website", "i18n", "en", "docusaurus-plugin-content-docs", "current"),
    ]) {
      for (const file of relativeFiles(directory)) {
        const contents = readFileSync(path.join(directory, file), "utf8");
        expect(contents, `${file}:admonition title syntax`).not.toMatch(
          /^:::(?:note|tip|info|warning|danger)\s+[^[]/m,
        );
      }
    }

    for (const forbiddenDirectory of ["docs/design", "docs/superpowers"]) {
      if (existsSync(path.join(root, forbiddenDirectory))) {
        expect(relativeFiles(path.join(root, forbiddenDirectory))).toEqual([]);
      }
    }
    expect(existsSync(path.join(root, "PLAN.md"))).toBe(false);
  });

  it("documents four separate usage cases in Korean and English", () => {
    const locales = {
      ko: "website/docs/usage",
      en: "website/i18n/en/docusaurus-plugin-content-docs/current/usage",
    };
    const cases = ["brief", "legacy", "feature", "figma"];
    const headingIds = [
      "use-this-case",
      "required-inputs",
      "optional-inputs",
      "minimal-prompt",
      "full-prompt",
      "process",
      "evidence",
      "branch-and-commits",
      "expected-pr",
      "blockers",
      "exclusions",
    ];

    for (const [locale, directory] of Object.entries(locales)) {
      const guides = Object.fromEntries(
        cases.map((caseName) => [
          caseName,
          readFileSync(path.join(root, directory, `${caseName}.mdx`), "utf8"),
        ]),
      );

      for (const [caseName, guide] of Object.entries(guides)) {
        expect(guide, `${locale}:${caseName}`).not.toContain('import Tabs from "@theme/Tabs"');
        expect(guide, `${locale}:${caseName}`).not.toContain("<TabItem");
        for (const headingId of headingIds) {
          expect(guide, `${locale}:${caseName}:${headingId}`).toContain(
            `id="${headingId}-${caseName}"`,
          );
        }
        expect(guide).toContain("requiredValidations");
        expect(guide).toContain("80%");
        expect(guide).toContain("pr-report-v2.1");
        expect(guide).toContain("complete");
        expect(guide).toContain("not-run");
        expect(guide).toContain("not-applicable");
        expect(guide).toContain("spec-to-pr/evidence");
        expect(guide).toMatch(
          locale === "ko"
            ? /비교 총 3회\(최초 1회 \+ repair 최대 2회\)/
            : /three total comparison attempts \(the initial comparison plus at most two repairs\)/,
        );
        for (const stage of [
          "intake",
          "contracts",
          "implementation",
          "functional-review",
          "design-review",
          "report",
          "publish",
          "archive",
        ]) {
          expect(guide, `${locale}:${caseName}:${stage}`).toContain(`\`${stage}\``);
        }
        for (const policy of [
          "implementation writer",
          "read-only scout",
          "functional-reviewer",
          "design-reviewer",
          "no nesting",
          "parallel writer",
          "recommendedSkills",
          "appliedSkills",
          "workflow MCP",
          "Playwright Test/CLI",
          "Browser MCP",
          "Chrome DevTools MCP",
          "intent: ready",
          "intent: blocked-diagnostic",
          "local blocked report",
          "same Run",
          "same draft PR",
          "status: blocked",
          "PUBLISH_NO_DELTA",
        ]) {
          expect(guide, `${locale}:${caseName}:${policy}`).toContain(policy);
        }
        const stageSkillRoute = guide.match(/^- `stageSkillRoute`:[^\n]+$/m)?.[0] ?? "";
        const recommendation = guide.match(/^- `recommendedSkills`:[^\n]+$/m)?.[0] ?? "";
        expect(stageSkillRoute, `${locale}:${caseName}:stageSkillRoute`).not.toBe("");
        expect(recommendation, `${locale}:${caseName}:recommendedSkills`).not.toBe("");
        expect(
          recommendation,
          `${locale}:${caseName}:stage skills are not recommendations`,
        ).not.toMatch(
          /intake-contracts|(?:^|`)implement`|review-functional|review-design|(?:^|`)publish`|archive-openspec/,
        );
        expect(recommendation).toContain("`figma`");
        expect(recommendation).toContain("`design-system`");
        expect(recommendation).toContain("`api-generator`");
        expect(recommendation).toContain("`react-best-practices`");
        expect(recommendation).toContain("`next-best-practices`");
        if (caseName === "feature") {
          expect(recommendation).toContain("`playwright`");
        } else {
          expect(recommendation).not.toContain("`playwright`");
        }
        expect(guide).toContain(locale === "ko" ? "## 다른 사용법" : "## Other usage cases");
        expect(guide.match(/\]\(\.\/(?:brief|legacy|feature|figma)\)/g)).toHaveLength(3);
      }

      expect(Object.values(guides).join("\n")).toContain("implementationContextId");
      expect(guides.feature).toContain("targeted-feature");
      expect(guides.feature).toContain("featureVideo: required");
      expect(guides.feature).toContain("full-project E2E");
      expect(guides.figma).toContain("figma-bundle");
      expect(guides.figma).toContain("publication: draft");
      expect(guides.brief).toContain("briefPath");
      expect(guides.brief).toContain("figmaUrl");
      expect(guides.brief).toMatch(/openApiPaths|openApiUrls/);
      expect(guides.brief).toContain("Web Vitals");
      expect(guides.brief).toContain("API gap");
      expect(guides.legacy).toContain("legacyProjectRoot");
      expect(guides.legacy).toContain("legacyNetworkEvidencePath");
      expect(guides.legacy).toContain("1,000");
      expect(guides.legacy).toContain("legacy inventory");
      expect(guides.legacy).toContain("running legacy");
      expect(guides.legacy).toContain("source-fetch-literal");
      expect(guides.legacy).toMatch(/durable|Run ID/);
      expect(guides.legacy).toMatch(/empty-inventory|빈 inventory/);
      expect(guides.legacy).toMatch(/Optional OpenAPI|선택 OpenAPI/);
      expect(guides.legacy).not.toMatch(
        /API gaps? when OpenAPI is supplied|OpenAPI 제공 시 API gap|OpenAPI를 제공한 경우에만|required only when OpenAPI was supplied/,
      );
      expect(guides.legacy, `${locale}:legacy examples must remain scope-neutral`).not.toMatch(
        /결제\s*재시도|payment[-_\s]?retry|legacy_checkout_retry/i,
      );
      expect(guides.legacy).toContain(
        locale === "ko" ? "지정한 레거시 범위" : "the selected legacy scope",
      );
      expect(guides.figma).toContain("mock");
      expect(guides.figma).toContain("sha256");
      expect(guides.figma).toContain("98%");
      for (const caseName of cases) {
        expect(guides[caseName]).toContain("pr-report-v2.1");
        expect(guides[caseName]).toContain("15");
        expect(guides[caseName]).toContain("blocked");
        expect(guides[caseName]).toContain("`none`");
        expect(guides[caseName]).toContain("sha256");
        expect(guides[caseName]).toMatch(/provider/);
      }
      for (const caseName of ["brief", "legacy", "figma"]) {
        expect(guides[caseName]).not.toContain("featureVideo: required");
      }
    }
  });

  it("keeps reusable legacy examples domain-neutral", () => {
    const reusableLegacyExamples = [
      "website/docs/usage/legacy.mdx",
      "website/i18n/en/docusaurus-plugin-content-docs/current/usage/legacy.mdx",
      "website/src/components/guide/VisualProof.tsx",
      "scripts/build-guide-visual-assets.ts",
      "website/static/img/guide/visual-proof/metrics.json",
    ];

    for (const file of reusableLegacyExamples) {
      const contents = readFileSync(path.join(root, file), "utf8");
      expect(contents, `${file}: reusable examples must not imply a business feature`).not.toMatch(
        /결제\s*재시도|payment[-_\s/]?retry|checkout[-_\s/]?retry|payment-declined|legacy_checkout_retry/i,
      );
    }
  });

  it("keeps recipes as redirect-only compatibility documents", () => {
    const redirects = {
      ko: readFileSync(path.join(root, "website/docs/usage/recipes.mdx"), "utf8"),
      en: readFileSync(
        path.join(root, "website/i18n/en/docusaurus-plugin-content-docs/current/usage/recipes.mdx"),
        "utf8",
      ),
    };

    expect(redirects.ko).toContain('<Redirect to={useBaseUrl("/usage/brief")} />');
    expect(redirects.en).toContain('<Redirect to={useBaseUrl("/usage/brief")} />');
    for (const redirect of Object.values(redirects)) {
      expect(redirect).toContain('import { Redirect } from "@docusaurus/router"');
      expect(redirect).toContain('import useBaseUrl from "@docusaurus/useBaseUrl"');
      expect(redirect).not.toContain("## Required inputs");
      expect(redirect).not.toContain("<Tabs");
    }
  });

  it("keeps only the current ADRs and compact website pages", () => {
    expect(readdirSync(path.join(root, "docs", "adr")).sort()).toEqual([
      "035-use-coarse-workflow-facade-and-split-reviews.md",
      "036-use-delivery-profiles-not-mode-specific-pipelines.md",
      "037-use-boundary-budgeting-and-numeric-calibration.md",
      "038-harden-evidence-trust-and-unify-delivery-policy.md",
    ]);
    expect(relativeFiles(path.join(root, "website", "docs"))).toEqual([
      "concepts/comparison.mdx",
      "concepts/pipeline.md",
      "concepts/reviews.mdx",
      "concepts/visual-verification.mdx",
      "getting-started/installation.mdx",
      "getting-started/prerequisites.md",
      "getting-started/quickstart.md",
      "intro.md",
      "reference/config.md",
      "reference/skills.md",
      "troubleshooting.md",
      "usage/brief.mdx",
      "usage/feature.mdx",
      "usage/figma.mdx",
      "usage/index.mdx",
      "usage/legacy.mdx",
      "usage/recipes.mdx",
    ]);
  });

  it("keeps the eight-skill count synchronized across current repository documentation", () => {
    const documentationPaths = [
      "README.md",
      "README.ko.md",
      ...relativeFiles(path.join(root, "docs")).map((file) => `docs/${file}`),
      ...relativeFiles(path.join(root, "website", "docs")).map((file) => `website/docs/${file}`),
      ...relativeFiles(
        path.join(root, "website", "i18n", "en", "docusaurus-plugin-content-docs", "current"),
      ).map((file) => `website/i18n/en/docusaurus-plugin-content-docs/current/${file}`),
      "website/docusaurus.config.ts",
    ];
    const staleSkillCounts = [
      /\b(?:9|nine)\s+(?:(?:public|installed|marketplace)\s+){0,3}skills?\b/i,
      /skills?\s*9개/i,
      /9개(?:의)?\s*(?:(?:public|marketplace|설치된)\s+){0,3}skills?/i,
      /아홉\s*(?:개(?:의)?)?\s*(?:(?:public|marketplace|설치된)\s+){0,3}skills?/i,
    ];

    for (const file of documentationPaths) {
      const contents = readFileSync(path.join(root, file), "utf8");
      for (const staleCount of staleSkillCounts) {
        expect(contents, `${file}:${staleCount}`).not.toMatch(staleCount);
      }
    }
    expect(
      readFileSync(
        path.join(root, "docs/adr/036-use-delivery-profiles-not-mode-specific-pipelines.md"),
        "utf8",
      ),
    ).toContain("eight public marketplace skills");
  });

  it("documents the four profiles and exact lightweight surface without v1 calls", () => {
    const paths = [
      "README.md",
      "README.ko.md",
      "packages/codex-sdk/README.md",
      ...relativeFiles(path.join(root, "docs", "adr")).map((file) => `docs/adr/${file}`),
      ...relativeFiles(path.join(root, "website", "docs")).map((file) => `website/docs/${file}`),
    ];
    const contents = paths.map((file) => readFileSync(path.join(root, file), "utf8")).join("\n");

    for (const mode of ["brief", "legacy", "feature", "figma"]) {
      expect(contents).toContain(`\`${mode}\``);
    }
    for (const fact of ["7 MCP tools", "8 durable stages", "8 skills", "2 independent reviewers"]) {
      expect(readFileSync(path.join(root, "README.md"), "utf8")).toContain(fact);
    }
    for (const obsolete of [
      "kernel_info",
      "create_run",
      "generate_pr_report",
      "publish_review_request",
      "/spec-to-pr:figma-doctor",
      "/spec-to-pr:run-visual-regression",
      "--no-visual-repair-loop",
      "--min-visual-score",
      "--max-repair-attempts",
    ]) {
      expect(contents).not.toContain(obsolete);
    }

    expect(contents).toContain("full-project E2E");
    expect(contents).toContain("exactly one");
    expect(contents).toContain("figma-bundle");
    expect(contents).toContain("apiArtifacts");
    expect(contents).toContain("implementationContextId");
    expect(contents).toContain("host-connected-figma");
    expect(contents).toContain("immutable");
    expect(contents).toContain("draft-only");
    expect(contents).toContain("clean tree");
    expect(contents).toContain("workloadSignals");
    expect(contents).toContain("split-required");
    expect(contents).not.toContain("approval-required");
    expect(contents).not.toContain("--token-budget");
    expect(contents).not.toContain("tokenBudget");
    expect(contents).toContain("80%");
    expect(contents).toContain("numeric-only");
    expect(contents).toContain("usage-unavailable");
    expect(contents).toContain("requiredValidations");
    expect(contents).toContain("resumeContext");
    expect(contents).toContain("outputFormatting");
    expect(contents).toContain("openApiUrls");
    expect(contents).toContain("sourceProvenance");
    expect(contents).toContain("visualTargets");
    expect(contents).toContain("compare-visuals");
    expect(contents).toContain("legacyInventory");
    expect(contents).toContain("apiCoverage");
    expect(contents).toContain("pr-report-v2");
    expect(contents).toContain("98%");
  });

  it("synchronizes the eight public skills, blocked diagnostics, and release labels", () => {
    const readme = readFileSync(path.join(root, "README.md"), "utf8");
    const readmeKo = readFileSync(path.join(root, "README.ko.md"), "utf8");
    const intro = readFileSync(path.join(root, "website/docs/intro.md"), "utf8");
    const skills = readFileSync(path.join(root, "website/docs/reference/skills.md"), "utf8");
    const skillsEn = readFileSync(
      path.join(root, "website/i18n/en/docusaurus-plugin-content-docs/current/reference/skills.md"),
      "utf8",
    );
    const pipeline = readFileSync(path.join(root, "website/docs/concepts/pipeline.md"), "utf8");
    const troubleshooting = readFileSync(
      path.join(root, "website/docs/troubleshooting.md"),
      "utf8",
    );
    const config = readFileSync(path.join(root, "website/docusaurus.config.ts"), "utf8");
    const adr = readFileSync(
      path.join(root, "docs/adr/035-use-coarse-workflow-facade-and-split-reviews.md"),
      "utf8",
    );
    const publicSkills = [
      "spec-to-pr",
      "doctor",
      "intake-contracts",
      "implement",
      "review-functional",
      "review-design",
      "publish",
      "archive-openspec",
    ];

    for (const contents of [skills, skillsEn]) {
      expect(contents).toContain("8 public marketplace skills");
      for (const skill of publicSkills) expect(contents).toContain(`\`${skill}\``);
      expect(contents).not.toContain("`prepare-release`");
      expect(contents).toContain("recommendedSkills");
      expect(contents).toContain("appliedSkills");
    }
    expect(readme).toContain("Current release");
    expect(readmeKo).toContain("현재 릴리스");
    expect(readme).not.toContain("Unreleased");
    expect(readmeKo).not.toContain("Unreleased");
    expect(config).toContain("Documentation · v${version}");
    expect(config).not.toContain("Development docs");
    expect(intro).toContain("skill 8개");
    expect(adr).toContain("eight public marketplace skills");

    const blockedDocs = [readme, readmeKo, pipeline, troubleshooting].join("\n");
    for (const term of [
      "blockerDetails",
      "intent: blocked-diagnostic",
      "status: blocked",
      "local blocked report",
      "PUBLISH_NO_DELTA",
      "same draft PR",
      "BROWSER_NOT_RUN",
    ]) {
      expect(blockedDocs).toContain(term);
    }
  });

  it("documents explicit recovery for uncertain diagnostic publication in both locales", () => {
    const localizedPaths = [
      [
        "ko",
        "website/docs/troubleshooting.md",
        "website/docs/concepts/pipeline.md",
        "website/docs/reference/skills.md",
      ],
      [
        "en",
        "website/i18n/en/docusaurus-plugin-content-docs/current/troubleshooting.md",
        "website/i18n/en/docusaurus-plugin-content-docs/current/concepts/pipeline.md",
        "website/i18n/en/docusaurus-plugin-content-docs/current/reference/skills.md",
      ],
    ] as const;

    for (const [locale, troubleshootingPath, pipelinePath, skillsPath] of localizedPaths) {
      const troubleshooting = readFileSync(path.join(root, troubleshootingPath), "utf8");
      const pipeline = readFileSync(path.join(root, pipelinePath), "utf8");
      const skills = readFileSync(path.join(root, skillsPath), "utf8");
      const localizedContract = [troubleshooting, pipeline, skills].join("\n");

      for (const term of [
        "diagnostic-publication-uncertain",
        "recoverUncertain: false",
        "recoverUncertain: true",
        "GitHub/GitLab",
        "workflow_publish",
      ]) {
        expect(localizedContract, `${locale}:${term}`).toContain(term);
      }
      expect(troubleshooting, `${locale}:explicit approval`).toMatch(/explicit|명시적/);
      expect(troubleshooting, `${locale}:matching draft inspection`).toMatch(
        /matching draft|일치하는 draft/,
      );
      expect(pipeline, `${locale}:blocked stages remain blocked`).toContain("blocked stages");
      expect(skills, `${locale}:SDK never auto-approves`).toContain("SDK");
      expect(skills, `${locale}:SDK never auto-approves`).toMatch(
        /never auto-approves|자동 승인하지/,
      );
    }

    const usagePaths = [
      ...["brief", "legacy", "feature", "figma"].map((name) => `website/docs/usage/${name}.mdx`),
      ...["brief", "legacy", "feature", "figma"].map(
        (name) => `website/i18n/en/docusaurus-plugin-content-docs/current/usage/${name}.mdx`,
      ),
    ];
    for (const file of usagePaths) {
      const guide = readFileSync(path.join(root, file), "utf8");
      expect(guide, file).toContain("diagnostic-publication-uncertain");
      expect(guide, file).toContain("recoverUncertain: true");
    }
  });

  it("documents portable secret-safe artifact paths without rejecting descriptive names", () => {
    const evidenceSkills = [
      "skills/spec-to-pr/SKILL.md",
      "skills/intake-contracts/SKILL.md",
      "skills/implement/SKILL.md",
      "skills/review-functional/SKILL.md",
      "skills/review-design/SKILL.md",
    ];
    for (const file of evidenceSkills) {
      const skill = readFileSync(path.join(root, file), "utf8");
      expect(skill, `${file}:artifactPaths`).toContain("artifactPaths");
      expect(skill, `${file}:project-relative`).toContain("project-relative");
      expect(skill, `${file}:portable separators`).toContain("`/`-separated");
      expect(skill, `${file}:absolute paths`).toContain("absolute");
      expect(skill, `${file}:secret values`).toMatch(/token.*password.*secret.*credential/i);
    }

    const pipelines = [
      "website/docs/concepts/pipeline.md",
      "website/i18n/en/docusaurus-plugin-content-docs/current/concepts/pipeline.md",
    ];
    for (const file of pipelines) {
      const pipeline = readFileSync(path.join(root, file), "utf8");
      for (const term of [
        "artifactPaths",
        "project-relative",
        "`/`-separated",
        "non-portable",
        "token/password/secret/credential",
        "`token-validation.json`",
      ]) {
        expect(pipeline, `${file}:${term}`).toContain(term);
      }
    }
  });

  it("documents every blockerDetails.kind as the exact runtime enum", () => {
    const troubleshootingPaths = [
      "website/docs/troubleshooting.md",
      "website/i18n/en/docusaurus-plugin-content-docs/current/troubleshooting.md",
    ];
    const blockerKinds = [
      "missing-input",
      "missing-tool",
      "policy",
      "verification",
      "publish-precondition",
      "budget-split",
      "unexpected",
    ];

    for (const file of troubleshootingPaths) {
      const troubleshooting = readFileSync(path.join(root, file), "utf8");
      expect(troubleshooting).toContain("blockerDetails.kind");
      const firstColumnCells = troubleshooting
        .split("\n")
        .map((line) => line.match(/^\|\s*`?([^|`]+?)`?\s*\|/)?.[1]?.trim())
        .filter((cell): cell is string => cell !== undefined);
      for (const kind of blockerKinds) {
        expect(firstColumnCells, `${file}:${kind}`).toContain(kind);
      }
      for (const humanized of [
        "missing input/tool",
        "missing input",
        "missing tool",
        "publish precondition",
        "budget split",
      ]) {
        expect(firstColumnCells, `${file}:${humanized}`).not.toContain(humanized);
      }
    }
  });

  it("keeps every retained Figma checklist aligned with the typed provenance contract", () => {
    const checklistPaths = [
      "docs/adr/036-use-delivery-profiles-not-mode-specific-pipelines.md",
      "website/docs/getting-started/prerequisites.md",
      "website/docs/troubleshooting.md",
    ];

    for (const file of checklistPaths) {
      const contents = readFileSync(path.join(root, file), "utf8");
      expect(contents, file).toContain("provider: host-connected-figma");
      expect(contents, file).toContain("capturedAt");
      expect(contents, file).toContain("fileUrl");
      expect(contents, file).toContain("nodeIds");
      expect(contents, file).toContain("manifestPath");
      expect(contents, file).toContain("visualPaths");
      expect(contents, file).toContain("PNG");
      expect(contents, file).not.toMatch(/JPEG|SVG/);
    }
  });

  it("documents composable sources, guidance precedence, and the zero-to-100 feature recipe", () => {
    const readmes = ["README.md", "README.ko.md", "packages/codex-sdk/README.md"].map((file) =>
      readFileSync(path.join(root, file), "utf8"),
    );
    const recipe = readFileSync(path.join(root, "website/docs/usage/feature.mdx"), "utf8");
    const config = readFileSync(path.join(root, "website/docs/reference/config.md"), "utf8");
    const skills = readFileSync(path.join(root, "website/docs/reference/skills.md"), "utf8");
    const pipeline = readFileSync(path.join(root, "website/docs/concepts/pipeline.md"), "utf8");
    const troubleshooting = readFileSync(
      path.join(root, "website/docs/troubleshooting.md"),
      "utf8",
    );

    for (const contents of readmes) {
      for (const field of [
        "briefPath",
        "figmaUrl",
        "docsPaths",
        "openApiPaths",
        "guidancePaths",
        "skillHints",
      ]) {
        expect(contents).toContain(field);
      }
      expect(contents).toContain("mode: feature");
    }

    for (const field of [
      "mode: feature",
      "briefPath: docs/checkout.md",
      "figmaUrl: https://www.figma.com/design/FILE/checkout?node-id=12-345",
      "openApiPaths:",
      "docsPaths:",
      "guidancePaths:",
      "skillHints:",
    ]) {
      expect(recipe).toContain(field);
    }
    expect(recipe).toContain("api-generator");
    expect(recipe).toContain("design-system");
    expect(recipe).toContain("react-best-practices");
    expect(recipe).toContain("next-best-practices");
    expect(recipe).toContain("openApiPaths: [docs/openapi.yaml]");
    expect(recipe).not.toContain("OpenAPI: docs/openapi.yaml");

    for (const field of [
      "docsPaths",
      "openApiPaths",
      "guidancePaths",
      "discoveredGuidancePaths",
      "skillHints",
    ]) {
      expect(config).toContain(field);
    }
    for (const candidate of [
      "AGENTS.md",
      "CLAUDE.md",
      "README.md",
      "docs/architecture/ARCHITECTURE.md",
      "docs/etc/folder-structure.md",
    ]) {
      expect(config).toContain(candidate);
    }
    expect(config).toContain("current user request");
    expect(config).toContain("explicit `guidancePaths`");
    expect(config).toContain("automatically discovered project guidance");
    expect(config).toContain("applicable installed skills");
    expect(config).toContain("SpecToPR defaults");

    expect(skills).toContain("available and applicable");
    expect(skills).toContain("Missing optional skills");
    expect(pipeline).toContain("Delivery mode controls delivery and evidence");
    expect(pipeline).toContain("excluded from scope classification");
    expect(troubleshooting).toContain("Missing optional skills do not block");
    expect(troubleshooting).toContain("feature mode");
    expect(troubleshooting).toContain("figma-bundle");
  });
});

function relativeFiles(directory: string, prefix = ""): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      return entry.isDirectory()
        ? relativeFiles(path.join(directory, entry.name), relative)
        : [relative];
    })
    .sort();
}
