import { createRequire } from "node:module";
import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const config: Config = {
  title: "SpecToPR",
  tagline: "기획서·레거시·사용자 기능·Figma를 검증된 구현과 초안 PR로 연결합니다",
  favicon: "img/favicon.ico",

  future: { v4: true },
  url: "https://dhyun2.github.io",
  baseUrl: "/spec-to-pr/",
  organizationName: "dhyun2",
  projectName: "spec-to-pr",
  onBrokenLinks: "throw",
  onBrokenAnchors: "throw",

  i18n: {
    defaultLocale: "ko",
    locales: ["ko", "en"],
    localeConfigs: {
      ko: { label: "한국어", htmlLang: "ko-KR" },
      en: { label: "English", htmlLang: "en-US" },
    },
  },

  markdown: {
    format: "mdx",
    mermaid: true,
    hooks: { onBrokenMarkdownLinks: "throw" },
  },

  themes: ["@docusaurus/theme-mermaid"],
  clientModules: ["./src/client/accessibility.ts"],

  plugins: [
    [
      require.resolve("@easyops-cn/docusaurus-search-local"),
      {
        hashed: true,
        language: ["en", "ko"],
        indexBlog: false,
        docsRouteBasePath: ["/"],
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
        theme: { customCss: "./src/css/custom.css" },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: { respectPrefersColorScheme: true },
    navbar: {
      title: "SpecToPR",
      items: [
        { type: "docSidebar", sidebarId: "guideSidebar", position: "left", label: "가이드" },
        { to: "/usage/", position: "left", label: "사용법" },
        { to: "/concepts/pipeline", position: "left", label: "v2 구조" },
        { type: "localeDropdown", position: "right" },
        { href: "https://github.com/dhyun2/spec-to-pr", label: "GitHub", position: "right" },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "시작하기",
          items: [
            { label: "설치", to: "/getting-started/installation" },
            { label: "퀵스타트", to: "/getting-started/quickstart" },
            { label: "사용법", to: "/usage/" },
          ],
        },
        {
          title: "v2 알아보기",
          items: [
            { label: "도구 7개 · 단계 8개", to: "/concepts/pipeline" },
            { label: "스킬 8개 · 독립 검토자 2명", to: "/reference/skills" },
            { label: "비교 · 채택 정책", to: "/concepts/comparison" },
            { label: "설정 · CLI", to: "/reference/config" },
          ],
        },
        {
          title: "프로젝트",
          items: [{ label: "GitHub", href: "https://github.com/dhyun2/spec-to-pr" }],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} SpecToPR 문서 · v${version}`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["bash", "json", "yaml"],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
