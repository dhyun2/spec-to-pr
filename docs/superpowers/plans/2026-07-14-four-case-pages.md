# Four Separate Usage Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the combined bilingual tab guide with four directly navigable Korean and English usage pages while preserving the old recipes URLs as hidden locale-correct redirects.

**Architecture:** Split each existing `TabItem` body into one ordinary Docusaurus MDX document, keeping the same eleven case-contract sections and case-specific evidence rules. The manual sidebar and navbar point directly to the four pages, while minimal redirect-only recipes documents preserve old links. Update the existing Playwright check to visit every localized page and both redirects without adding a dependency or runtime behavior.

**Tech Stack:** Docusaurus 3.10, MDX 3, React Router through `@docusaurus/router`, Vitest 3, Playwright 1.61, TypeScript 5.8.

## Global Constraints

- Expose exactly four usage documents in this order: brief, legacy, feature, Figma.
- Use `/usage/brief`, `/usage/legacy`, `/usage/feature`, and `/usage/figma`; English uses the same paths under `/en`.
- Show no combined overview or case tabs in the sidebar or navbar.
- Keep `/usage/recipes` and `/en/usage/recipes` only as hidden redirects to the locale-equivalent brief page.
- Preserve all eleven sections and all delivery/evidence rules already documented for each case.
- Feature alone automatically requires one targeted Playwright invocation and exactly one valid WebM or MP4; full-project E2E remains rejected.
- Any supplied Figma URL requires real connected-host Figma evidence; Figma mode defaults to `publication: none`.
- Keep workload/token/confidence, 80% checkpoint, and unchanged `requiredValidations` behavior documented on every page.
- Keep Korean and English semantically equivalent while leaving runtime field names and example paths unchanged.
- Do not add a dependency, workflow tool, stage, mode, skill, reviewer, generated image, documentation video, deployment, release, push, or PR.

---

### Task 1: Split the bilingual content and preserve redirects

**Files:**

- Create: `website/docs/usage/brief.mdx`
- Create: `website/docs/usage/legacy.mdx`
- Create: `website/docs/usage/feature.mdx`
- Create: `website/docs/usage/figma.mdx`
- Modify: `website/docs/usage/recipes.mdx`
- Create: `website/i18n/en/docusaurus-plugin-content-docs/current/usage/brief.mdx`
- Create: `website/i18n/en/docusaurus-plugin-content-docs/current/usage/legacy.mdx`
- Create: `website/i18n/en/docusaurus-plugin-content-docs/current/usage/feature.mdx`
- Create: `website/i18n/en/docusaurus-plugin-content-docs/current/usage/figma.mdx`
- Modify: `website/i18n/en/docusaurus-plugin-content-docs/current/usage/recipes.mdx`
- Test: `tests/plugin/documentation-v2.test.ts`

**Interfaces:**

- Consumes: the four `<TabItem>` bodies and eleven stable section IDs in the current Korean and English recipes documents.
- Produces: eight case pages with identical case IDs across locales plus two redirect-only compatibility routes used by Tasks 2–3.

- [ ] **Step 1: Replace the combined-guide test with a failing separate-page contract**

Replace `documents exactly four detailed cases in Korean and English` in `tests/plugin/documentation-v2.test.ts` with:

```ts
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
      expect(guide).toContain(locale === "ko" ? "## 다른 사용법" : "## Other usage cases");
      expect(guide.match(/\]\((?:\/en)?\/usage\/(?:brief|legacy|feature|figma)\)/g)).toHaveLength(
        3,
      );
    }

    expect(Object.values(guides).join("\n")).toContain("implementationContextId");
    expect(guides.feature).toContain("targeted-feature");
    expect(guides.feature).toContain("featureVideo: required");
    expect(guides.feature).toContain("full-project E2E");
    expect(guides.figma).toContain("figma-bundle");
    expect(guides.figma).toContain("publication: none");
    for (const caseName of ["brief", "legacy", "figma"]) {
      expect(guides[caseName]).not.toContain("featureVideo: required");
    }
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

  expect(redirects.ko).toContain('<Redirect to="/usage/brief" />');
  expect(redirects.en).toContain('<Redirect to="/en/usage/brief" />');
  for (const redirect of Object.values(redirects)) {
    expect(redirect).toContain('import { Redirect } from "@docusaurus/router"');
    expect(redirect).not.toContain("## Required inputs");
    expect(redirect).not.toContain("<Tabs");
  }
});
```

