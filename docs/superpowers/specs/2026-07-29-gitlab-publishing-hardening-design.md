# GitLab Publishing Hardening and Runtime Reduction

Date: 2026-07-29

## Context

The profile qualifications delivery exposed several workflow defects:

- The design-system contract assumed `@frontend/ui` and mandatory Code Connect even though the
  target used `@lessonpro/ui` and the user requested local Figma MCP only.
- GitLab review images were published with paths that rendered as broken media.
- The feature video initially pointed at a repository artifact that did not exist on the target
  branch, then required manual upload and body repair.
- Video evidence had no image preview and its automated interactions were too fast for human review.
- A screenshot was captured before its color transition completed, making one selected control
  appear visually different.
- Re-publishing evidence created manual correction loops. The draft body, rather than comments,
  should be the single managed evidence surface.
- The default review title exposed an internal Run identifier instead of a human-readable change.
- Repeated diagnosis, capture, upload, and validation made the delivery take too long.

## Goals

1. Publish GitLab image and video evidence with URLs that render in an authenticated merge request.
2. Replace managed evidence blocks in the merge request body without adding repair comments.
3. Re-upload changed evidence and reuse unchanged, digest-bound uploads.
4. Make feature video evidence understandable to a human reviewer.
5. Produce a human-readable default draft title.
6. Ask about the design-system package and Code Connect only when repository evidence and user input
   do not already resolve them.
7. Reduce repeated work without weakening publication, visual, or functional gates.

## Non-goals

- Replacing the existing publisher abstraction.
- Adding a separate evidence hosting service.
- Making unauthenticated private GitLab uploads publicly accessible.
- Removing keyboard focus indicators or product transitions to make screenshots pass.
- Changing the four strict delivery modes.
- Automatically changing a user's commit strategy or force-pushing history.

## Chosen Approach

Use the existing publisher, upload receipt, and managed-body-marker architecture. Harden GitLab URL
normalization and media rendering, extend the feature-video presentation, and add small workflow
guidance for deterministic capture and ambiguity resolution.

This avoids a new storage layer and preserves the current three-way behavior:

1. Reuse a confirmed upload receipt when artifact digest, target, review packet, and reviewed HEAD
   still match.
2. Upload missing or changed assets to the GitLab project.
3. Use the existing digest-verified raw fallback only for eligible committed visual evidence when a
   project upload is unavailable. Never use a target-branch artifact link for feature video.

## Components

### GitLab upload URL normalization

`GitLabPublisherAdapter.publishAssets` will prefer the upload response's `full_path`.

- Accept project-scoped forms such as `/-/project/638/uploads/<secret>/<file>` and
  `/<namespace>/<project>/uploads/<secret>/<file>`.
- Resolve the accepted path against the exact `PublishTarget.webBaseUrl` and store an absolute URL.
- If only `/uploads/<secret>/<file>` is returned and a numeric project ID is known, construct the
  canonical `/-/project/<id>/uploads/<secret>/<file>` route.
- Reject cross-origin URLs, traversal, encoded traversal, whitespace/control characters, missing
  secret/file segments, and ambiguous root-relative upload paths without a numeric project ID.
- Do not reject the `/-/project/<id>/uploads/...` form; it is the expected self-hosted GitLab media
  route.

Published upload receipts store the normalized absolute URL so later body updates reuse the same
renderable form.

### Managed visual and video evidence

Visual evidence continues to use the existing managed markers and side-by-side table.

Feature video rendering will:

- Link to the uploaded WebM or MP4.
- Use the current browser screenshot as a clickable preview when one is available and embeddable.
- Include a separate original-video link.
- Fall back to a plain video link when no safe preview image exists.
- Replace the existing managed feature-video block on every update.

No publisher path will add a repair comment. Create and update operations write the complete managed
body once per publication attempt.

### Evidence freshness and reuse

The existing upload receipt identity remains authoritative. Reuse requires the same host target,
report artifact, optional review packet and HEAD, artifact ID/digest, target ID, and media role.

