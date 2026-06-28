# ADR-0011: Generate Gherkin from OpenSpec Evidence

## Status

Accepted

## Context

Task 14 generates OpenSpec change artifacts from the Evidence Graph.

The next step is to make requirements testable. However, generating executable test code too early would couple the plugin to a specific test framework before the target repository's test stack is fully verified.

## Decision

Task 15 generates Gherkin feature files and a test matrix, but does not generate step definitions or runnable test code.

## Rationale

Gherkin gives a structured behavior specification that can later be mapped to Cucumber, Playwright, Vitest, or project-specific acceptance test tooling.

The test matrix provides machine-readable coverage and automation readiness information.

## Consequences

Good:

- Requirements become scenario-addressable.
- PR reports can show requirement-to-test coverage.
- Later agents receive stable scenario IDs.
- Automation readiness is explicit.

Tradeoffs:

- Generated feature files are not executable by themselves.
- Step definitions are deferred.
- Scenario wording is conservative and may be refined later.
