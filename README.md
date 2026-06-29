# spec-to-pr

Claude Code plugin shell for evidence-driven spec-to-pr automation.

## Release Preparation

Task 33 adds a local release-readiness workflow:

```bash
pnpm release:build 0.1.1 --dry-run
```

The workflow runs eval fixtures, security hardening checks, deterministic package generation, package verification, checksums, a release manifest, and release notes.

It does not publish to npm, upload GitHub Releases, submit to a marketplace, or perform external deployment.
