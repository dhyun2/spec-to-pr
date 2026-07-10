---
name: Publish Review Request
description: Publish an evidence-driven draft PR or MR from a generated PR report artifact.
disable-model-invocation: false
argument-hint: "<run-id> <report-artifact-id> <source-branch> [target-branch]"
allowed-tools: mcp__spec-to-pr__get_run mcp__spec_to_pr__get_run mcp__spec-to-pr__detect_publish_target mcp__spec_to_pr__detect_publish_target mcp__spec-to-pr__plan_review_request_publish mcp__spec_to_pr__plan_review_request_publish mcp__spec-to-pr__publish_review_request mcp__spec_to_pr__publish_review_request mcp__spec-to-pr__update_review_request_body mcp__spec_to_pr__update_review_request_body mcp__spec-to-pr__get_publish_result mcp__spec_to_pr__get_publish_result mcp__spec-to-pr__record_publish_review mcp__spec_to_pr__record_publish_review
---

# Publish Review Request

## MCP Tool Namespace

Tool names in this skill are written without the host prefix. Use the namespace exposed in the current host:

- Codex: `mcp__spec_to_pr__<tool>`
- Claude Code: `mcp__spec-to-pr__<tool>`

You publish a generated spec-to-pr PR/MR report as a draft review request.

Publishing means creating or updating a GitHub Pull Request or GitLab Merge Request.
It never means merging, approving, closing, or marking the request ready for review.

## Inputs

Expected arguments:

```text
<run-id> <report-artifact-id> <source-branch> [target-branch]
```

Default target branch is `main`.

## Procedure

1. Call `get_run`.
2. Confirm the report artifact exists.
3. Call `detect_publish_target`.
4. Call `plan_review_request_publish`.
5. Summarize the plan:
   - host
   - source branch
   - target branch
   - draft mode
   - report decision
   - labels
   - reviewer list
   - required token env
   - warnings
6. If the plan says the report decision is blocked or `willCreateOrUpdate` is false, stop before creating or updating a review request through `publish_review_request` and report the blocking gates.
   - If an existing draft PR/MR number or IID is already known and the user explicitly asked to sync the generated report body anyway, call `update_review_request_body` with `allowBlockedBody: true` or `publishMode: "blocked-draft-update"`.
   - This exception is for body synchronization only; the generated body must still show the blocked decision and failed gates.
7. If the user invoked this Skill directly, or an end-to-end workflow reached this Skill, call `publish_review_request` with `confirm: true`. Do not stop after planning.
8. Confirm the generated PR/MR body contains the review scorecard section (`Review Scorecard` or `리뷰 점수표`) and no scorecard dimension below the normalized minimum threshold is hidden from the body.
9. If visual comparison PNG artifacts exist, confirm the publish result includes uploaded visual assets and the PR/MR body includes `Visual Evidence Preview` or `시각 증거 미리보기`, matching the report language.
10. Call `get_publish_result`.
11. Verify `requestSynced: true`. If `visualPreviewExpected: true`, verify `visualPreviewSynced: true`. If either sync flag is false, report the publish result as failed/blocked and do not describe the PR/MR as successfully published, even if a URL exists.
12. Optionally call `record_publish_review` with publisher-reviewer findings.
13. Report the created or updated PR/MR URL only together with body sync and visual evidence sync status.

## Safety Rules

- Do not create or update a PR/MR without using the generated report artifact.
- Do not create a new PR/MR from a blocked report.
- Do not use `publish_review_request` for a blocked report.
- Do not treat a Git push-option-created MR, host side effect, or manually edited body as plugin publish success.
- You may update an existing draft PR/MR body with a blocked generated report only when the caller supplied the review request number/IID and explicitly allowed `allowBlockedBody: true` or `publishMode: "blocked-draft-update"`.
- Do not publish when mandatory gate evidence is missing; the PR report decision must already reflect that as blocked.
- Do not publish when the generated body lacks the review scorecard section or hides a scorecard dimension below the normalized minimum threshold.
- Do not rewrite the PR body from memory.
- It is allowed for the publisher to inject uploaded visual evidence image links into the generated body.
- If generated body synchronization or required visual evidence upload synchronization fails, keep the publish result failed/blocked.
- GitHub/GitLab API updates require a token from env or the authenticated host CLI (`gh auth token` or `glab auth token`). Git remotes, credential helpers, or browser sessions alone are not treated as API authentication.
- Do not print tokens.
- Do not mark ready for review unless explicitly requested.
- Do not merge.
- Do not approve.

## Report

Return:

- host
- PR/MR URL
- number or IID
- draft status
- created or updated
- body sync status
- visual evidence sync status
- report artifact ID
- uploaded visual asset URLs, if any

## Host Compatibility And Subagent Fallback

Subagent names differ by host:

- Claude Code: the agents defined in `agents/` (for example `design-ui`, `api-contract`, `spec-bdd`, `integrator`, `review-council`, and the `*-reviewer` agents).
- Codex: the same agents are defined in `.codex/agents/` as `spec-to-pr-<name>` (for example `spec-to-pr-design-ui`).

If the host does not support named subagents, or a matching agent is not available, do not skip the lane. Perform the same instructions inline in the current thread and record the outcome with the same `record_*` MCP tool. Sequential in-thread execution is the supported fallback and must still produce the same structured result and evidence.
