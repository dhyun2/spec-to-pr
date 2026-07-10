---
name: SpecToPR
description: Run the end-to-end spec-to-pr workflow and publish a draft PR/MR when evidence is ready.
disable-model-invocation: false
argument-hint: "<project-root> [brief/docs/figma/openapi] [source-branch] [target-branch]"
allowed-tools: mcp__spec-to-pr__kernel_info mcp__spec_to_pr__kernel_info mcp__spec-to-pr__kernel_ping mcp__spec_to_pr__kernel_ping mcp__spec-to-pr__create_run mcp__spec_to_pr__create_run mcp__spec-to-pr__get_run mcp__spec_to_pr__get_run mcp__spec-to-pr__create_intake_manifest mcp__spec_to_pr__create_intake_manifest mcp__spec-to-pr__parse_intake_request mcp__spec_to_pr__parse_intake_request mcp__spec-to-pr__inspect_project mcp__spec_to_pr__inspect_project mcp__spec-to-pr__register_file_source mcp__spec_to_pr__register_file_source mcp__spec-to-pr__analyze_brief_source mcp__spec_to_pr__analyze_brief_source mcp__spec-to-pr__analyze_openapi_source mcp__spec_to_pr__analyze_openapi_source mcp__spec-to-pr__generate_legacy_feature_inventory mcp__spec_to_pr__generate_legacy_feature_inventory mcp__spec-to-pr__build_feature_coverage_matrix mcp__spec_to_pr__build_feature_coverage_matrix mcp__spec-to-pr__record_figma_mcp_capabilities mcp__spec_to_pr__record_figma_mcp_capabilities mcp__spec-to-pr__get_figma_provider_policy mcp__spec_to_pr__get_figma_provider_policy mcp__spec-to-pr__register_figma_source mcp__spec_to_pr__register_figma_source mcp__spec-to-pr__record_figma_metadata mcp__spec_to_pr__record_figma_metadata mcp__spec-to-pr__record_figma_design_context mcp__spec_to_pr__record_figma_design_context mcp__spec-to-pr__record_figma_screenshot mcp__spec_to_pr__record_figma_screenshot mcp__spec-to-pr__record_figma_variable_defs mcp__spec_to_pr__record_figma_variable_defs mcp__spec-to-pr__record_figma_code_connect_map mcp__spec_to_pr__record_figma_code_connect_map mcp__spec-to-pr__analyze_figma_design_inventory mcp__spec_to_pr__analyze_figma_design_inventory mcp__spec-to-pr__build_evidence_graph mcp__spec_to_pr__build_evidence_graph mcp__spec-to-pr__get_traceability_matrix mcp__spec_to_pr__get_traceability_matrix mcp__spec-to-pr__generate_openspec_change mcp__spec_to_pr__generate_openspec_change mcp__spec-to-pr__generate_gherkin_test_matrix mcp__spec_to_pr__generate_gherkin_test_matrix mcp__spec-to-pr__generate_api_pipeline mcp__spec_to_pr__generate_api_pipeline mcp__spec-to-pr__generate_figma_design_contract mcp__spec_to_pr__generate_figma_design_contract mcp__spec-to-pr__prepare_agent_runtime mcp__spec_to_pr__prepare_agent_runtime mcp__spec-to-pr__prepare_spec_bdd_agent mcp__spec_to_pr__prepare_spec_bdd_agent mcp__spec-to-pr__get_spec_bdd_agent_context mcp__spec_to_pr__get_spec_bdd_agent_context mcp__spec-to-pr__record_spec_bdd_agent_result mcp__spec_to_pr__record_spec_bdd_agent_result mcp__spec-to-pr__prepare_api_contract_agent mcp__spec_to_pr__prepare_api_contract_agent mcp__spec-to-pr__get_api_contract_agent_context mcp__spec_to_pr__get_api_contract_agent_context mcp__spec-to-pr__record_api_contract_agent_result mcp__spec_to_pr__record_api_contract_agent_result mcp__spec-to-pr__prepare_design_ui_agent mcp__spec_to_pr__prepare_design_ui_agent mcp__spec-to-pr__get_design_ui_agent_context mcp__spec_to_pr__get_design_ui_agent_context mcp__spec-to-pr__record_design_ui_agent_result mcp__spec_to_pr__record_design_ui_agent_result mcp__spec-to-pr__run_quality_gates mcp__spec_to_pr__run_quality_gates mcp__spec-to-pr__plan_visual_regression mcp__spec_to_pr__plan_visual_regression mcp__spec-to-pr__capture_browser_screenshots mcp__spec_to_pr__capture_browser_screenshots mcp__spec-to-pr__compare_visual_snapshots mcp__spec_to_pr__compare_visual_snapshots mcp__spec-to-pr__get_visual_report mcp__spec_to_pr__get_visual_report mcp__spec-to-pr__evaluate_visual_repair_loop mcp__spec_to_pr__evaluate_visual_repair_loop mcp__spec-to-pr__record_visual_review_result mcp__spec_to_pr__record_visual_review_result mcp__spec-to-pr__plan_accessibility_gate mcp__spec_to_pr__plan_accessibility_gate mcp__spec-to-pr__run_accessibility_gate mcp__spec_to_pr__run_accessibility_gate mcp__spec-to-pr__get_accessibility_report mcp__spec_to_pr__get_accessibility_report mcp__spec-to-pr__record_accessibility_review mcp__spec_to_pr__record_accessibility_review mcp__spec-to-pr__plan_performance_gate mcp__spec_to_pr__plan_performance_gate mcp__spec-to-pr__run_performance_gate mcp__spec_to_pr__run_performance_gate mcp__spec-to-pr__get_performance_report mcp__spec_to_pr__get_performance_report mcp__spec-to-pr__record_performance_review mcp__spec_to_pr__record_performance_review mcp__spec-to-pr__plan_observability mcp__spec_to_pr__plan_observability mcp__spec-to-pr__generate_observability_config mcp__spec_to_pr__generate_observability_config mcp__spec-to-pr__get_observability_report mcp__spec_to_pr__get_observability_report mcp__spec-to-pr__record_observability_review mcp__spec_to_pr__record_observability_review mcp__spec-to-pr__prepare_review_council mcp__spec_to_pr__prepare_review_council mcp__spec-to-pr__get_review_council_context mcp__spec_to_pr__get_review_council_context mcp__spec-to-pr__record_review_council_result mcp__spec_to_pr__record_review_council_result mcp__spec-to-pr__generate_review_scorecard mcp__spec_to_pr__generate_review_scorecard mcp__spec-to-pr__prepare_integration mcp__spec_to_pr__prepare_integration mcp__spec-to-pr__get_integration_plan mcp__spec_to_pr__get_integration_plan mcp__spec-to-pr__apply_integration mcp__spec_to_pr__apply_integration mcp__spec-to-pr__record_integration_repair mcp__spec_to_pr__record_integration_repair mcp__spec-to-pr__finalize_integration mcp__spec_to_pr__finalize_integration mcp__spec-to-pr__analyze_architecture_boundaries mcp__spec_to_pr__analyze_architecture_boundaries mcp__spec-to-pr__generate_source_guard_tests mcp__spec_to_pr__generate_source_guard_tests mcp__spec-to-pr__generate_pr_report mcp__spec_to_pr__generate_pr_report mcp__spec-to-pr__get_pr_report mcp__spec_to_pr__get_pr_report mcp__spec-to-pr__record_pr_report_review mcp__spec_to_pr__record_pr_report_review mcp__spec-to-pr__detect_publish_target mcp__spec_to_pr__detect_publish_target mcp__spec-to-pr__plan_review_request_publish mcp__spec_to_pr__plan_review_request_publish mcp__spec-to-pr__publish_review_request mcp__spec_to_pr__publish_review_request mcp__spec-to-pr__get_publish_result mcp__spec_to_pr__get_publish_result mcp__spec-to-pr__record_publish_review mcp__spec_to_pr__record_publish_review
---

