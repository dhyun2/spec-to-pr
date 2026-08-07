# ADR 042: Use progressive evidence gates and reviewer-first drafts for 1.0

- Status: Accepted
- Date: 2026-08-07
- Target release: SpecToPR `1.0.0`

## Context

SpecToPR 0.3.x accumulated two opposite failure modes.

The strict legacy path blocked intake when automatic API resolution could not uniquely match a
dynamic call. Evidence formatting, workspace binding, publication authentication, and internal
OpenSpec paths could therefore stop product implementation even when the legacy source contained
enough information to build most of the feature.

The later fast-legacy path avoided that delay by disabling legacy baseline, inventory, visual
comparison, API coverage, and independent reviews. It also allowed required stages to become
`skipped` or a plugin-owned API Gap to become `waived`. A report could then appear ready without
the UI comparison promised by the installed Skill and plugin description.

The same `0.3.6` version consequently described different behavior in the source policy, dirty
runtime bundle, SDK prompt, installed Skill, README, and plugin manifest. Users could not predict
which workflow would run.

Operational incidents exposed related problems:

- an explicit legacy root named `shop` was confused with a similar sibling named `shopping`;
- five dynamic API calls from one origin were not distinguishable by the automatic matcher;
- manual screenshots were treated as though runtime visual comparison had run;
- GitLab TLS and token failures were discovered only during publication attempts;
- an application login cookie was not a valid GitLab personal access token;
- caller-supplied changed-file evidence disagreed with the actual Git snapshot;
- PR bodies emphasized internal artifacts and stages instead of reviewer decisions.

## Decision

SpecToPR 1.0 adopts progressive evidence gates with a persistent Gap ledger and a reviewer-first
Draft PR.

### 1. Stop only for unsafe writes

The workflow stops before implementation only when it cannot identify a safe writable target,
when a writable or generated-evidence path escapes the repository, when source and target overlap dangerously, or when a
destructive mutation cannot be fenced.

An explicitly supplied external `legacyProjectRoot`, including a canonical `../sandbox_new/...`
path, is allowed as a read-only source. This exception never grants write permission outside the
target repository.

API ambiguity, incomplete request payload knowledge, branch freshness, remote binding, evidence
formatting, Git host authentication, and CA trust are normally structured Gaps. They do not erase
known work and do not stop safe local implementation.

### 2. Preserve exact scope

A new read-only `workflow_plan` canonicalizes and echoes the exact legacy root, target paths,
branches, base SHA, remote, mode, scope, and required gates before creating a Run. Fuzzy sibling
or keyword substitution is forbidden. `workflow_start` consumes the approved plan token exactly
once.

### 3. Separate input mode from validation scope

`legacy`, `brief`, `feature`, and `figma` identify requirement sources. They do not weaken quality
gates. Code scope requires functional review; UI scope requires visual comparison and independent
design/accessibility review. Performance remains conditional on affected or declared sensitive
scope.

The mapping to PR presentation is fixed: `legacy → legacy-migration`,
`brief → brief-delivery`, `feature → feature-flow`, and `figma → figma-ui`. The selected renderer
changes reviewer emphasis only; it cannot select or weaken validation gates. Figma UI is always UI
scope, and every other template requires visual comparison whenever its scope includes UI.

### 4. Make UI comparison mandatory to execute, not mandatory to pass before feedback

Every UI Run must attempt a runtime-owned baseline/current comparison with equivalent route,
state, viewport, fixture, authentication, font, and asset conditions. The report contains the
actual threshold, score, verdict, and baseline/current/diff assets.

Intake freezes the complete route/state/viewport target manifest. Every target must end as
`passed`, `failed`, or `not-run`; a missing target becomes `not-run` plus a visible Gap rather than
silently reducing coverage.

A failed or unavailable comparison is never passed or skipped. It becomes a merge-blocking Gap.
The workflow may still create or update a Draft PR so a reviewer can see the implementation and
failure evidence. It cannot label that Draft verified or recommend merge until the Gap is
resolved or explicitly accepted by an authorized person.

