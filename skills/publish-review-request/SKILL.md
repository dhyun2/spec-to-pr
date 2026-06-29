---
name: Publish Review Request
description: Publish an evidence-driven draft PR or MR from a generated PR report artifact.
disable-model-invocation: false
argument-hint: "<run-id> <report-artifact-id> <source-branch> [target-branch]"
allowed-tools: mcp__spec-to-pr__get_run mcp__spec-to-pr__detect_publish_target mcp__spec-to-pr__plan_review_request_publish mcp__spec-to-pr__publish_review_request mcp__spec-to-pr__get_publish_result mcp__spec-to-pr__record_publish_review
---

# Publish Review Request

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

1. Call `mcp__spec-to-pr__get_run`.
2. Confirm the report artifact exists.
3. Call `mcp__spec-to-pr__detect_publish_target`.
4. Call `mcp__spec-to-pr__plan_review_request_publish`.
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
6. If the plan says the report decision is blocked or `willCreateOrUpdate` is false, stop and report the blocking gates. Do not publish.
7. If the user invoked this Skill directly, or an end-to-end workflow reached this Skill, call `mcp__spec-to-pr__publish_review_request` with `confirm: true`. Do not stop after planning.
8. If visual comparison PNG artifacts exist, confirm the publish result includes uploaded visual assets and the PR/MR body includes `Visual Evidence Preview`.
9. Call `mcp__spec-to-pr__get_publish_result`.
10. Optionally call `mcp__spec-to-pr__record_publish_review` with publisher-reviewer findings.
11. Report the created or updated PR/MR URL.

## Safety Rules

- Do not create or update a PR/MR without using the generated report artifact.
- Do not publish a blocked report.
- Do not rewrite the PR body from memory.
- It is allowed for the publisher to inject uploaded visual evidence image links into the generated body.
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
- report artifact ID
- uploaded visual asset URLs, if any