# SpecToPR

## MCP Tool Namespace

Tool names in this skill are written without the host prefix. Use the namespace exposed in the current host:

- Codex: `mcp__spec_to_pr__<tool>`
- Claude Code: `mcp__spec-to-pr__<tool>`

You run spec-to-pr end to end for a project and publish the generated report as a draft PR/MR when the evidence says it is safe.

## Inputs

Accept a natural-language request that may include:

- project root
- brief or plan file
- docs path
- Figma URL
- OpenAPI path
- source branch
- target branch

Default target branch is `main` when the user does not provide one.

## Procedure

1. Run the Doctor checks before relying on the kernel. If the spec-to-pr MCP tools are not exposed or Doctor fails, stop the normal workflow immediately and produce only a blocked report. Do not replace the workflow with manual implementation, manual evidence collection, or manual PR/MR creation.
2. Create or reuse a Run for the project root.
3. Call `parse_intake_request` with the original user request text before registering derived sources. Treat parsed file paths, Figma URLs, inline OpenAPI/API endpoint notes, branch policy, validation commands, publish policy, merge boundary, archive policy, visual preview policy, and gate intent as intake evidence, not as memory.
4. If `parse_intake_request` returns `derivedSources` with `kind: "openapi"`, call `analyze_openapi_source` for each returned source before building traceability or API artifacts. These derived sources represent pasted API notes normalized into OpenAPI snapshots.
5. Register supplied brief, docs, Figma, and OpenAPI file sources.
6. For legacy migrations, call `generate_legacy_feature_inventory` with the legacy project root before generating OpenSpec. Use the inventory as product evidence for routes, component branches, API calls, native bridge calls, URL opens, analytics, query/hash params, geolocation/current-location flow, dialogs/toasts, image fallback, marker/image resource bindings, root/global CSS selectors that affect the migrated screen, API params, and platform-specific behavior.
7. Build traceability, OpenSpec, Gherkin, API artifacts, and Figma design contracts from recorded evidence. Keep generated OpenSpec, Gherkin, test-matrix, Spec/BDD reports, gap summaries, and acceptance skeletons in the Run artifact store by default; set `writeToProject: true` only when the user explicitly asks for repo-exported evidence files. For legacy migrations, then call `build_feature_coverage_matrix` before implementation lanes. Every legacy feature must map to OpenSpec, Gherkin, test matrix, and executable unit/component/e2e/contract evidence or an explicit waiver. Coverage matrix reruns reuse an existing open `legacy-coverage` gap for the same legacy feature ID instead of creating duplicate blockers. If `uncoveredCount > 0` or the matrix reports documented-only rows, repair OpenSpec/Gherkin/tests or record explicit waivers before continuing; otherwise the Review Council, PR report, and publish stages must remain blocked.
8. Prepare and run the relevant implementation lanes.
9. Run Review Council before integration, as a bounded re-review loop separate from the visual repair loop:
   - Run `prepare_review_council` / `get_review_council_context`, review the lanes, and `record_review_council_result`.
   - If the verdict is `approved`, continue to integration.
   - If the verdict is `changes_requested`, group the findings by category and re-run only the affected lane(s):
     - `spec` findings → re-run the Spec/BDD lane.
     - `api` findings → re-run the API Contract lane.
     - `design`/`visual` findings → re-run the Design/UI lane.
       After the targeted re-runs, reconvene the Council.
   - Allow at most **2 Council re-review attempts**. If the verdict is still `changes_requested` after the limit, stop the loop, keep the open gaps, and produce a `blocked` report instead of publishing.
