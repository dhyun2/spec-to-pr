---
name: Spec To PR
description: Run the end-to-end spec-to-pr workflow and publish a draft PR/MR when evidence is ready.
disable-model-invocation: false
argument-hint: "<project-root> [brief/docs/figma/openapi] [source-branch] [target-branch]"
allowed-tools: mcp__spec-to-pr__kernel_info mcp__spec_to_pr__kernel_info mcp__spec-to-pr__kernel_ping mcp__spec_to_pr__kernel_ping mcp__spec-to-pr__create_run mcp__spec_to_pr__create_run mcp__spec-to-pr__get_run mcp__spec_to_pr__get_run mcp__spec-to-pr__create_intake_manifest mcp__spec_to_pr__create_intake_manifest mcp__spec-to-pr__parse_intake_request mcp__spec_to_pr__parse_intake_request mcp__spec-to-pr__inspect_project mcp__spec_to_pr__inspect_project mcp__spec-to-pr__register_file_source mcp__spec_to_pr__register_file_source mcp__spec-to-pr__analyze_brief_source mcp__spec_to_pr__analyze_brief_source mcp__spec-to-pr__analyze_openapi_source mcp__spec_to_pr__analyze_openapi_source mcp__spec-to-pr__record_figma_mcp_capabilities mcp__spec_to_pr__record_figma_mcp_capabilities mcp__spec-to-pr__get_figma_provider_policy mcp__spec_to_pr__get_figma_provider_policy mcp__spec-to-pr__register_figma_source mcp__spec_to_pr__register_figma_source mcp__spec-to-pr__record_figma_metadata mcp__spec_to_pr__record_figma_metadata mcp__spec-to-pr__record_figma_design_context mcp__spec_to_pr__record_figma_design_context mcp__spec-to-pr__record_figma_screenshot mcp__spec_to_pr__record_figma_screenshot mcp__spec-to-pr__record_figma_variable_defs mcp__spec_to_pr__record_figma_variable_defs mcp__spec-to-pr__record_figma_code_connect_map mcp__spec_to_pr__record_figma_code_connect_map mcp__spec-to-pr__analyze_figma_design_inventory mcp__spec_to_pr__analyze_figma_design_inventory mcp__spec-to-pr__build_evidence_graph mcp__spec_to_pr__build_evidence_graph mcp__spec-to-pr__get_traceability_matrix mcp__spec_to_pr__get_traceability_matrix mcp__spec-to-pr__generate_openspec_change mcp__spec_to_pr__generate_openspec_change mcp__spec-to-pr__generate_gherkin_test_matrix mcp__spec_to_pr__generate_gherkin_test_matrix mcp__spec-to-pr__generate_api_pipeline mcp__spec_to_pr__generate_api_pipeline mcp__spec-to-pr__generate_figma_design_contract mcp__spec_to_pr__generate_figma_design_contract mcp__spec-to-pr__prepare_agent_runtime mcp__spec_to_pr__prepare_agent_runtime mcp__spec-to-pr__prepare_spec_bdd_agent mcp__spec_to_pr__prepare_spec_bdd_agent mcp__spec-to-pr__get_spec_bdd_agent_context mcp__spec_to_pr__get_spec_bdd_agent_context mcp__spec-to-pr__record_spec_bdd_agent_result mcp__spec_to_pr__record_spec_bdd_agent_result mcp__spec-to-pr__prepare_api_contract_agent mcp__spec_to_pr__prepare_api_contract_agent mcp__spec-to-pr__get_api_contract_agent_context mcp__spec_to_pr__get_api_contract_agent_context mcp__spec-to-pr__record_api_contract_agent_result mcp__spec_to_pr__record_api_contract_agent_result mcp__spec-to-pr__prepare_design_ui_agent mcp__spec_to_pr__prepare_design_ui_agent mcp__spec-to-pr__get_design_ui_agent_context mcp__spec_to_pr__get_design_ui_agent_context mcp__spec-to-pr__record_design_ui_agent_result mcp__spec_to_pr__record_design_ui_agent_result mcp__spec-to-pr__run_quality_gates mcp__spec_to_pr__run_quality_gates mcp__spec-to-pr__plan_visual_regression mcp__spec_to_pr__plan_visual_regression mcp__spec-to-pr__capture_browser_screenshots mcp__spec_to_pr__capture_browser_screenshots mcp__spec-to-pr__compare_visual_snapshots mcp__spec_to_pr__compare_visual_snapshots mcp__spec-to-pr__get_visual_report mcp__spec_to_pr__get_visual_report mcp__spec-to-pr__evaluate_visual_repair_loop mcp__spec_to_pr__evaluate_visual_repair_loop mcp__spec-to-pr__record_visual_review_result mcp__spec_to_pr__record_visual_review_result mcp__spec-to-pr__plan_accessibility_gate mcp__spec_to_pr__plan_accessibility_gate mcp__spec-to-pr__run_accessibility_gate mcp__spec_to_pr__run_accessibility_gate mcp__spec-to-pr__get_accessibility_report mcp__spec_to_pr__get_accessibility_report mcp__spec-to-pr__record_accessibility_review mcp__spec_to_pr__record_accessibility_review mcp__spec-to-pr__plan_performance_gate mcp__spec_to_pr__plan_performance_gate mcp__spec-to-pr__run_performance_gate mcp__spec_to_pr__run_performance_gate mcp__spec-to-pr__get_performance_report mcp__spec_to_pr__get_performance_report mcp__spec-to-pr__record_performance_review mcp__spec_to_pr__record_performance_review mcp__spec-to-pr__plan_observability mcp__spec_to_pr__plan_observability mcp__spec-to-pr__generate_observability_config mcp__spec_to_pr__generate_observability_config mcp__spec-to-pr__get_observability_report mcp__spec_to_pr__get_observability_report mcp__spec-to-pr__record_observability_review mcp__spec_to_pr__record_observability_review mcp__spec-to-pr__prepare_review_council mcp__spec_to_pr__prepare_review_council mcp__spec-to-pr__get_review_council_context mcp__spec_to_pr__get_review_council_context mcp__spec-to-pr__record_review_council_result mcp__spec_to_pr__record_review_council_result mcp__spec-to-pr__prepare_integration mcp__spec_to_pr__prepare_integration mcp__spec-to-pr__get_integration_plan mcp__spec_to_pr__get_integration_plan mcp__spec-to-pr__apply_integration mcp__spec_to_pr__apply_integration mcp__spec-to-pr__record_integration_repair mcp__spec_to_pr__record_integration_repair mcp__spec-to-pr__finalize_integration mcp__spec_to_pr__finalize_integration mcp__spec-to-pr__generate_pr_report mcp__spec_to_pr__generate_pr_report mcp__spec-to-pr__get_pr_report mcp__spec_to_pr__get_pr_report mcp__spec-to-pr__record_pr_report_review mcp__spec_to_pr__record_pr_report_review mcp__spec-to-pr__detect_publish_target mcp__spec_to_pr__detect_publish_target mcp__spec-to-pr__plan_review_request_publish mcp__spec_to_pr__plan_review_request_publish mcp__spec-to-pr__publish_review_request mcp__spec_to_pr__publish_review_request mcp__spec-to-pr__get_publish_result mcp__spec_to_pr__get_publish_result mcp__spec-to-pr__record_publish_review mcp__spec_to_pr__record_publish_review
---

