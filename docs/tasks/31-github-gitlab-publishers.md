# Task 31 - GitHub and GitLab Publishers

## Goal

Publish the evidence-driven PR/MR report from Task 30 as a draft GitHub Pull Request or GitLab Merge Request.

## Why This Task Exists

Task 30 generates the PR/MR body as a deterministic artifact, but it does not publish it.

Task 31 connects the verified Run ledger to repository hosting services.

## Inputs

- Run ID
- PR report artifact
- integration branch
- target branch
- host target policy
- optional labels/reviewers/assignees

## Outputs

- draft GitHub PR or GitLab MR
- PublishResult artifact
- PublishingAgentResult in Run
- PR/MR URL
- PR/MR number or IID
- host metadata

## Non-Goals

- No automatic merge
- No approval
- No OpenSpec archive
- No secret storage
- No OAuth flow
- No hosting artifact server
- No editing generated report content

## Rules

- Default publish mode is draft.
- Publisher must use Task 30 PR report artifact as body.
- Publisher must not generate a new body from memory.
- Existing open PR/MR for the same source branch should be updated, not duplicated.
- Tokens must come from environment or explicit runtime secret provider.
- Tokens must not be stored in Run, Artifact, stdout, stderr, or PR body.
- Merge is forbidden in this task.

## Definition of Done

- GitHub publish plan can be built.
- GitLab publish plan can be built.
- GitHub adapter creates or updates a draft PR.
- GitLab adapter creates or updates a draft MR.
- PR/MR URL is recorded in Run.
- PublishingAgentResult validates with prUrl and reportArtifactId.
- Skill `/spec-to-pr:publish-review-request` exists.
- Publisher reviewer agent exists.

## Verification

Run:

```bash
pnpm format:check
pnpm typecheck
pnpm schemas:build
pnpm build
pnpm test
pnpm audit
```

Manual live verification requires configured tokens:

```bash
GITHUB_TOKEN=... pnpm test:publisher:github
GITLAB_TOKEN=... pnpm test:publisher:gitlab
```

Do not run live publisher tests in default CI.

## Known Limitations

- GitHub Enterprise and self-hosted GitLab require explicit host config.
- Git push is implemented only for the source branch.
- Publisher does not merge.
- Publisher does not approve.
- Artifact upload to host is not implemented.
- Labels/reviewers support is basic.
- Token storage is not implemented by design.
- Existing PR/MR matching is source branch based.
