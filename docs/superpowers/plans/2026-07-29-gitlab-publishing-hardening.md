# GitLab Publishing Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make self-hosted GitLab draft publication render current screenshots and feature video
reliably, use readable titles, honor project-selected Figma integration, and avoid redundant
capture/upload/validation work.

**Architecture:** Retain the existing publisher adapter, upload receipt cache, and managed Markdown
blocks. Normalize GitLab upload responses at the adapter boundary, compose video previews in the
application publisher, and express capture/ambiguity policy in the stage skills. Existing
uncommitted `@lessonpro/ui`, optional Code Connect, and self-hosted GitLab configuration changes are
reviewed in place rather than replaced wholesale.

**Tech Stack:** TypeScript 5.9, Node.js 22, Zod 4, Vitest 3, tsup, Codex plugin skills.

## Global Constraints

- Preserve unrelated worktree changes and never reset the existing uncommitted implementation.
- Accept `@frontend/ui` and `@lessonpro/ui`; ask once only when repository and user evidence remain
  ambiguous.
- Code Connect is optional when the user requests Figma MCP only or the repository does not use it.
- GitLab project uploads are the primary media store; feature video never falls back to a
  target/default-branch artifact URL.
- Store only exact-host HTTPS absolute URLs in new upload receipts.
- Update managed MR body blocks; do not add repair comments.
- Wait for visual transitions to settle and pace reviewer-visible feature actions by 500–800 ms.
- Reuse matching digest/packet/HEAD upload receipts and keep bounded parallel uploads.
- Build generated output once after focused source tests pass, then run final repository validation
  once.

---

### Task 1: Complete project-selected Figma contract support

**Files:**
- Modify: `src/figma/figma-capture-contract.ts`
- Modify: `src/application/workflow-service.ts`
- Modify: `src/workflow/workflow-contracts.ts`
- Modify: `src/visual/capture-receipt.ts`
- Modify: `skills/intake-contracts/SKILL.md`
- Test: `tests/unit/figma-design-mapping.test.ts`
- Test: `tests/unit/figma-capture-contract.test.ts`
- Test: `tests/plugin/layout.test.ts`

**Interfaces:**
- Consumes: existing `FigmaPublicApiCatalogSchema`, `FigmaDesignMappingSchema`, and
  `FigmaBundleSubmissionSchema`.
- Produces: catalogs for package name `"@frontend/ui" | "@lessonpro/ui"`, optional
  `codeConnectManifest`, digest-bound `publicSources`, and explicit ambiguity guidance.

- [ ] **Step 1: Add failing skill-policy assertions**

Add assertions to `tests/plugin/layout.test.ts` that `skills/intake-contracts/SKILL.md` contains the
following policy:

```ts
expect(intake).toContain("Honor an explicit design-system package");
expect(intake).toContain("Code Connect is optional");
expect(intake).toContain("ask one concise question");
```

- [ ] **Step 2: Run focused tests and confirm the new policy assertion fails**

Run:

```bash
pnpm vitest run tests/plugin/layout.test.ts tests/unit/figma-design-mapping.test.ts tests/unit/figma-capture-contract.test.ts
```

Expected: the new layout assertion fails because the skill does not yet state the ambiguity policy.
Existing WIP Figma tests may expose additional schema inconsistencies; record and fix those in this
task only.

- [ ] **Step 3: Complete the schema and workflow implementation**

Keep the current package-aware module allowlist and optional Code Connect changes. Ensure:

```ts
type DesignSystemPackageName = "@frontend/ui" | "@lessonpro/ui";

function publicModulesForPackage(packageName: DesignSystemPackageName): readonly string[] {
  return packageName === "@frontend/ui"
    ? ["@frontend/ui", "@frontend/ui/icons/vue", "@frontend/ui/icons/react"]
    : ["@lessonpro/ui", "@lessonpro/ui/icons"];
}
```

All catalog evidence enumeration must include `packageManifest`, `publicBarrels`, `publicSources`,
and the optional `codeConnectManifest` only when present. A Figma-provided font without a binary
digest remains informative and must not fabricate a digest.

- [ ] **Step 4: Add the ambiguity policy to intake guidance**

Add concise guidance to `skills/intake-contracts/SKILL.md`:

