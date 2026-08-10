import { createRequire } from "node:module";
import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const config: Config = {
  title: "SpecToPR",
  tagline: "네 가지 개발 요청을 구현하고, 사실에 근거한 한국어 Draft PR로 정리합니다",
  future: { v4: true },
  url: "https://dhyun2.github.io",
  baseUrl: "/spec-to-pr/",
  organizationName: "dhyun2",
  projectName: "spec-to-pr",
  onBrokenLinks: "throw",
  onBrokenAnchors: "throw",

  i18n: {
    defaultLocale: "ko",
    locales: ["ko"],
    localeConfigs: {
      ko: { label: "한국어", htmlLang: "ko-KR" },
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
        language: ["ko"],
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
        { to: "/concepts/pipeline", position: "left", label: "진행 방식" },
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
          title: "핵심 개념",
          items: [
            { label: "진행 방식", to: "/concepts/pipeline" },
            { label: "화면 비교", to: "/concepts/visual-verification" },
            { label: "Draft PR", to: "/concepts/reviews" },
            { label: "입력 형식", to: "/reference/config" },
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
