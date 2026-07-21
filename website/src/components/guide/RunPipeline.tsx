import { useState } from "react";

import styles from "./guide.module.css";

type Locale = "ko" | "en";
type Stage = {
  id: string;
  owner: string;
  action: string;
  input: string;
  output: string;
  passCondition: string;
  blocked: string;
};

const stages: Record<Locale, Stage[]> = {
  ko: [
    {
      id: "intake",
      owner: "orchestrator",
      action: "source를 읽고 scope, delivery profile, workload를 분류",
      input: "요청, 저장소, source",
      output: "Run ID, scope, workload, provenance",
      passCondition: "필수 source와 provenance가 고정되고 다음 action이 열림",
      blocked: "필수 입력이나 유일한 source 근거가 없음",
    },
    {
      id: "contracts",
      owner: "intake-contracts",
      action: "요구사항과 API, mock, design 계약을 current source에 연결",
      input: "고정된 source와 project guidance",
      output: "수용 조건, API/mock/design 계약",
      passCondition: "계약 충돌이 없고 모든 필수 조건이 trace됨",
      blocked: "계약 충돌 또는 필수 evidence 누락",
    },
    {
      id: "implementation",
      owner: "implementation writer",
      action: "API-ready를 먼저 증명한 뒤 같은 context에서 구현과 관련 검사를 실행",
      input: "accepted contracts",
      output: "API-ready, 구현 diff, focused evidence",
      passCondition: "구현과 requiredValidations가 accepted contracts에 완전히 매핑됨",
      blocked: "API-ready와 최종 context가 다름",
    },
    {
      id: "functional-review",
      owner: "functional reviewer",
      action: "계약, diff, executable evidence, API/legacy coverage를 read-only 검토",
      input: "immutable packet",
      output: "기능·계약 verdict",
      passCondition: "현재 packet에 대한 verdict가 approved",
      blocked: "수용 조건, 테스트, API/legacy coverage 실패",
    },
    {
      id: "design-review",
      owner: "design reviewer",
      action: "visual provenance, interaction, responsive, design-system, a11y를 검토",
      input: "UI packet과 visual report",
      output: "시각·interaction·a11y verdict",
      passCondition: "UI면 approved, non-UI면 not-applicable",
      blocked: "UI evidence가 없거나 provenance가 stale",
    },
    {
      id: "report",
      owner: "orchestrator",
      action: "현재 packet의 source, 구현, 검증, risk를 canonical report로 조립",
      input: "적용 가능한 approved verdict",
      output: "15-section pr-report-v2.1",
      passCondition: "15개 섹션이 complete, not-run, blocked, not-applicable로 닫힘",
      blocked: "필수 섹션 또는 현재 packet evidence 누락",
    },
    {
      id: "publish",
      owner: "publisher",
      action: "publication preflight 뒤 같은 source/target의 draft를 생성 또는 갱신",
      input: "clean committed source branch",
      output: "ready 또는 blocked-diagnostic draft",
      passCondition: "commit SHA에 고정된 evidence와 draft URL이 기록됨",
      blocked: "인증, delta, ahead, remote precondition 실패",
    },
    {
      id: "archive",
      owner: "archive-openspec",
      action: "사용자 요청과 authoritative merge evidence를 확인해 post-merge archive",
      input: "authoritative merge evidence",
      output: "명시적 post-merge archive",
      passCondition: "merge 근거와 archive 결과가 Run에 기록됨",
      blocked: "merge 근거가 없거나 사용자가 요청하지 않음",
    },
  ],
  en: [
    {
      id: "intake",
      owner: "orchestrator",
      action: "Read sources and classify scope, delivery profile, and workload",
      input: "Request, repository, and sources",
      output: "Run ID, scope, workload, provenance",
      passCondition: "Required sources and provenance are pinned; the next action opens",
      blocked: "A required input or unique source fact is missing",
    },
    {
      id: "contracts",
      owner: "intake-contracts",
      action: "Bind requirements and API, mock, and design contracts to current sources",
      input: "Pinned sources and project guidance",
      output: "Acceptance, API/mock, and design contracts",
      passCondition: "Contracts do not conflict and every required condition is traced",
      blocked: "Contracts conflict or required evidence is absent",
    },
    {
      id: "implementation",
      owner: "implementation writer",
      action: "Prove API-ready, then implement and run focused checks in the same context",
      input: "Accepted contracts",
      output: "API-ready, implementation diff, focused evidence",
      passCondition: "Implementation and requiredValidations fully map to accepted contracts",
      blocked: "API-ready and final context do not match",
    },
    {
      id: "functional-review",
      owner: "functional reviewer",
      action: "Read contracts, diff, executable evidence, and API/legacy coverage",
      input: "Immutable packet",
      output: "Functional and contract verdict",
      passCondition: "The current-packet verdict is approved",
      blocked: "Acceptance, tests, API, or legacy coverage fails",
    },
    {
      id: "design-review",
      owner: "design reviewer",
      action: "Review visual provenance, interaction, responsive states, design system, and a11y",
      input: "UI packet and visual report",
      output: "Visual, interaction, and a11y verdict",
      passCondition: "Approved for UI, or not-applicable for non-UI",
      blocked: "UI evidence is absent or provenance is stale",
    },
    {
      id: "report",
      owner: "orchestrator",
      action: "Assemble current-packet sources, implementation, validation, and risk",
      input: "Every applicable approved verdict",
      output: "15-section pr-report-v2.1",
      passCondition: "All 15 sections close as complete, not-run, blocked, or not-applicable",
      blocked: "A required section or current-packet artifact is missing",
    },
    {
      id: "publish",
      owner: "publisher",
      action: "Run publication preflight, then create or update the same source/target draft",
      input: "Clean committed source branch",
      output: "Ready or blocked-diagnostic draft",
      passCondition: "Commit-pinned evidence and the draft URL are recorded",
      blocked: "Auth, delta, ahead, or remote precondition fails",
    },
    {
      id: "archive",
      owner: "archive-openspec",
      action: "Verify the user request and authoritative merge evidence, then archive",
      input: "Authoritative merge evidence",
      output: "Explicit post-merge archive",
      passCondition: "Merge evidence and the archive result are recorded on the Run",
      blocked: "Merge evidence or an explicit request is missing",
    },
  ],
};

