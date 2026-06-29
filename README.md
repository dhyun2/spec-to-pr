# spec-to-pr

Claude Code and Codex plugin shell for evidence-driven spec-to-pr automation.

## Codex

Codex support has two surfaces:

- `.codex-plugin/plugin.json` exposes the installable Codex plugin.
- `packages/codex-sdk` provides a programmatic Codex SDK runner for CI and internal automation.

See `docs/codex/README.md` for local marketplace and SDK runner usage.

End-to-end runs publish the generated PR report as a draft PR/MR when blockers
are clear. Publishing creates or updates the review request body; it does not
merge, approve, close, or mark ready for review.

When visual comparison PNG artifacts exist, publishing uploads them to the
review host and injects a localized visual evidence preview section so reviewers
can see Figma, browser, and diff images directly in the PR/MR body.

## Release Preparation

Task 33 adds a local release-readiness workflow:

```bash
pnpm release:verify
```

The workflow runs eval fixtures, security hardening checks, deterministic package generation, package verification, checksums, a release manifest, and release notes.

It does not publish to npm, upload GitHub Releases, submit to a marketplace, or perform external deployment.

## Release Publishing

Use a dry-run first to inspect the exact command plan:

```bash
pnpm release:publish:dry-run
```

When the plan is right, publish the current package version:

```bash
pnpm release:publish
```

The publish script runs `pnpm check`, `pnpm plugin:validate`, `pnpm release:build <version>
--dry-run`, pushes `main`, creates and pushes the Claude plugin tag, then refreshes local Claude and
Codex marketplace installs. It does not merge any downstream PR/MR.
