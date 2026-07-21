import Link from "@docusaurus/Link";

import styles from "./guide.module.css";

type Locale = "ko" | "en";

const modes = {
  ko: [
    {
      id: "brief",
      title: "기획서에서 전체 개발",
      input: "기획서 + Figma + OpenAPI",
      result: "API/UI, Figma 비교, API gap, Web Vitals",
      href: "/usage/brief",
    },
    {
      id: "legacy",
      title: "레거시를 더 나은 구조로 이관",
      input: "대상 저장소 + 별도 legacy path",
      result: "inventory/coverage와 running legacy 비교",
      href: "/usage/legacy",
    },
    {
      id: "feature",
      title: "사용자 기능 하나를 끝까지",
      input: "기획서 + Figma + OpenAPI",
      result: "full evidence + targeted E2E + 영상 1개",
      href: "/usage/feature",
    },
    {
      id: "figma",
      title: "Figma를 mock UI로 구현",
      input: "Figma URL + 대상 저장소",
      result: "mock 상태와 수치화된 Figma 비교",
      href: "/usage/figma",
    },
  ],
  en: [
    {
      id: "brief",
      title: "Build the full brief",
      input: "Brief + Figma + OpenAPI",
      result: "API/UI, Figma comparison, API gaps, Web Vitals",
      href: "/usage/brief",
    },
    {
      id: "legacy",
      title: "Migrate legacy into a better structure",
      input: "Target repository + separate legacy path",
      result: "Inventory, coverage, and running-legacy comparison",
      href: "/usage/legacy",
    },
    {
      id: "feature",
      title: "Deliver one user feature end to end",
      input: "Brief + Figma + OpenAPI",
      result: "Full evidence + targeted E2E + one video",
      href: "/usage/feature",
    },
    {
      id: "figma",
      title: "Implement Figma with mock states",
      input: "Figma URL + target repository",
      result: "Mock-backed states and measured Figma comparison",
      href: "/usage/figma",
    },
  ],
} satisfies Record<
  Locale,
  Array<{ id: string; title: string; input: string; result: string; href: string }>
>;

export default function ModeChooser({ locale }: { locale: Locale }) {
  return (
    <nav
      className={styles.modeGrid}
      data-testid="mode-chooser"
      aria-label={locale === "ko" ? "SpecToPR 사용 케이스" : "SpecToPR delivery cases"}
    >
      {modes[locale].map((mode, index) => (
        <Link className={styles.modeCard} to={mode.href} key={mode.id}>
          <span className={styles.modeNumber}>{String(index + 1).padStart(2, "0")}</span>
          <span className={styles.modeName}>{mode.title}</span>
          <span className={styles.modeMeta}>
            <strong>{locale === "ko" ? "입력" : "Input"}</strong> {mode.input}
          </span>
          <span className={styles.modeMeta}>
            <strong>{locale === "ko" ? "증거" : "Evidence"}</strong> {mode.result}
          </span>
          <span className={styles.modeLink}>{locale === "ko" ? "가이드 열기" : "Open guide"}</span>
        </Link>
      ))}
    </nav>
  );
}