Update the compact website inventory in the same test to:

```ts
expect(relativeFiles(path.join(root, "website", "docs"))).toEqual([
  "concepts/pipeline.md",
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
  "usage/legacy.mdx",
  "usage/recipes.mdx",
]);
```

In `documents composable sources, guidance precedence, and the zero-to-100 feature recipe`, change the recipe read to:

```ts
const recipe = readFileSync(path.join(root, "website/docs/usage/feature.mdx"), "utf8");
```

Remove the `tabSection` helper because no test reads a tab body after this change.

- [ ] **Step 2: Run the separate-page contract and confirm RED**

Run:

```bash
pnpm vitest run tests/plugin/documentation-v2.test.ts -t "four separate usage cases|redirect-only compatibility"
```

Expected: FAIL because `brief.mdx`, `legacy.mdx`, `feature.mdx`, and `figma.mdx` do not exist and recipes still renders tabs.

- [ ] **Step 3: Split the Korean guide into four documents**

For each value in the current `website/docs/usage/recipes.mdx`, move the full content between its `<TabItem ...>` and `</TabItem>` tags into the matching file. Remove the marker `<span data-case-panel="...">`, retain all eleven heading anchors, tables, code blocks, blockers, and exclusions, and add this exact frontmatter:

```mdx
## <!-- website/docs/usage/brief.mdx -->

sidebar_position: 1
title: 1. 기획서 → draft PR
description: 기획서의 수용 조건을 구현하고 검증해 draft PR로 받는 방법

---

## <!-- website/docs/usage/legacy.mdx -->

sidebar_position: 2
title: 2. 레거시 변경 → draft PR
description: 기존 동작의 focused baseline을 남기고 좁은 delta만 변경하는 방법

---

## <!-- website/docs/usage/feature.mdx -->

sidebar_position: 3
title: 3. 기능 개발 → E2E·영상·draft PR
description: API와 UI를 구현하고 해당 기능 E2E와 영상 하나를 포함해 draft PR로 받는 방법

---

## <!-- website/docs/usage/figma.mdx -->

sidebar_position: 4
title: 4. Figma → 디자인 구현
description: 실제 Figma 증거로 디자인을 구현하고 검증하는 방법

---
```

Prepend this common intake paragraph after each page title/opening paragraph and before its first case section:

```md
Intake 직후 `XS`~`XL` workload, 예상 token range, confidence와 근거가 표시됩니다. 이는 고정 약속이 아닙니다. 80% 경계에서는 checkpoint와 compact context로 이어가며, 한계에 도달해도 `requiredValidations`를 빼지 않고 범위를 나누거나 사용자의 결정을 기다립니다.
```

Append exactly three links under `## 다른 사용법` and exclude the current page. Use these labels and routes:

```md
- [기획서 → draft PR](/usage/brief)
- [레거시 변경 → draft PR](/usage/legacy)
- [기능 개발 → E2E·영상·draft PR](/usage/feature)
- [Figma → 디자인 구현](/usage/figma)
```

For example, `brief.mdx` receives the legacy, feature, and Figma links; `feature.mdx` receives brief, legacy, and Figma. Do not retain the shared comparison table, Mermaid flow, `Tabs`/`TabItem` imports, or tab wrapper elements.

- [ ] **Step 4: Split the English guide with semantic parity**

Move each English `<TabItem>` body into the same four filenames under `website/i18n/en/docusaurus-plugin-content-docs/current/usage`. Remove the marker span and tab wrappers, retain all eleven heading anchors and case content, and use:

```mdx
## <!-- brief.mdx -->

sidebar_position: 1
title: 1. Brief → draft PR
description: Implement an approved brief, verify it, and receive a draft PR

---

## <!-- legacy.mdx -->

sidebar_position: 2
title: 2. Legacy change → draft PR
description: Capture a focused baseline and change only a narrow legacy behavior delta

---

## <!-- feature.mdx -->

sidebar_position: 3
title: 3. Feature → E2E, video, and draft PR
description: Implement API and UI with targeted feature E2E and exactly one video

---

## <!-- figma.mdx -->

sidebar_position: 4
title: 4. Figma → design implementation
description: Implement and verify a design from real connected-host Figma evidence

---
```

