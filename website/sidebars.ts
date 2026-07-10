import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  guideSidebar: [
    "intro",
    {
      type: "category",
      label: "시작하기",
      collapsed: false,
      items: [
        "getting-started/prerequisites",
        "getting-started/installation",
        "getting-started/quickstart",
      ],
    },
    {
      type: "category",
      label: "사용법",
      collapsed: false,
      items: [
        "usage/recipes",
        "usage/mode-brief-figma-openapi",
        "usage/mode-legacy-migration",
        "usage/options-and-policies",
      ],
    },
    {
      type: "category",
      label: "핵심 개념",
      collapsed: false,
      items: [
        "concepts/pipeline",
        "concepts/subagents",
        "concepts/host-parity",
        "concepts/scoring-and-loops",
        "concepts/pr-report",
        "concepts/storage-and-mcp",
      ],
    },
    {
      type: "category",
      label: "레퍼런스",
      items: [
        "reference/skills",
        "reference/agents",
        "reference/config",
        "reference/task-graph",
        "reference/glossary",
      ],
    },
    "troubleshooting",
  ],
};

export default sidebars;
