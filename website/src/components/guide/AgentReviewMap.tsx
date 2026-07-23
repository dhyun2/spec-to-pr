import styles from "./guide.module.css";

type Locale = "ko" | "en";

const content = {
  ko: {
    label: "SpecToPR 에이전트 권한과 검증 자료 흐름",
    roles: [
      {
        name: "진행 담당자",
        scope: "실행·계약·상태 관리",
        reads: "사용자 요청, 입력 자료 출처, 실행 상태",
        returns: "승인된 계약과 현재 상태로 고정된 검토 묶음",
        boundary: "기능·디자인 검토자의 판정을 대신하지 않음",
      },
      {
        name: "구현 담당자 한 명",
        scope: "유일한 코드 작성자",
        reads: "승인된 계약과 프로젝트 지침",
        returns: "API 준비 근거, 코드 변경, 실행 결과",
        boundary: "API와 UI를 여러 명이 나눠 쓰거나 다시 위임하지 않음",
      },
      {
        name: "기능 검토자 (functional-reviewer)",
        scope: "모든 코드 변경 범위를 독립적으로 판정",
        reads: "계약, 코드 변경, 테스트, API·레거시 검증 자료",
        returns: "승인(approved) 또는 수정 요청(changes-requested) 판정",
        boundary: "읽기 전용이며 워크플로 MCP를 호출하지 않음",
      },
      {
        name: "디자인 검토자 (design-reviewer)",
        scope: "UI 변경 범위를 독립적으로 판정",
        reads: "기준·결과·차이·겹침 화면, 상호작용, 접근성",
        returns: "승인(approved) 또는 수정 요청(changes-requested) 판정",
        boundary: "점수 계산·코드 수정 금지",
      },
    ],
  },
  en: {
    label: "SpecToPR agent authority and evidence flow",
    roles: [
      {
        name: "orchestrator",
        scope: "Owns Run, contracts, and state",
        reads: "User request, source provenance, workflow status",
        returns: "Accepted contracts and immutable packet",
        boundary: "Never substitutes for review verdicts",
      },
      {
        name: "one implementation writer",
        scope: "The only code writer",
        reads: "Accepted contracts and project guidance",
        returns: "API-ready, diff, executable evidence",
        boundary: "No API/UI parallel writer; no nesting",
      },
      {
        name: "functional reviewer",
        scope: "Independent verdict for every code scope",
        reads: "Contracts, diff, tests, API/legacy evidence",
        returns: "Approved or changes-requested verdict",
        boundary: "Read-only; no workflow MCP",
      },
      {
        name: "design reviewer",
        scope: "Independent verdict for UI scope",
        reads: "Baseline, actual, diff/overlay, interaction and a11y",
        returns: "Approved or changes-requested verdict",
        boundary: "Does not calculate scores or repair code",
      },
    ],
  },
} satisfies Record<
  Locale,
  {
    label: string;
    roles: Array<{ name: string; scope: string; reads: string; returns: string; boundary: string }>;
  }
>;

export default function AgentReviewMap({ locale }: { locale: Locale }) {
  const copy = content[locale];

  return (
    <section className={styles.reviewMap} data-testid="agent-review-map" aria-label={copy.label}>
      <div className={styles.reviewFlow} aria-hidden="true">
        <span>{locale === "ko" ? "계약" : "Contracts"}</span>
        <span>{locale === "ko" ? "구현" : "Implementation"}</span>
        <span>{locale === "ko" ? "독립 판정" : "Independent verdicts"}</span>
        <span>{locale === "ko" ? "보고서" : "Report"}</span>
      </div>
      <div className={styles.roleGrid}>
        {copy.roles.map((role) => (
          <article className={styles.roleCard} key={role.name}>
            <p className={styles.roleName}>{role.name}</p>
            <h3>{role.scope}</h3>
            <dl>
              <div>
                <dt>{locale === "ko" ? "읽는 것" : "Reads"}</dt>
                <dd>{role.reads}</dd>
              </div>
              <div>
                <dt>{locale === "ko" ? "반환" : "Returns"}</dt>
                <dd>{role.returns}</dd>
              </div>
              <div>
                <dt>{locale === "ko" ? "경계" : "Boundary"}</dt>
                <dd>{role.boundary}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
