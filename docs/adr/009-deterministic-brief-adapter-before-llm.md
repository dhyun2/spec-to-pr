# ADR-009: Deterministic Brief Intake Adapter Before LLM Interpretation

## Status

Accepted

## Context

Product briefs are untrusted input. They may contain normal requirements, vague language, contradictions, or malicious instructions.

If the plugin sends raw brief text directly to a tool-enabled LLM, prompt-injection-like content may influence the actor.

## Decision

Task 08 introduces a deterministic Brief Intake Adapter before any LLM-based interpretation.

The adapter:

- reads a registered Source snapshot when the source is file-backed
- detects the brief source format
- normalizes supported formats into a NormalizedBriefDocument
- extracts candidate requirement blocks
- preserves source Evidence locations
- flags ambiguity as requirement Gap
- flags prompt-injection-like content as security Gap
- flags unsupported brief formats as requirement Gaps

## Why Not Use An LLM First?

LLMs are useful later for synthesis, but the first pass must preserve provenance and isolate untrusted content.

The system should first turn raw brief text into structured, bounded data.

## Consequences

Good:

- Every candidate has line Evidence.
- Ambiguous content is not silently implemented.
- Prompt-injection-like text is recorded but not followed.
- PDF, ticket, URL, HTML, and unknown inputs are not silently ignored.
- Later OpenSpec and Gherkin generation can operate on structured inputs.

Tradeoffs:

- Rule-based classification is conservative.
- Some valid requirements may be classified as notes.
- PDF and ticket extraction are deferred behind explicit unsupported Gaps.
- LLM-assisted refinement is deferred to later tasks.
