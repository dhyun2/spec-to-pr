import { createRequire } from "node:module";
import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const config: Config = {
  title: "SpecToPR",
  tagline:
    "기획서 · Figma · OpenAPI · 레거시 저장소를 입력받아, 증거가 붙은 draft PR까지 만들어 주는 Claude Code · Codex 플러그인",
  favicon: "img/favicon.ico",

  future: {
    v4: true,
  },

  url: "https://dhyun2.github.io",
  baseUrl: "/spec-to-pr/",

  organizationName: "dhyun2",
  projectName: "spec-to-pr",

  onBrokenLinks: "throw",

  i18n: {
    defaultLocale: "ko",
    locales: ["ko"],
  },

  markdown: {
    // .md 파일은 CommonMark로 처리한다 — 태스크 문서의 <runId>·{...} 표기가
    // MDX(JSX) 표현식으로 오해되는 것을 막는다. JSX가 필요한 페이지만 .mdx를 쓴다.
    format: "detect",
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },

  themes: ["@docusaurus/theme-mermaid"],

  plugins: [
    [
      "@docusaurus/plugin-content-docs",
      {
        id: "tasks",
        path: "../docs/tasks",
        routeBasePath: "tasks",
        sidebarPath: "./sidebarsTasks.ts",
        editUrl: "https://github.com/dhyun2/spec-to-pr/tree/main/docs/tasks/",
        exclude: ["**/_*.md"],
        // 파일명(01-…)을 그대로 slug로 유지한다 — 태스크 번호가 URL에 남아야 참조가 쉽다.
        numberPrefixParser: false,
      },
    ],
    [
      require.resolve("@easyops-cn/docusaurus-search-local"),
      {
        hashed: true,
        language: ["en", "ko"],
        indexBlog: false,
        docsRouteBasePath: ["/", "tasks"],
        highlightSearchTermsOnTargetPage: true,
        searchBarShortcutHint: true,
      },
    ],
  ],

  presets: [
    [
      "classic",
      {
        docs: {
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
          editUrl: "https://github.com/dhyun2/spec-to-pr/tree/main/website/",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: "SpecToPR",
      items: [
        { type: "docSidebar", sidebarId: "guideSidebar", position: "left", label: "가이드" },
        { to: "/tasks/01-executable-plugin-shell", position: "left", label: "태스크 (T01–T33)" },
        { to: "/reference/glossary", position: "left", label: "용어집" },
        { href: "https://github.com/dhyun2/spec-to-pr", label: "GitHub", position: "right" },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "문서",
          items: [
            { label: "퀵스타트", to: "/getting-started/quickstart" },
            { label: "사용 레시피", to: "/usage/recipes" },
            { label: "평가와 루프", to: "/concepts/scoring-and-loops" },
          ],
        },
        {
          title: "레퍼런스",
          items: [
            { label: "스킬 27개", to: "/reference/skills" },
            { label: "설정 · 환경변수", to: "/reference/config" },
            { label: "태스크 의존 그래프", to: "/reference/task-graph" },
          ],
        },
        {
          title: "프로젝트",
          items: [{ label: "GitHub", href: "https://github.com/dhyun2/spec-to-pr" }],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} SpecToPR · v${version}`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["bash", "json", "yaml", "gherkin"],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
