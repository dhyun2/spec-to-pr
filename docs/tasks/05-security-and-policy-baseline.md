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
