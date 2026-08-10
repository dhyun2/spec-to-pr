import Link from "@docusaurus/Link";

import styles from "./guide.module.css";

type Locale = "ko";

const modes = {
  ko: [
    {
      id: "brief",
      title: "기획서로 시작하기",
      input: "기획서 경로 + 구현 요청",
      result: "OpenSpec 대조 뒤 구현, test: on이면 TDD",
      href: "/usage/brief",
    },
    {
      id: "legacy",
      title: "레거시 화면과 동작 옮기기",
      input: "대상 저장소 + 별도 레거시 경로",
      result: "레거시 동작·화면·API를 기준으로 구현, 화면 비교",
      href: "/usage/legacy",
    },
    {
      id: "feature",
      title: "기능 하나를 만들기",
      input: "한 가지 기능 요청",
      result: "OpenSpec 대조, 선택 TDD, E2E·영상 1개",
      href: "/usage/feature",
    },
    {
      id: "figma",
      title: "Figma 화면 구현하기",
      input: "Figma URL + 대상 저장소",
      result: "디자인 시스템 우선 구현, Figma와 화면 비교",
      href: "/usage/figma",
    },
  ],
} satisfies Record<
  Locale,
  Array<{ id: string; title: string; input: string; result: string; href: string }>
>;

export default function ModeChooser({ locale }: { locale: Locale }) {
  return (
    <nav className={styles.modeGrid} data-testid="mode-chooser" aria-label="SpecToPR 사용 방식">
      {modes[locale].map((mode, index) => (
        <Link className={styles.modeCard} to={mode.href} key={mode.id}>
          <span className={styles.modeNumber}>{String(index + 1).padStart(2, "0")}</span>
          <span className={styles.modeName}>{mode.title}</span>
          <span className={styles.modeMeta}>
            <strong>입력</strong> {mode.input}
          </span>
          <span className={styles.modeMeta}>
            <strong>결과</strong> {mode.result}
          </span>
          <span className={styles.modeLink}>가이드 열기</span>
        </Link>
      ))}
    </nav>
  );
}