10. Prepare, apply, and finalize integration only after an approved Council result. Use `prepare_integration`, `get_integration_plan`, `apply_integration`, and `finalize_integration`; record bounded repair results with `record_integration_repair`. If integration remains conflicted or blocked, keep the report blocked.
11. Run the architecture gate after integration and before final reporting:
    - Call `analyze_architecture_boundaries` and `generate_source_guard_tests`.
    - Record the architecture evidence and run the generated source guards when the target project supports them.
    - If architecture violations or source-guard checks remain unresolved, keep the PR report blocked.
12. Run mandatory evidence gates before PR reporting:

- `run_quality_gates` must record `lint`, `typecheck`, `build`, at least one functional gate (`unit`, `component`, `contract`, `acceptance`, or `e2e`), `openspec`, and `security` CheckResults. If a project has no matching script, provide an explicit command override or keep the report blocked.
- For legacy migrations, the functional gate must connect back to legacy feature coverage through test-report artifacts, CheckResults, scenario IDs, or explicit waiver evidence.
- If Figma evidence exists, run Figma provider policy/inventory/design contract steps and run visual comparison with `plan_visual_regression`, `capture_browser_screenshots`, and `compare_visual_snapshots`.
- Figma components and icons must first map to the target design system, especially `@frontend/ui` and `@frontend/ui/icons/vue`. Custom UI is allowed only when missing mapping evidence is recorded as a design gap.
- Legacy image URLs, marker assets, root/global CSS selectors, API endpoint/params, query/hash, geolocation/current-location flow, native bridge, and URL-open behavior must be verified through visual/resource contract evidence. Visual masks do not satisfy resource binding evidence.
- If the design contract records component contracts, record component-level visual comparison evidence with `comparisonScope: "component"` for those variants. Full-screen visual comparison does not satisfy component contracts.
- Run `run_accessibility_gate`.
- Run `run_performance_gate` and record Web Vitals/Lighthouse readiness evidence.
- Run `generate_observability_config` and record observability review evidence.