The proposed 1.0 default remains a `92%` review match, a maximum justified `20%` mask, and at most
three valid comparisons. The threshold must be calibrated before release and then sourced from a
single versioned policy.

### 4.1 Require a packet-bound user-flow video for Feature flow

Every `feature-flow` report contains a playable current-packet user-flow video covering the
declared entry state, key interaction, and completion state. A video receipt binds the scenario,
fixture, authentication conditions, head, and digest. Capture redacts tokens and personal data.

Missing, stale, unplayable, or incomplete video evidence becomes `not-run` plus a merge-blocking
Gap. It does not prevent a Draft, but it prevents verified and merge-recommended status. A video
does not replace visual comparison when the Feature has UI scope.

### 5. Keep API uncertainty visible and continue development

The legacy analyzer follows imports, wrappers, environment references, transports, and call sites
as far as evidence allows. A parser failure produces a call-site Gap rather than an intake
blocker. The implementation agent may inspect the legacy code directly and resolve the Gap during
development. Unresolved mutations are not guessed; they are left safe and visible in the Draft.

The policy engine cannot waive its own Gap. Waiver requires an authorized human identity and a
reason.

### 6. Separate execution, verdict, and Gap judgment

- validation `execution` is `executed`, `not-run`, or `skipped`;
- an executed validation `verdict` is `passed`, `failed`, or `changes-requested`;
- Gap `status` is `open`, `resolved`, `assumed`, or `waived`.

A required gate cannot be skipped. A waived Gap may alter a human merge decision but does not
rewrite evidence as passed. An unsafe-write Gap cannot be assumed or waived.

Every validation has a bounded timeout. Tool or reviewer unavailability becomes `not-run` plus a
typed Gap, allowing a truthful report and Draft instead of an indefinite wait.

### 7. Freeze Git truth in the runtime

The runtime computes changed files and the binary diff digest from `baseSha` to `headSha`. Caller
input is not a second authority. Reviews bind to one immutable packet and become stale after code
changes.

### 8. Publish four concise Gap-first Draft templates

The canonical report renders exactly one body: Legacy migration, Brief delivery, Feature flow, or
Figma UI. When unresolved Gaps exist, the body places them immediately below the status line with
their impact and requested reviewer decision. Template-specific content then emphasizes exact
legacy source-to-target mapping, Brief acceptance criteria, Feature flow and video, or Figma
node-to-route mapping.

Every UI body contains visual comparison. Every Feature flow body contains its user-flow video.
Internal/raw logs, Run IDs, token estimates, Skill names, stage/revision details, schema and digest
dumps, empty sections, and empty checklists are excluded from the default body. Raw logs and Run
IDs remain only in workflow status or local evidence; they are not moved into collapsible PR
details.

### 9. Separate development from publication readiness

GitHub/GitLab authentication and TLS preflight run before publication, not before implementation.
Publication verifies the exact host, API identity, project permission, and CA using the same
transport that will publish, before pushing. Cookies are not treated as personal access tokens,
TLS verification is never disabled, secrets are never persisted, and a PR is reported as created
only after host-side verification sets `requestSynced: true`.

### 10. Remove OpenSpec as a user-managed core prerequisite

The core workflow owns its contracts and evidence workspace. A missing OpenSpec directory never
requires a replacement Run. Post-merge OpenSpec integration may remain as an optional adapter,
but it cannot gate implementation, visual comparison, reporting, or Draft publication.

### 11. Pin policy and isolate old Runs

Each Run stores `policyId`, `policyVersion`, `policyDigest`, and resolved requirements. A resume
does not reinterpret them from the current mode. SpecToPR 1.0 uses a new durable store namespace;
0.3.x Runs remain read-only/exportable and are not silently mutated into 1.0 Runs.

### 12. Route neutral roles through one host only

The workflow core stores only `fast`, `build`, and `expert` roles plus the chosen routing
strategy. Codex resolves the default roles as Luna, Terra, and Sol; Claude resolves them as
Haiku, Sonnet, and Opus. The default is `adaptive-verified`.

