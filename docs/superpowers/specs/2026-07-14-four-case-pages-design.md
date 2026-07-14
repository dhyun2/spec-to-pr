# Four Separate Usage Pages Design

## Goal

Replace the combined four-case tab guide with four independent Korean and English usage documents. A reader should enter the exact case they need from the sidebar, read only that case, and share a stable case-specific URL.

## Approved information architecture

The `사용법` / `Usage` category exposes exactly four detailed pages:

| Case                                             | Korean route     | English route       |
| ------------------------------------------------ | ---------------- | ------------------- |
| Brief to draft PR                                | `/usage/brief`   | `/en/usage/brief`   |
| Legacy change to draft PR                        | `/usage/legacy`  | `/en/usage/legacy`  |
| Feature to targeted E2E, one video, and draft PR | `/usage/feature` | `/en/usage/feature` |
| Figma to design implementation                   | `/usage/figma`   | `/en/usage/figma`   |

The sidebar lists those four pages directly and does not show an overview or “four cases” document. The navbar label becomes `사용법` in Korean and `Usage` in English and links directly to the brief page.

## Compatibility route

The old `/usage/recipes` and `/en/usage/recipes` URLs must not become 404s because README links, search results, and existing bookmarks may still use them. A redirect-only compatibility document remains hidden from the sidebar and redirects to the locale-equivalent brief page:

- `/usage/recipes` → `/usage/brief`
- `/en/usage/recipes` → `/en/usage/brief`

This compatibility document contains no guide content and is not presented as a fifth usage page.

## Page contract

Each case page owns only its case-specific content and keeps the eleven-section comparison contract from the approved bilingual guide:

1. Use this case
2. Required inputs
3. Optional inputs
4. Minimal prompt
5. Full prompt example
6. What SpecToPR does
7. Evidence and validation
8. Expected branch and commits
9. Expected draft PR or explicit no-publication result
10. When the Run stops
11. What this case does not do

The current tab content moves without weakening its delivery rules:

- Brief implements accepted brief scope and does not automatically require feature E2E or video.
- Legacy captures a focused baseline and does not inventory or modernize the entire repository.
- Feature alone automatically requires a targeted Playwright invocation and exactly one valid WebM or MP4; full-project E2E remains rejected.
- Figma requires connected-host Figma evidence and defaults to `publication: none`; a draft PR requires explicit intent.

Every page includes:

- one compact input/result summary;
- minimum and full copyable prompts using actual runtime field names;
- workload, token range, confidence, 80% checkpoint, and unchanged `requiredValidations` behavior;
- phase-by-phase execution;
- illustrative evidence paths, branch, commit, PR title, and PR body;
- blockers paired with the exact user action needed to resume;
- explicit exclusions;
- a compact “Other usage cases” list linking to the other three pages.

No page uses case tabs. The four pages are independent documents and browser history entries.

## Localization

Korean source pages live under `website/docs/usage`. English pages live under `website/i18n/en/docusaurus-plugin-content-docs/current/usage` with the same filenames, routes, section order, runtime fields, paths, and semantic requirements.

English copy remains natural rather than mechanically translated. The Korean and English sidebars use the same document IDs, while localized frontmatter titles provide the visible item labels.

## Maintained links

Direct links are updated to point at the most relevant page instead of the compatibility redirect:

- English README → `/en/usage/brief`
- Korean README → `/usage/brief`
- Quickstart → `/usage/brief`
- Navbar → locale-equivalent brief page
- Footer usage link → locale-equivalent brief page

The case pages cross-link directly to one another. No maintained document should intentionally link to `/usage/recipes` after this change.

## Visual behavior

The four pages use ordinary Docusaurus document layout. Native tables and code blocks remain locally horizontally scrollable on narrow screens. There is no tab strip, combined comparison table, or shared Mermaid diagram on these pages because those elements belonged to the removed overview.

The page title and opening summary must make the case result visible without scrolling. Detailed sections follow in a consistent order. No generated image or tutorial video is added; the feature page documents the workflow video contract but the documentation site itself remains text-native and maintainable.

## Testing

### Static contracts

- The sidebar contains exactly `usage/brief`, `usage/legacy`, `usage/feature`, and `usage/figma` in that order.
- Korean and English each contain all four case documents.
- Each case document contains its eleven required sections and case-specific delivery rules.
- None of the four case documents imports or renders `Tabs` or `TabItem`.
- The hidden recipes compatibility document contains only redirect behavior.
- README, quickstart, navbar, and footer links no longer target `/usage/recipes`.

### Build and browser checks

- Korean and English production builds pass with broken-link checking enabled.
- Each of the eight localized case URLs renders the expected title and first section.
- The usage sidebar exposes four case links and no combined guide item.
- The old recipes URL redirects to the locale-equivalent brief page.
- Desktop and mobile views have no page-level horizontal overflow or console errors.

## Non-goals

- No workflow runtime, mode, tool, skill, reviewer, or evidence-policy change.
- No fifth overview page in the usage sidebar.
- No broad redesign or translation of unrelated documentation.
- No generated marketing images or documentation video.
- No deployment, push, release, or PR creation unless separately requested.