13. If Figma evidence exists, run the visual repair loop until `evaluate_visual_repair_loop` returns `passed` or a human-review blocker is recorded.
14. Do not generate a final PR report while mandatory architecture or gate evidence is missing unless the report is intentionally blocked and will not be published.
15. Generate a review scorecard with `generate_review_scorecard` using `minimumScore: 8`, `attempt: 1`, and `maxAttempts: 3`. If a caller supplies a ratio-style `minimumScore` in the 0-1 range, the service normalizes it to the 0-10 score scale, so `0.85` means `8.5/10`.
    - The scorecard dimensions are brief fidelity, legacy coverage, Gherkin completeness, TDD evidence, design-system usage, visual parity, resource contract, API contract, and publish sync.
    - If the scorecard decision is `retry`, fix the reported `nextRepairTarget` first, then regenerate the scorecard with the next attempt number.
    - Do not continue to PR reporting until every scorecard dimension meets the normalized minimum threshold or a human-review blocker is recorded.
    - If the scorecard decision is `blocked`, generate only a blocked PR report and do not publish.
16. Generate the PR report with `generate_pr_report`. Use `language: "ko"` unless the user explicitly asks for English.
17. Read the markdown body with `get_pr_report`.
18. If the report decision is `blocked`, do not create or mark a PR/MR ready. If an existing draft review request was already created and the user asks to surface failure evidence there, use the publisher's blocked draft body-update path instead of hiding the generated report.
19. If the report decision is not `blocked`, detect the publish target and build the publish plan.
20. Do not stop after planning. Call `publish_review_request` with `confirm: true` to create or update a draft PR/MR using the generated report artifact as the base body.
    - If visual PNG artifacts exist, the publisher uploads them to GitHub/GitLab and injects a `Visual Evidence Preview` section with image links.
21. Call `get_publish_result` and verify `requestSynced: true`. If `visualPreviewExpected: true`, also verify `visualPreviewSynced: true`. If body sync or visual evidence upload failed, report the publish result as failed/blocked even if a PR/MR URL exists.

## Publishing Boundary

Publishing means pushing the source branch if requested and creating or updating a draft PR/MR.

Publishing does not mean merge, approve, close, or mark ready for review.

## Safety Rules

- Do not create a new PR/MR or mark one ready from a blocked report.
- Existing draft PR/MR body updates may include blocked failure evidence only through the explicit blocked draft update path.
- Do not synthesize the PR/MR body from memory.
- Use the generated PR report artifact as the base review request body.
- Do not treat a Git push-option-created MR, host side effect, or manually edited PR body as spec-to-pr publish success.
- Publish success requires generated body synchronization and required visual evidence upload synchronization recorded in the publish result.
- Preserve artifact IDs when injecting uploaded visual evidence image links.
- Do not merge.
- Do not approve.
- Do not mark ready for review unless explicitly requested.
- Do not archive OpenSpec until the user later confirms the PR/MR was merged.

## Report

Return:

- Run ID
- PR report artifact ID
- decision
- published draft PR/MR URL, if created or updated
- uploaded visual asset URLs, if any
- open blockers, if publishing was skipped
- verification summary
