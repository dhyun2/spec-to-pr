import type { Gap } from "../runtime/gap.js";
import type { FigmaDesignContract } from "./design-contract-model.js";

export type RenderedDesignContract = {
  contractJson: string;
  contractMd: string;
  componentMapJson: string;
  tokenMapJson: string;
  typographyMapJson: string;
  assetMapJson: string;
  uiImplementationRulesMd: string;
  designGapSummaryMd: string;
};

export function renderDesignContract(input: {
  contract: FigmaDesignContract;
  gaps: Gap[];
}): RenderedDesignContract {
  return {
    contractJson: `${JSON.stringify(input.contract, null, 2)}\n`,
    contractMd: renderContractMarkdown(input.contract),
    componentMapJson: `${JSON.stringify(input.contract.componentMappings, null, 2)}\n`,
    tokenMapJson: `${JSON.stringify(input.contract.tokenMappings, null, 2)}\n`,
    typographyMapJson: `${JSON.stringify(input.contract.typographyMappings, null, 2)}\n`,
    assetMapJson: `${JSON.stringify(input.contract.assetMappings, null, 2)}\n`,
    uiImplementationRulesMd: renderUiRules(input.contract),
    designGapSummaryMd: renderGapSummary(input.gaps),
  };
}

function renderContractMarkdown(contract: FigmaDesignContract): string {
  return markdown([
    `# Figma Design Contract — ${contract.changeName}`,
    "",
    "## Summary",
    "",
    `- Component mappings: ${contract.componentMappings.length}`,
    `- Token mappings: ${contract.tokenMappings.length}`,
    `- Typography mappings: ${contract.typographyMappings.length}`,
    `- Asset mappings: ${contract.assetMappings.length}`,
    `- Gaps: ${contract.gapIds.length}`,
    "",
    "## Component Mappings",
    "",
    "| Figma | Code Component | Import | Source | Confidence | Gaps |",
    "|---|---|---|---|---|---|",
    ...contract.componentMappings.map((mapping) =>
      [
        escapeCell(mapping.figmaName),
        mapping.codeComponent ?? "-",
        mapping.importPath ?? "-",
        mapping.source,
        mapping.confidence,
        mapping.gapIds.join("<br>") || "-",
      ].join(" | "),
    ),
    "",
    "## Token Mappings",
    "",
    "| Figma Variable | Code Token | CSS Var | Class | Category | Confidence | Gaps |",
    "|---|---|---|---|---|---|---|",
    ...contract.tokenMappings.map((mapping) =>
      [
        escapeCell(mapping.figmaVariable),
        mapping.tokenName ?? "-",
        mapping.cssVariable ?? "-",
        mapping.className ?? "-",
        mapping.category,
        mapping.confidence,
        mapping.gapIds.join("<br>") || "-",
      ].join(" | "),
    ),
    "",
    "## Typography Mappings",
    "",
    "| Figma Text Style | Code Class | Token | Confidence | Gaps |",
    "|---|---|---|---|---|",
    ...contract.typographyMappings.map((mapping) =>
      [
        escapeCell(mapping.figmaTextStyle),
        mapping.codeClassName ?? "-",
        mapping.tokenName ?? "-",
        mapping.confidence,
        mapping.gapIds.join("<br>") || "-",
      ].join(" | "),
    ),
    "",
    "## Asset Mappings",
    "",
    "| Figma Asset | Code Component | Code Asset | Export Required | Confidence | Gaps |",
    "|---|---|---|---|---|---|",
    ...contract.assetMappings.map((mapping) =>
      [
        escapeCell(mapping.figmaName),
        mapping.codeComponent ?? "-",
        mapping.codeAssetPath ?? "-",
        String(mapping.exportRequired),
        mapping.confidence,
        mapping.gapIds.join("<br>") || "-",
      ].join(" | "),
    ),
  ]);
}

function renderUiRules(contract: FigmaDesignContract): string {
  return markdown([
    `# UI Implementation Rules — ${contract.changeName}`,
    "",
    "## Mandatory Rules",
    "",
    "1. Use mapped code components when `component-map.json` contains a mapping.",
    "2. Use mapped tokens/classes/css variables when `token-map.json` contains a mapping.",
    "3. Do not create ad-hoc CSS values for unmapped Figma variables.",
    "4. Do not invent states missing from Figma without opening or referencing a design gap.",
    "5. Prefer Code Connect mappings over name-based mappings.",
    "6. If a mapping has `confidence: missing`, do not implement that visual detail as if it were approved.",
    "7. Keep design gaps open until a resolution artifact exists.",
    "",
    "## Agent Consumption",
    "",
    "The Design/UI Agent must read:",
    "",
    "- `figma-design-contract.json`",
    "- `component-map.json`",
    "- `token-map.json`",
    "- `typography-map.json`",
    "- `asset-map.json`",
    "- `ui-implementation-rules.md`",
    "",
    "The agent must cite the relevant mapping or gap in its AgentResult decisions.",
  ]);
}

function renderGapSummary(gaps: Gap[]): string {
  return markdown([
    "# Design Gap Summary",
    "",
    ...(gaps.length === 0
      ? ["No design gaps were created."]
      : [
          "| Gap | Severity | Status | Title |",
          "|---|---|---|---|",
          ...gaps.map((gap) =>
            [gap.id, gap.severity, gap.status, escapeCell(gap.title)].join(" | "),
          ),
        ]),
  ]);
}

function markdown(lines: string[]): string {
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}