Add this common paragraph to every English page:

```md
Immediately after intake, status reports an `XS`–`XL` workload, estimated token range, confidence, and reasons. These are estimates, not fixed promises. At the 80% boundary SpecToPR checkpoints and continues from compact context; at the hard limit it splits scope or waits for a user decision without removing anything from `requiredValidations`.
```

Append exactly three links under `## Other usage cases`, excluding the current page:

```md
- [Brief → draft PR](/en/usage/brief)
- [Legacy change → draft PR](/en/usage/legacy)
- [Feature → E2E, video, and draft PR](/en/usage/feature)
- [Figma → design implementation](/en/usage/figma)
```

- [ ] **Step 5: Replace both recipes documents with redirect-only shims**

Use this complete Korean file:

```mdx
---
title: 사용법으로 이동
pagination_next: null
pagination_prev: null
---

import { Redirect } from "@docusaurus/router";

<Redirect to="/usage/brief" />
```

Use this complete English file:

```mdx
---
title: Redirecting to usage
pagination_next: null
pagination_prev: null
---

import { Redirect } from "@docusaurus/router";

<Redirect to="/en/usage/brief" />
```

- [ ] **Step 6: Run the focused documentation tests and builds**

Run:

```bash
pnpm vitest run tests/plugin/documentation-v2.test.ts
pnpm --dir website typecheck
pnpm --dir website build --locale ko
pnpm --dir website build --locale en
```

Expected: 7 documentation tests pass, typecheck exits 0, and both locale builds succeed without broken links.

- [ ] **Step 7: Commit the split documents**

```bash
git add tests/plugin/documentation-v2.test.ts website/docs/usage website/i18n/en/docusaurus-plugin-content-docs/current/usage
git commit -m "docs: split usage cases into separate pages"
```

---

### Task 2: Expose four navigation items and update maintained links

**Files:**

- Modify: `website/sidebars.ts`
- Modify: `website/docusaurus.config.ts`
- Modify: `website/i18n/en/docusaurus-theme-classic/navbar.json`
- Modify: `README.md`
- Modify: `README.ko.md`
- Modify: `website/docs/getting-started/quickstart.md`
- Test: `tests/plugin/documentation-v2.test.ts`

**Interfaces:**

- Consumes: the eight case routes and hidden recipes redirects from Task 1.
- Produces: four visible sidebar entries, a locale-aware brief navbar/footer entry, and maintained direct links used by Task 3.

- [ ] **Step 1: Add the failing navigation and link contract**

Add this test to `tests/plugin/documentation-v2.test.ts`:

```ts
it("links directly to four separate usage pages", () => {
  const sidebar = readFileSync(path.join(root, "website/sidebars.ts"), "utf8");
  const config = readFileSync(path.join(root, "website/docusaurus.config.ts"), "utf8");
  const navbar = JSON.parse(
    readFileSync(path.join(root, "website/i18n/en/docusaurus-theme-classic/navbar.json"), "utf8"),
  ) as Record<string, { message: string }>;
  const maintained = [
    readFileSync(path.join(root, "README.md"), "utf8"),
    readFileSync(path.join(root, "README.ko.md"), "utf8"),
    readFileSync(path.join(root, "website/docs/getting-started/quickstart.md"), "utf8"),
    config,
  ].join("\n");

  expect(sidebar).toContain(
    'items: ["usage/brief", "usage/legacy", "usage/feature", "usage/figma"]',
  );
  expect(sidebar).not.toContain('items: ["usage/recipes"]');
  expect(config).toContain('{ to: "/usage/brief", position: "left", label: "사용법" }');
  expect(config).toContain('{ label: "사용법", to: "/usage/brief" }');
  expect(navbar["item.label.사용법"]?.message).toBe("Usage");
  expect(maintained).not.toContain("/usage/recipes");
  expect(readFileSync(path.join(root, "README.md"), "utf8")).toContain(
    "https://dhyun2.github.io/spec-to-pr/en/usage/brief",
  );
  expect(readFileSync(path.join(root, "README.ko.md"), "utf8")).toContain(
    "https://dhyun2.github.io/spec-to-pr/usage/brief",
  );
});
```