# Spec To PR

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

1. Run the Doctor checks before relying on the kernel.
2. Create or reuse a Run for the project root.
3. Call `parse_intake_request` with the original user request text before registering derived sources. Treat parsed file paths, Figma URLs, inline OpenAPI/API endpoint notes, branch policy, validation commands, publish policy, merge boundary, archive policy, visual preview policy, and gate intent as intake evidence, not as memory.
4. If `parse_intake_request` returns `derivedSources` with `kind: "openapi"`, call `analyze_openapi_source` for each returned source before building traceability or API artifacts. These derived sources represent pasted API notes normalized into OpenAPI snapshots.
5. Register supplied brief, docs, Figma, and OpenAPI file sources.
6. Build traceability, OpenSpec, Gherkin, API artifacts, and Figma design contracts from recorded evidence.
7. Prepare and run the relevant implementation lanes.
8. Run mandatory evidence gates before PR reporting:
   - `run_quality_gates` must record `lint`, `typecheck`, `build`, at least one functional gate (`unit`, `component`, `contract`, `acceptance`, or `e2e`), `openspec`, and `security` CheckResults. If a project has no matching script, provide an explicit command override or keep the report blocked.
   - If Figma evidence exists, run Figma provider policy/inventory/design contract steps and run visual comparison with `plan_visual_regression`, `capture_browser_screenshots`, and `compare_visual_snapshots`.
   - Run `run_accessibility_gate`.
   - Run `run_performance_gate` and record Web Vitals/Lighthouse readiness evidence.
   - Run `generate_observability_config` and record observability review evidence.
9. If Figma evidence exists, run the visual repair loop until `evaluate_visual_repair_loop` returns `passed` or a human-review blocker is recorded.
10. Do not generate a final PR report while mandatory gate evidence is missing unless the report is intentionally blocked and will not be published.
11. Run Review Council before final reporting.
12. Generate the PR report with `generate_pr_report`. Use `language: "ko"` unless the user explicitly asks for English.
13. Read the markdown body with `get_pr_report`.
14. If the report decision is `blocked`, stop and report the missing/failed gates. Do not publish.
15. If the report decision is not `blocked`, detect the publish target and build the publish plan.
16. Do not stop after planning. Call `publish_review_request` with `confirm: true` to create or update a draft PR/MR using the generated report artifact as the base body.
    - If visual PNG artifacts exist, the publisher uploads them to GitHub/GitLab and injects a `Visual Evidence Preview` section with image links.
17. Call `get_publish_result` and report the PR/MR URL.

## Publishing Boundary

Publishing means pushing the source branch if requested and creating or updating a draft PR/MR.

Publishing does not mean merge, approve, close, or mark ready for review.

## Safety Rules

- Do not publish a blocked report.
- Do not synthesize the PR/MR body from memory.
- Use the generated PR report artifact as the base review request body.
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
