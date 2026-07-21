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
      items: ["usage/index", "usage/brief", "usage/legacy", "usage/feature", "usage/figma"],
    },
    {
      type: "category",
      label: "핵심 개념",
      collapsed: false,
      items: [
        "concepts/pipeline",
        "concepts/reviews",
        "concepts/visual-verification",
        "concepts/comparison",
      ],
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