Update the locale-shell assertion from the old navbar key to:

```ts
expect(navbar["item.label.사용법"]?.message).toBe("Usage");
```

- [ ] **Step 2: Run the navigation contract and confirm RED**

Run:

```bash
pnpm vitest run tests/plugin/documentation-v2.test.ts -t "links directly to four separate usage pages"
```

Expected: FAIL because sidebar, navbar, footer, and maintained links still target recipes.

- [ ] **Step 3: Update the sidebar, navbar, footer, and English navbar label**

Change the `사용법` category in `website/sidebars.ts` to this single-line item list:

```ts
{
  type: "category",
  label: "사용법",
  collapsed: false,
  items: ["usage/brief", "usage/legacy", "usage/feature", "usage/figma"],
},
```

In `website/docusaurus.config.ts`, change the navbar and footer usage entries exactly to:

```ts
{ to: "/usage/brief", position: "left", label: "사용법" },
```

```ts
{ label: "사용법", to: "/usage/brief" },
```

In `website/i18n/en/docusaurus-theme-classic/navbar.json`, replace `item.label.4개 케이스` with:

```json
"item.label.사용법": {
  "message": "Usage",
  "description": "Navbar item with label 사용법"
}
```

- [ ] **Step 4: Update every maintained direct link**

Apply these exact replacements:

```text
README.md:
https://dhyun2.github.io/spec-to-pr/en/usage/recipes
→ https://dhyun2.github.io/spec-to-pr/en/usage/brief

README.ko.md:
https://dhyun2.github.io/spec-to-pr/usage/recipes
→ https://dhyun2.github.io/spec-to-pr/usage/brief

website/docs/getting-started/quickstart.md:
[4가지 케이스 상세 가이드](/usage/recipes)
→ [기획서 → draft PR 사용법](/usage/brief)
```

- [ ] **Step 5: Run navigation tests and both locale builds**

Run:

```bash
pnpm vitest run tests/plugin/documentation-v2.test.ts
pnpm --dir website typecheck
pnpm --dir website build
```

Expected: 8 documentation tests pass; the sidebar IDs resolve in both locales; both production locales build without broken links.

- [ ] **Step 6: Commit navigation synchronization**

```bash
git add README.md README.ko.md website/sidebars.ts website/docusaurus.config.ts website/i18n/en/docusaurus-theme-classic/navbar.json website/docs/getting-started/quickstart.md tests/plugin/documentation-v2.test.ts
git commit -m "docs: expose four usage pages"
```

---

### Task 3: Replace tab regression with page and redirect regression

**Files:**

- Modify: `tests/browser/four-case-guide.mjs`

**Interfaces:**

- Consumes: locale-specific case routes and redirect routes from Tasks 1–2.
- Produces: `pnpm guide:check`, covering eight pages, four sidebar links, locale alternatives, two redirects, desktop/mobile overflow, and console errors.

- [ ] **Step 1: Change the browser test to the new route matrix and confirm RED**

Replace the whole `tests/browser/four-case-guide.mjs` with:

