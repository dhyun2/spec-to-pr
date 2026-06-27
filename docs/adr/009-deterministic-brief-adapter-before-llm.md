# ADR-009: Deterministic Brief Adapter Before LLM Interpretation

## Status

Accepted

## Context

Product briefs are untrusted input. They may contain normal requirements, vague language, contradictions, or malicious instructions.

If the plugin sends raw brief text directly to a tool-enabled LLM, prompt-injection-like content may influence the actor.

## Decision

Task 08 introduces a deterministic Brief Adapter before any LLM-based interpretation.

The adapter:

- reads a registered Source snapshot
- parses Markdown-like structure
- extracts candidate requirement lines
- preserves file-line Evidence
- flags ambiguity as requirement Gap
- flags prompt-injection-like content as security Gap

## Why Not Use An LLM First?

LLMs are useful later for synthesis, but the first pass must preserve provenance and isolate untrusted content.

The system should first turn raw brief text into structured, bounded data.

## Consequences

Good:

- Every candidate has line Evidence.
- Ambiguous content is not silently implemented.
- Prompt-injection-like text is recorded but not followed.
- Later OpenSpec and Gherkin generation can operate on structured inputs.

Tradeoffs:

- Rule-based classification is conservative.
- Some valid requirements may be classified as notes.
- LLM-assisted refinement is deferred to later tasks.