`pinned` accepts one user-selected model and uses it for every stage, including both independent
reviews, without automatic promotion. `custom` requires all three role models. A Run has exactly
one provider and cannot automatically mix Codex and Claude. These are execution choices, not
evidence waivers: visual comparison, testing, independent review, and Gap rules remain unchanged.

When a requested higher role is unavailable, the host can continue with the next configured role
and persists a quality-reduction Gap containing requested model, actual model, impact, and the
reviewer decision needed for merge. This is never silently reported as equivalent verification.

## Superseded decisions

This ADR supersedes the following portions of earlier ADRs for 1.0 Runs:

- ADR 036 where delivery mode effectively controls whether legacy evidence and reviews apply;
- ADR 038 where complete API resolution can block all legacy implementation;
- ADR 040 where a terminal visual failure blocks the workflow from a reviewer-first Draft path;
- ADR 041 only where concurrency is conditioned on a passing visual score before useful design
  feedback can begin.

The following earlier decisions remain:

- runtime-owned visual metrics and mask validation;
- immutable, packet-bound evidence;
- one implementation writer and independent read-only reviewers;
- parallel functional review and visual work on the same packet;
- idempotent, fenced publication;
- evidence reuse only when dependency and freshness rules allow it.

## Rejected alternatives

### Keep strict intake and require perfect API evidence first

Rejected because tool-parser limits should not prevent implementation of routes, components,
state, types, and confirmed operations already present in legacy source.

### Keep fast legacy and make checks opt-in

Rejected because it silently removes the UI comparison and independent review that define a
trustworthy UI migration.

### Require all checks to pass before any PR exists

Rejected because a Draft is the most useful place to review visual differences and unresolved
Gaps. Merge recommendation remains stricter than Draft creation.

### Treat missing visual evidence as a manual screenshot pass

Rejected because acquisition provenance, equivalent state, runtime metrics, and diff assets are
missing.

### Keep OpenSpec paths in immutable workspace binding

Rejected because internal evidence layout should not make the user restart a correctly scoped
Run.

### Automatically migrate all 0.3.x Runs in place

Rejected because old skipped or waived states cannot safely be reinterpreted, and automatic
migration would destroy audit meaning and complicate rollback.

## Consequences

### Positive

- Safe implementation starts sooner and no longer depends on perfect automatic analysis.
- UI comparison remains universal and visible for UI migrations.
- Draft PRs become compact review surfaces instead of opaque completion claims.
- Exact roots and runtime-owned Git snapshots eliminate common scope and evidence mismatches.
- Failed verification stays actionable without being mislabeled.
- Runtime, SDK, Skill, documentation, and manifests can be checked against one policy digest.

### Negative

- Drafts may intentionally contain failed or unavailable checks, so merge readiness must be
  visually distinct from Draft availability.
- A persistent Gap ledger and policy migration add schema and test work.
- Old Runs need export and a new Run rather than transparent continuation.
- Making visual comparison universal requires reliable fixture, baseline, font, asset, and
  authentication capture support.
- Four renderers require separate golden snapshots and shared-block parity tests.
- Feature video capture adds storage, playback validation, redaction, and retention cost.
- The public workflow contract becomes a new major version.

### Safety

- Unsafe path or destructive-write ambiguity still stops before mutation.
- Unknown API mutations are not invented.
- Failed and missing checks cannot become passed.
- Secrets and CA contents are never saved in Run artifacts or PR bodies.
- Feature videos cannot expose tokens, cookies, personal data, or unrelated user content.
- A failed publish cannot be reported as an existing PR.
- Existing historical artifacts and Run records are preserved through export before cleanup.

## Implementation reference

The complete target architecture and phased cleanup plan are documented in:

- [`spec-to-pr-1.0-architecture.md`](../architecture/spec-to-pr-1.0-architecture.md)
- [`spec-to-pr-1.0-pr-templates.md`](../architecture/spec-to-pr-1.0-pr-templates.md)
- [`spec-to-pr-1.0-cleanup-and-release-plan.md`](../architecture/spec-to-pr-1.0-cleanup-and-release-plan.md)
- [`spec-to-pr-1.0-flow.mmd`](../architecture/spec-to-pr-1.0-flow.mmd)
