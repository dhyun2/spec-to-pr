import styles from "./guide.module.css";

type Locale = "ko" | "en";

const content = {
  ko: {
    label: "SpecToPR agent 권한과 evidence 흐름",
    roles: [
      {
        name: "orchestrator",
        scope: "Run·계약·상태 소유",
        reads: "사용자 요청, source provenance, workflow status",
        returns: "accepted contracts와 immutable packet",
        boundary: "구현 verdict를 대신하지 않음",
      },
      {
        name: "implementation writer 한 명",
        scope: "유일한 코드 작성자",
        reads: "accepted contracts와 project guidance",
        returns: "API-ready, diff, executable evidence",
        boundary: "API/UI parallel writer와 no nesting",
      },
      {
        name: "functional reviewer",
        scope: "모든 code scope의 독립 판정",
        reads: "계약, diff, 테스트, API/legacy evidence",
        returns: "approved 또는 changes-requested verdict",
        boundary: "read-only, workflow MCP 호출 금지",
      },
      {
        name: "design reviewer",
        scope: "UI scope의 독립 판정",
        reads: "baseline, actual, diff/overlay, interaction·a11y",
        returns: "approved 또는 changes-requested verdict",
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