```markdown
Honor an explicit design-system package or a request such as “Figma MCP only.” Code Connect is
optional. If repository evidence resolves exactly one package and Code Connect policy, proceed
without asking; otherwise ask one concise question before constructing the Figma bundle.
```

- [ ] **Step 5: Run the focused tests**

Run the Step 2 command.

Expected: all selected tests pass.

- [ ] **Step 6: Commit the completed Figma contract slice**

```bash
git add src/figma/figma-capture-contract.ts src/application/workflow-service.ts \
  src/workflow/workflow-contracts.ts src/visual/capture-receipt.ts \
  skills/intake-contracts/SKILL.md tests/unit/figma-design-mapping.test.ts \
  tests/unit/figma-capture-contract.test.ts tests/plugin/layout.test.ts
git commit -m "feat: support project-selected Figma contracts"
```

---

### Task 2: Normalize self-hosted GitLab upload URLs

**Files:**
- Modify: `src/publisher/gitlab-publisher.ts`
- Modify: `.codex-plugin/plugin.json`
- Test: `tests/unit/gitlab-publisher.test.ts`
- Test: `tests/unit/remote-detector.test.ts`
- Test: `tests/plugin/layout.test.ts`

**Interfaces:**
- Consumes: `PublishTarget.webBaseUrl`, optional numeric `PublishTarget.projectId`, GitLab upload
  response `{ full_path?, url? }`.
- Produces: `PublishedReviewAsset.url` as an exact-host absolute HTTPS URL.

- [ ] **Step 1: Replace the incorrect internal-route test with failing normalization cases**

In `tests/unit/gitlab-publisher.test.ts`, require:

```ts
expect(published.asset.url).toBe(
  "https://gitlab.golfzon.local/-/project/638/uploads/abc123/figma.png",
);
```

Cover these inputs:

```ts
{ full_path: "/-/project/638/uploads/abc123/figma.png" }
{ full_path: "/frontend/react-workspace/web/uploads/abc123/figma.png" }
{ url: "/uploads/abc123/figma.png" } // only when target.projectId === "638"
```

Also add table cases rejecting `https://attacker.test/uploads/...`, `%2e%2e`, backslashes, control
characters, and `/uploads/...` when no numeric project ID is available.

- [ ] **Step 2: Run the GitLab tests and verify they fail for the expected URL mismatch**

Run:

```bash
pnpm vitest run tests/unit/gitlab-publisher.test.ts
```

Expected: current code returns relative paths or rejects the valid
`/-/project/638/uploads/...` path.

- [ ] **Step 3: Implement exact-host absolute URL normalization**

Replace `projectRelativeUploadPath` with a helper shaped as:

```ts
function gitLabUploadUrl(input: {
  fullPath: unknown;
  relativePath: unknown;
  target: PublishTarget;
}): string | undefined
```

The helper must:

1. Prefer a safe root-relative `fullPath`.
2. If only `/uploads/...` is safe and `target.projectId` is numeric, prepend
   `/-/project/${target.projectId}`.
3. Resolve against `target.webBaseUrl`.
4. Require HTTPS, exact hostname, no credentials/query/fragment, and at least secret/file segments
   after `uploads`.
5. Reject decoded traversal and malformed encoding.

Call it from `publishAssets` and store the returned absolute URL.

- [ ] **Step 4: Review self-hosted plugin configuration without widening host authority**

Keep only configuration that is required for the confirmed self-hosted GitLab target. Add plugin
layout/remote-detector assertions proving that any configured web/API base uses the exact remote
hostname and that GitHub/SaaS behavior is not silently redirected. If the hardcoded manifest values
would force unrelated remotes to GitLab, remove them and retain the existing explicit preflight
environment contract instead.

- [ ] **Step 5: Run focused GitLab and plugin configuration tests**

Run:

```bash
pnpm vitest run tests/unit/gitlab-publisher.test.ts tests/unit/remote-detector.test.ts tests/plugin/layout.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit the GitLab URL slice**

```bash
git add src/publisher/gitlab-publisher.ts .codex-plugin/plugin.json \
  tests/unit/gitlab-publisher.test.ts tests/unit/remote-detector.test.ts \
  tests/plugin/layout.test.ts
