# ADR 037: Use boundary budgeting and numeric-only calibration

## Status

Accepted.

## Context

The four delivery profiles vary too much for a single fixed token allowance. The runtime must still show an estimate immediately after intake, preserve required verification under pressure, and improve estimates from actual runs. Codex SDK usage is only available after a turn completes; it does not expose a live token counter or a public force-compaction operation.

## Decision

- Classify intake as `XS`, `S`, `M`, `L`, or `XL` and expose a token range, confidence, reasons, and an 80% checkpoint threshold in the existing `workflow_status` response.
- Refine the estimate from optional numeric `workloadSignals` on the existing contracts submission. Do not add an MCP tool, durable stage, skill, reviewer, API lane, or UI lane.
- Instruct SDK automation to stop after one workflow action group per turn and require a fresh structured workflow status after every action turn. After each completed turn, sum `input_tokens + output_tokens`; cached input and reasoning output remain separate dimensions and are not added twice. Caller output schemas apply only to a terminal formatting turn.
- At 80% of the automatic hard limit, save a compact workflow checkpoint and continue in a fresh thread. The compact payload includes effective used, remaining, checkpoint, and hard-limit counters. `workflow_status.resumeContext` carries the recorded goal, project-relative evidence paths, and latest submission summary per kind so the new thread can reconstruct the next action without the original conversation. Bound it to 4,000 goal characters, 200 paths of at most 1,000 characters each (first 50 plus latest 150 on overflow), 16 submission kinds, and 500 characters per summary. Do not expose or copy the unbounded opaque artifact-ID list. Because usage arrives only at turn completion, the threshold is enforced at the first workflow boundary at or above 80%, not during a running turn.
- At the hard limit, stop before another boundary and require an independently verifiable scope split for every workload size. Do not expose a caller-selected token budget. Calibration refines only the displayed estimate; the enforced limit stays at the default maximum for the workload class. Scope splitting never waives or removes required validation.
- Store calibration samples outside the enclosing Git worktree as numeric and enum fields only. Never persist prompts, source text, code, diffs, paths, tool output, or final responses. Ignore legacy samples whose recorded hard limit differs from the workload default. Serialize writes and atomically replace the file so concurrent tasks cannot lose samples. Retain at most 256 samples from the last year in a file no larger than 1 MiB. Revalidate location, regular-file type, and single-link status on every read and write; reject symlinks, hard links, devices, pipes, and oversized files. Use fresh, non-resumed completed matching samples with complete usage to adjust displayed ranges with robust percentiles; a resumed invocation neither reads mode-specific calibration nor records its tail because neither represents authoritative whole-Run usage. Missing usage stops nonterminal continuation, and optional history I/O is best-effort so it cannot reverse completed external work.
- Do not start an optional terminal formatting turn when completed-boundary usage is unavailable or already at the hard limit; if formatting fails, preserve the terminal result, mark usage partial, and expose the `outputFormatting` disposition to the caller.
- Pin the first accepted durable Run ID and stop if a later status reports another Run. The first structured status establishes authoritative required validations; later statuses may add but never remove them. A resumed SDK task calls `workflow_status` for the existing durable Run first. It must not repeat intake or create a duplicate Run.

## Consequences

Estimates are ranges rather than promises. Low-information intake begins with low confidence and becomes more precise after contracts and enough completed historical samples. A single very large turn—or an agent that ignores the one-action-group instruction—can cross one or more boundaries before the SDK observes it. The runner detects the next completed status and starts no following turn without the policy check, but it cannot undo side effects already performed inside that turn.
