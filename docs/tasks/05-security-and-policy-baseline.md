# Task 05 - Security and Policy Baseline

## Goal

Create the baseline policy layer that protects the workspace, command execution boundary, secret handling, and untrusted document boundary before any real agent execution exists.

## Why This Task Exists

The plugin will eventually read briefs, Figma content, OpenAPI documents, repository files, and agent-generated code.

All of these can contain malicious or accidental instructions.

The system must treat external content as untrusted data and must validate all paths, commands, and log output before using them.

## Non-Goals

- No actual command execution
- No agent runtime
- No Git worktree creation
- No network calls
- No approval UI
- No sandbox runtime
- No secret vault
- No PR publishing

## Policy Areas

- Workspace path validation
- Symlink escape prevention
- Command allowlist and risk classification
- Shell command blocking
- Secret redaction
- Untrusted content wrapping
- Security audit logging

## Definition Of Done

- Path traversal is rejected.
- Absolute paths outside workspace are rejected.
- Symlink escape is rejected.
- Dangerous shell commands are denied.
- Allowed commands are classified as allow, approval-required, or deny.
- Secrets are redacted from text and env-like objects.
- Untrusted source excerpts are wrapped with explicit instruction boundaries.
- Policy decisions can be audited as JSONL.
- MCP policy tools work through stdio integration tests.

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

Expected:

- path policy tests pass
- command policy tests pass
- secret redaction tests pass
- untrusted content tests pass
- MCP policy tools are visible over stdio
- existing Task 01-04 tests still pass

## Known Limitations

- No real command execution yet.
- Approval workflow is represented as a policy verdict only.
- Secret redaction is best-effort and pattern-based.
- Path policy depends on filesystem behavior and symlink support.
- Untrusted content wrappers reduce prompt injection risk but do not fully solve it.
- Sandbox isolation is not implemented in this Task.
