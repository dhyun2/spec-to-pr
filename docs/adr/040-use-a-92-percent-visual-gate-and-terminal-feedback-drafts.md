# ADR 040: Use a 92% visual gate and terminal feedback drafts

- Status: proposed
- Date: 2026-07-28

## Context

ADR 038 and ADR 039 established a runtime-owned `0.98` visual threshold, three valid
comparisons, retryable implementation repair, and packet-bound native captures. Production
use exposed four problems:

1. `0.98` rejected implementations accepted by the product owner for the current delivery
   profile.
2. A third numeric failure still required a design-review failure before the Run became
   blocked.
3. Blocked visual publication did not reliably bind and render the failed packet's media.
4. Fixed whole-flow repair retries repeated expensive capture and evidence work.

The MobyDick shop implementation also exposed invalid Figma thumbnail geometry, renderer
drift, fixture-state assumptions, missing design-system icon/token mappings, baseline
overlay circularity, and unequal PR/MR media layout.

## Decision

1. The runtime-owned visual threshold for new comparisons is exactly `0.92`.
   Per-target input cannot change the verdict.
2. The automatic lineage retains three valid comparisons total: the initial comparison and
   up to two implementation repairs. Only a complete numeric passed/failed report consumes
   an attempt; acquisition or incomplete processing failures do not.
3. A valid failure on attempts one and two must persist structured failed-target evidence,
   reopen implementation with a retryable repair action, and continue the bounded automatic
   loop without waiting for user feedback.
4. A third valid failure becomes a durable, non-retryable verification blocker immediately.
   The workflow does not request a redundant design-review verdict for that failed score.
5. When draft publication was requested, terminal visual failure uses the existing
   `blocked-diagnostic` intent to create or update the same source/target draft while the
   Run remains blocked.
6. Ready and blocked publication use the same canonical `pr-report-v2.1` structure.
   Blocked visual publication is bound through the report JSON to the exact packet, head,
   visual report, and media artifacts.
7. Each visual preview uses an equal-width baseline/current pair. Diff and overlay are
   separate diagnostics.
8. Figma/native geometry, capture environment, baseline isolation, state fixtures,
   design-system mappings, and focused UI assertions become required evidence concerns.
9. Every valid comparison covers every declared target with fresh current-packet captures.
   A previous packet's actual capture is never passing evidence; target-scoped probes remain
   a future optimization until runtime-verifiable impact and partial-report contracts exist.
10. Runtime reductions remove redundant normalization, browser, reviewer, status, artifact,
    and publication work in measured phases without reducing validation.

## Superseded decisions

This ADR supersedes:

- ADR 038's active `reviewMatchRatio >= 0.98` threshold;
- ADR 039's active `0.98` threshold;
- ADR 039's requirement that three failed comparisons must proceed to reviewer judgment
  before a durable terminal visual blocker;
- any current documentation implying that a terminal failed visual packet cannot be
  published with its comparison media.

ADR 038/039 remain historical records for the behavior they originally introduced.
Their native capture, digest, mask, packet, and evidence-trust requirements remain in force
unless explicitly changed above.

## Consequences

### Positive

- Product acceptance and runtime state agree at `92%`.
- The autonomous Run retains bounded self-repair.
- Terminal failure becomes reviewable without being recorded as passed.
- Failed visual drafts show the exact evidence needed for user feedback.
- The public publish-intent API remains compatible.
- Invalid acquisition and repeated unchanged work no longer waste comparison attempts.

### Negative

- `92%` permits more visual variance than the previous policy, so focused component,
  interaction, accessibility, fixture, and design-system assertions become more important.
- Packet-bound blocked publication expands publication tests and host-specific media paths.
- Existing manifests require compatibility normalization.
- Runtime/SDK/docs/skills/generated artifacts must change together.

### Safety

- A failed score never passes the Run.
- Publication preconditions and uncertain-mutation fencing remain mandatory.
- Historical report thresholds are not rewritten.
- Caller scores, caller verdicts, excessive masks, stale packets, and baseline overlays
  remain invalid evidence.
