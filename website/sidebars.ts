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
      items: ["usage/recipes"],
    },
    {
      type: "category",
      label: "핵심 개념",
      collapsed: false,
      items: ["concepts/pipeline"],
    },
    {
      type: "category",
      label: "레퍼런스",
      items: ["reference/skills", "reference/config"],
    },
    "troubleshooting",
  ],
};

export default sidebars;