```js
import assert from "node:assert/strict";

import { chromium } from "playwright";

const origin = process.env.GUIDE_BASE_URL ?? "http://127.0.0.1:3000/spec-to-pr";
const cases = [
  { value: "brief", ko: "1. 기획서 → draft PR", en: "1. Brief → draft PR" },
  { value: "legacy", ko: "2. 레거시 변경 → draft PR", en: "2. Legacy change → draft PR" },
  {
    value: "feature",
    ko: "3. 기능 개발 → E2E·영상·draft PR",
    en: "3. Feature → E2E, video, and draft PR",
  },
  { value: "figma", ko: "4. Figma → 디자인 구현", en: "4. Figma → design implementation" },
];
const locales = [
  { name: "ko", prefix: "", titleKey: "ko", alternativePrefix: "/en" },
  { name: "en", prefix: "/en", titleKey: "en", alternativePrefix: "" },
];
const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
];

const browser = await chromium.launch({ headless: true });
try {
  for (const locale of locales) {
    for (const testCase of cases) {
      for (const viewport of viewports) {
        const page = await browser.newPage({ viewport });
        const errors = [];
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
        page.on("pageerror", (error) => errors.push(error.message));

        await page.goto(`${origin}${locale.prefix}/usage/${testCase.value}`, {
          waitUntil: "networkidle",
        });
        await page.getByRole("heading", { level: 1, name: testCase[locale.titleKey] }).waitFor();
        await page.locator(`#use-this-case-${testCase.value}`).locator("..").waitFor();
        assert.equal(await page.getByRole("tab").count(), 0);

        if (viewport.name === "desktop") {
          const usageLinks = page.locator('nav.menu a.menu__link[href*="/usage/"]');
          assert.equal(await usageLinks.count(), 4, `${locale.name}:sidebar usage links`);
        }
        assert.ok(
          (await page
            .locator(`a[href*="/spec-to-pr${locale.alternativePrefix}/usage/${testCase.value}"]`)
            .count()) > 0,
          `${locale.name}:${testCase.value}:locale link`,
        );

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        assert.ok(
          overflow <= 1,
          `${locale.name}:${testCase.value}:${viewport.name}:horizontal overflow ${overflow}px`,
        );
        assert.deepEqual(
          errors,
          [],
          `${locale.name}:${testCase.value}:${viewport.name}:console errors`,
        );
        await page.close();
      }
    }
  }

  const redirectPage = await browser.newPage();
  for (const redirect of [
    { from: `${origin}/usage/recipes`, to: "/spec-to-pr/usage/brief" },
    { from: `${origin}/en/usage/recipes`, to: "/spec-to-pr/en/usage/brief" },
  ]) {
    await redirectPage.goto(redirect.from, { waitUntil: "networkidle" });
    await redirectPage.waitForURL((url) => url.pathname === redirect.to);
  }
  await redirectPage.close();
} finally {
  await browser.close();
}
```

Run it against the current combined guide:

```bash
python3 /Users/dhp94d/.codex/skills/webapp-testing/scripts/with_server.py \
  --server "pnpm --dir website serve --no-open --host 127.0.0.1 --port 3000" \
  --port 3000 \
  -- pnpm guide:check
```

Expected: FAIL because the `/usage/brief` case routes are not in the current build or current recipes still renders tabs.

- [ ] **Step 2: Rebuild and run the page regression GREEN**

Run:

```bash
pnpm --dir website build
python3 /Users/dhp94d/.codex/skills/webapp-testing/scripts/with_server.py \
  --server "pnpm --dir website serve --no-open --host 127.0.0.1 --port 3000" \
  --port 3000 \
  -- pnpm guide:check
```

Expected: PASS for 2 locales × 4 pages × 2 viewports, four desktop sidebar items, locale-equivalent links, both recipes redirects, zero page-level overflow, and zero console/page errors.

- [ ] **Step 3: Commit browser regression coverage**

```bash
git add tests/browser/four-case-guide.mjs
git commit -m "test: verify separate usage pages"
```

- [ ] **Step 4: Run complete repository verification**

Run:

```bash
pnpm check
pnpm plugin:validate
pnpm --dir website build
python3 /Users/dhp94d/.codex/skills/webapp-testing/scripts/with_server.py \
  --server "pnpm --dir website serve --no-open --host 127.0.0.1 --port 3000" \
  --port 3000 \
  -- pnpm guide:check
git diff --check
git status --short
```

Expected: all commands exit 0; 265 tests pass; both locales build; browser regression passes; the worktree is clean.

## Final acceptance checklist

- [ ] `사용법` / `Usage` visibly contains exactly four independent pages and no combined guide.
- [ ] Every Korean and English page retains its eleven sections, prompts, process, evidence, expected result, blockers, and exclusions.
- [ ] Feature alone promises targeted E2E and exactly one video.
- [ ] Figma defaults to implementation-only and requires real connected-host evidence.
- [ ] Every page links to the other three pages without reintroducing tabs.
- [ ] Maintained links target the brief page, never recipes.
- [ ] Both old recipes URLs redirect to the locale-equivalent brief page.
- [ ] Static contracts, repository checks, plugin validation, both-locale builds, and browser checks pass.