- A changed screenshot or video digest causes a new upload.
- An unchanged asset on the same reviewed packet/HEAD is reused.
- Body synchronization is verified after the merge request update.
- A stale receipt cannot satisfy a new packet or changed evidence digest.

### Human-readable draft titles

An explicit publish title still wins. Without one, derive the title from the source branch by:

1. Removing a leading `codex/`.
2. Replacing separators with spaces.
3. Collapsing whitespace and applying a bounded readable form.
4. Falling back to a neutral `SpecToPR change` only if no readable branch title exists.

GitLab continues to add one `Draft:` prefix. Internal Run IDs are reserved for blocked diagnostics
and report metadata, not ready-draft titles.

### Capture and interaction guidance

The implementation skill will require reviewer-facing evidence to:

- Wait for fonts, assets, deterministic state, and relevant CSS transitions or animations to settle
  before the final screenshot.
- Keep keyboard focus assertions in executable tests, then remove incidental pointer focus from the
  final comparison capture only when the target state is not a focus state.
- Pace visible feature-video state changes with a short review dwell, normally 500–800 ms.
- Avoid altering production transitions or accessibility focus styles solely for evidence.

These requirements affect evidence generation, not product behavior.

### Design-system and Code Connect ambiguity

The Figma intake contract may support both known packages, but orchestration must not silently choose
one when multiple design-system packages are plausible.

- Honor an explicit user instruction such as `@lessonpro/ui` or “Figma MCP only.”
- If repository evidence resolves exactly one package and Code Connect policy, proceed without a
  question.
- Ask one concise question only when the choice remains ambiguous.
- Code Connect remains optional evidence when the user or repository does not use it.

## Runtime Reduction

- Keep bounded parallel upload concurrency.
- Reuse confirmed upload receipts before making network requests.
- Run focused GitLab publisher, report-rendering, and Figma-contract tests during development.
- Build generated MCP output once after source tests pass.
- Run the repository validation suite once against the final intended source state.
- Avoid manual upload/body-repair loops by failing publication before body mutation when upload
  response normalization is unsafe.
- Do not reacquire Figma, recapture visuals, or rerun target-project checks when their packet-bound
  digest evidence is still current.

## Error Handling

- Malformed or unsafe upload responses return a permanent/uncertain asset failure and do not publish
  a broken URL.
- Transient upload failures retain bounded retries.
- Partial asset synchronization returns a partial/failed publication result; it never claims a
  complete draft.
- A feature video upload failure cannot fall back to a target-branch or default-branch artifact URL.
- Body read-back must contain every normalized published asset URL.

## Testing

Add or update focused tests for:

- `full_path` project-ID and namespace/project routes becoming exact-host absolute URLs.
- `/uploads/...` reconstruction with a numeric project ID.
- rejection of cross-origin, traversal, malformed, and ambiguous upload paths.
- upload receipt reuse for unchanged digests and invalidation for changed digests or packet/HEAD.
- managed visual/video block replacement without duplicate sections or comments.
- clickable screenshot preview plus original WebM/MP4 link.
- plain-link video fallback when no preview image exists.
- human-readable default title and explicit-title precedence.
- optional Code Connect and supported design-system selection without silent ambiguity.
- capture guidance pressure/layout tests for transition settling, focus-state separation, and
  reviewer-visible interaction pacing.

Run focused unit/integration tests first, then format, typecheck, plugin validation, generated-file
checks, and the repository check once.

## Rollout

1. Preserve and review the existing uncommitted `@lessonpro/ui`, optional Code Connect, and GitLab
   configuration changes.
2. Correct any behavior that conflicts with this design, especially rejection of valid
   `/-/project/<id>/uploads/...` routes.
3. Implement tests before production changes.
4. Rebuild `dist/mcp` from the validated source.
5. Validate the plugin and update its cachebuster through the standard local-plugin update helper.
6. Reinstall the plugin from its confirmed local marketplace and verify it in a new Codex task.