git commit -m "fix: publish renderable GitLab upload URLs"
```

---

### Task 3: Render reviewer-friendly video evidence and titles

**Files:**
- Modify: `src/application/publisher-service.ts`
- Test: `tests/integration/publisher-service.test.ts`

**Interfaces:**
- Consumes: uploaded `e2e-video` asset, current embeddable `browser` visual asset, source branch,
  optional explicit title.
- Produces: one managed feature-video Markdown block and a human-readable ready-draft title.

- [ ] **Step 1: Add failing video-preview tests**

Extend the publisher integration fixture so a ready feature Run has both a browser preview and one
video. Assert the managed block contains:

```md
[![Feature E2E video preview](https://gitlab.example/uploads/current.png)](https://gitlab.example/uploads/current.webm)

[Open the original WebM](https://gitlab.example/uploads/current.webm)
```

For Korean reports, assert the corresponding Korean labels. Publish a second time with changed URLs
and assert the body contains one start marker, one end marker, only the new URLs, and no comment
operation.

- [ ] **Step 2: Add failing title tests**

Call `publisherService.plan` without `title` using source branch
`codex/profile-qualifications-lesson-availability`. Assert:

```ts
expect(plan.payload.title).toBe("Profile qualifications lesson availability");
```

Also assert an explicit title is unchanged and blocked diagnostics retain their blocked title.

- [ ] **Step 3: Run the focused integration tests and confirm failure**

Run:

```bash
pnpm vitest run tests/integration/publisher-service.test.ts
```

Expected: video renders as a plain link and the default title contains the Run ID.

- [ ] **Step 4: Implement preview-aware managed video rendering**

Change the call to:

```ts
body = injectFeatureVideoEvidence({
  body,
  video: videoAsset,
  preview: visualAssets.find((asset) => asset.role === "browser" && asset.embeddable),
});
```

The renderer must remove the old marker block, add a clickable image preview when available, always
add an original-video link, escape labels/URLs through existing Markdown/HTML helpers, and fall back
to the current plain link when no preview exists.

- [ ] **Step 5: Implement branch-derived ready titles**

Pass `sourceBranch` into `publishTitle`. Add:

```ts
function titleFromSourceBranch(sourceBranch: string): string {
  const readable = sourceBranch
    .replace(/^codex\//u, "")
    .split(/[._/-]+/u)
    .filter(Boolean)
    .join(" ");
  return readable === ""
    ? "SpecToPR change"
    : `${readable[0]!.toUpperCase()}${readable.slice(1)}`.slice(0, 250);
}
```

Explicit titles and blocked diagnostic titles retain precedence.

- [ ] **Step 6: Run the focused integration tests**

Run the Step 3 command.

Expected: all publisher integration tests pass.

- [ ] **Step 7: Commit the body/title slice**

```bash
git add src/application/publisher-service.ts tests/integration/publisher-service.test.ts
git commit -m "feat: improve draft media previews and titles"
```

---

### Task 4: Stabilize capture evidence and avoid redundant work

**Files:**
- Modify: `skills/implement/SKILL.md`
- Modify: `skills/publish/SKILL.md`
- Test: `tests/plugin/layout.test.ts`
- Test: `tests/integration/publisher-service.test.ts`
- Test: `tests/performance/runtime-reduction.bench.ts`

**Interfaces:**
- Consumes: existing packet/digest-bound evidence and upload receipt identity.
- Produces: deterministic final captures, human-reviewable feature videos, and proof that unchanged
  uploads are reused.

- [ ] **Step 1: Add failing skill-pressure/layout assertions**

Require `skills/implement/SKILL.md` to state:

```ts
expect(implement).toContain("relevant CSS transitions or animations to settle");
expect(implement).toContain("500–800 ms");
expect(implement).toContain("Do not alter production transitions or focus styles");
```

Require `skills/publish/SKILL.md` to state that managed evidence is updated in the draft body and
repair comments are forbidden.

- [ ] **Step 2: Add or tighten upload reuse assertions**

In `tests/integration/publisher-service.test.ts`, publish the identical packet twice and assert the
second call performs zero additional `publishAssets` invocations. Change one artifact digest and
assert only that asset is uploaded.

- [ ] **Step 3: Run the focused policy/reuse tests and confirm the policy test fails**

Run:

```bash
pnpm vitest run tests/plugin/layout.test.ts tests/integration/publisher-service.test.ts
```

Expected: policy assertions fail before skill edits; existing receipt behavior should either pass or
identify a bounded caching defect.

- [ ] **Step 4: Implement capture and publication guidance**

Add explicit instructions to wait for deterministic state, fonts/assets, and relevant transitions;
separate keyboard focus assertions from non-focus comparison captures; dwell 500–800 ms between
visible video state changes; and never alter production focus/transition behavior for evidence.

State that project uploads and managed body replacement are authoritative and that repair comments
must not be created.

- [ ] **Step 5: Preserve or minimally repair receipt caching**

If Step 2 already passes, make no production caching change. If it fails, repair only
`loadPublishedAssetsFromReceipts`/`reviewAssetKey` so exact digest/packet/HEAD matches reuse receipts
and changed evidence does not.

- [ ] **Step 6: Run focused tests and the runtime benchmark check**

Run:

```bash
pnpm vitest run tests/plugin/layout.test.ts tests/integration/publisher-service.test.ts
pnpm bench:runtime
```

Expected: policy and reuse tests pass; no benchmark regression beyond existing thresholds.

- [ ] **Step 7: Commit the deterministic evidence slice**

```bash
git add skills/implement/SKILL.md skills/publish/SKILL.md tests/plugin/layout.test.ts \
  tests/integration/publisher-service.test.ts tests/performance/runtime-reduction.bench.ts \
  src/application/publisher-service.ts
git commit -m "perf: stabilize and reuse review evidence"
```

---

### Task 5: Build, validate, and refresh the local plugin

**Files:**
- Regenerate: `dist/mcp/**`
- Modify through helper: `.codex-plugin/plugin.json`

**Interfaces:**
- Consumes: validated TypeScript source and skills.
- Produces: current generated MCP bundle, validated plugin manifest, updated local-plugin
  cachebuster, and reinstalled `spec-to-pr`.

- [ ] **Step 1: Format and run focused source validation**

Run:

```bash
pnpm format
pnpm typecheck
pnpm vitest run tests/unit/gitlab-publisher.test.ts \
  tests/unit/remote-detector.test.ts \
  tests/unit/figma-design-mapping.test.ts \
  tests/unit/figma-capture-contract.test.ts \
  tests/integration/publisher-service.test.ts \
  tests/plugin/layout.test.ts
```

Expected: formatting completes, typecheck exits zero, selected tests pass.

- [ ] **Step 2: Build generated output once**

Run:

```bash
pnpm build
```

Expected: `dist/mcp` matches the current source and no stale chunk references remain.

- [ ] **Step 3: Run final repository and plugin validation once**

Run:

```bash
pnpm check
pnpm plugin:validate:codex
```

Expected: both commands exit zero.

- [ ] **Step 4: Update the local plugin cachebuster through the required helper**

Run:

```bash
python3 /Users/dhp94d/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py \
  /Users/dhp94d/Desktop/spec-to-pr
```

Expected: the existing base version is preserved and exactly one
`+codex.local-YYYYMMDD-HHMMSS` suffix is present.

- [ ] **Step 5: Revalidate after the cachebuster update**

Run:

```bash
pnpm plugin:validate:codex
git diff --check
git status --short
```

Expected: validation passes and only intended source, skill, generated, manifest, test, design, and
plan files are changed.

- [ ] **Step 6: Commit the generated plugin update**

```bash
git add .codex-plugin/plugin.json dist/mcp
git commit -m "build: refresh hardened spec-to-pr plugin"
```

- [ ] **Step 7: Confirm the local marketplace and reinstall**

Run:

```bash
codex plugin list
codex plugin add spec-to-pr@spec-to-pr
```

Expected: `spec-to-pr` resolves to `/Users/dhp94d/Desktop/spec-to-pr` and reinstall succeeds.

- [ ] **Step 8: Verify the final history and worktree**

Run:

```bash
git log --oneline --decorate -8
git status --short --branch
```

Expected: commits are scoped by task and the worktree contains no unintended changes.
