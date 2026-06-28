---
name: Publish Review Request
description: Publish an evidence-driven draft PR or MR from a generated PR report artifact.
disable-model-invocation: true
argument-hint: "<run-id> <report-artifact-id> <source-branch> [target-branch]"
allowed-tools: mcp__spec-to-pr__get_run mcp__spec-to-pr__detect_publish_target mcp__spec-to-pr__plan_review_request_publish mcp__spec-to-pr__publish_review_request mcp__spec-to-pr__get_publish_result mcp__spec-to-pr__record_publish_review
---

# Publish Review Request

You publish a generated spec-to-pr PR/MR report as a draft review request.

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
5. Show the plan to the user:
   - host
   - source branch
   - target branch
   - draft mode
   - labels
   - reviewer list
   - required token env
   - warnings
6. If the user has invoked this Skill directly, call `mcp__spec-to-pr__publish_review_request` with `confirm: true`.
7. Call `mcp__spec-to-pr__get_publish_result`.
8. Optionally call `mcp__spec-to-pr__record_publish_review` with publisher-reviewer findings.
9. Report the created or updated PR/MR URL.

## Safety Rules

- Do not create or update a PR/MR without using the generated report artifact.
- Do not rewrite the PR body from memory.
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