export default function RunPipeline({ locale, mode }: { locale: Locale; mode?: string }) {
  const [activeStage, setActiveStage] = useState(stages[locale][0]!.id);
  const selected = stages[locale].find((stage) => stage.id === activeStage) ?? stages[locale][0]!;

  return (
    <section
      className={styles.pipeline}
      data-testid="run-pipeline"
      aria-label={locale === "ko" ? "8단계 Run 파이프라인" : "Eight-stage Run pipeline"}
    >
      <div className={styles.pipelineHeader}>
        <p className={styles.pipelineKicker}>
          {locale === "ko" ? "선택해서 자세히 보기" : "Select a stage to inspect it"}
        </p>
        {mode ? <span className={styles.modeBadge}>mode: {mode}</span> : null}
      </div>
      <div className={styles.stageGrid}>
        {stages[locale].map((stage, index) => (
          <button
            className={styles.stageButton}
            data-active={activeStage === stage.id ? "true" : "false"}
            type="button"
            key={stage.id}
            aria-pressed={activeStage === stage.id}
            aria-label={`${index + 1} · ${stage.id}`}
            onClick={() => setActiveStage(stage.id)}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{stage.id}</strong>
          </button>
        ))}
      </div>
      <div className={styles.pipelineDetail} data-testid="run-pipeline-detail" aria-live="polite">
        <div>
          <span>{locale === "ko" ? "소유자" : "Owner"}</span>
          <strong>{selected.owner}</strong>
        </div>
        <div>
          <span>{locale === "ko" ? "하는 일" : "Action"}</span>
          <strong>{selected.action}</strong>
        </div>
        <div>
          <span>{locale === "ko" ? "입력" : "Input"}</span>
          <strong>{selected.input}</strong>
        </div>
        <div>
          <span>{locale === "ko" ? "남기는 것" : "Output"}</span>
          <strong>{selected.output}</strong>
        </div>
        <div>
          <span>{locale === "ko" ? "통과 조건" : "Pass condition"}</span>
          <strong>{selected.passCondition}</strong>
        </div>
        <div>
          <span>{locale === "ko" ? "멈추는 조건" : "Block condition"}</span>
          <strong>{selected.blocked}</strong>
        </div>
      </div>
      <noscript>
        <div className={styles.pipelineNoScript} data-testid="pipeline-noscript">
          <p>
            <strong>
              {locale === "ko"
                ? "JavaScript 없이 보는 전체 stage 계약"
                : "Complete stage contract without JavaScript"}
            </strong>
          </p>
          <ol>
            {stages[locale].map((stage) => (
              <li key={stage.id}>
                <strong>{stage.id}</strong>
                <span>
                  {locale === "ko" ? "하는 일" : "Action"}: {stage.action}
                </span>
                <span>
                  {locale === "ko" ? "통과 조건" : "Pass condition"}: {stage.passCondition}
                </span>
                <span>
                  {locale === "ko" ? "멈추는 조건" : "Block condition"}: {stage.blocked}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </noscript>
    </section>
  );
}
