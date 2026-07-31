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
      owner: "진행 담당자",
      action: "입력 자료를 읽고 작업 범위, 제공 방식, 예상 작업량을 분류",
      input: "요청, 저장소, 입력 자료",
      output: "실행 ID, 작업 범위, 예상 작업량, 출처 기록",
      passCondition: "필수 입력 자료와 출처 기록이 고정되고 다음 작업이 열림",
      blocked: "필수 입력이나 입력 자료를 뒷받침할 근거가 없음",
    },
    {
      id: "contracts",
      owner: "intake-contracts",
      action: "요구사항과 API·모의 응답·디자인 계약을 현재 입력 자료에 연결",
      input: "고정된 입력 자료와 프로젝트 지침",
      output: "수용 조건, API·모의 응답·디자인 계약",
      passCondition: "계약 충돌이 없고 모든 필수 조건의 연결이 확인됨",
      blocked: "계약이 충돌하거나 필수 검증 자료가 누락됨",
    },
    {
      id: "implementation",
      owner: "구현 담당자",
      action: "API 준비 상태를 먼저 증명한 뒤 같은 맥락에서 구현하고 브라우저 근거를 한 번에 수집",
      input: "승인된 계약",
      output: "API 준비 근거, 코드 변경, capture-session 검증 자료",
      passCondition: "구현과 requiredValidations가 승인된 계약에 빠짐없이 연결됨",
      blocked: "API 준비 근거와 최종 구현의 맥락이 다름",
    },
    {
      id: "functional-review",
      owner: "기능 검토자",
      action:
        "동일한 검토 묶음에서 계약, 코드 변경, 실행 결과, API·레거시 검증 현황을 읽기 전용으로 검토",
      input: "현재 상태로 고정된 검토 묶음",
      output: "기능·계약 판정",
      passCondition: "현재 검토 묶음에 대한 판정이 승인됨",
      blocked: "수용 조건, 테스트, API·레거시 검증이 통과하지 못함",
    },
    {
      id: "design-review",
      owner: "디자인 검토자",
      action: "기능 검토와 동시에 화면 출처, 상호작용, 반응형, 디자인 시스템, 접근성을 검토",
      input: "UI 검토 묶음과 화면 비교 보고서",
      output: "화면·상호작용·접근성 판정",
      passCondition: "UI 작업은 승인되고, UI가 아니면 해당 없음(not-applicable)으로 기록됨",
      blocked: "UI 검증 자료가 없거나 출처 정보가 현재 상태와 맞지 않음",
    },
    {
      id: "report",
      owner: "진행 담당자",
      action: "현재 검토 묶음의 입력 자료, 구현, 검증, 위험을 표준 보고서로 정리",
      input: "적용 대상인 모든 승인 판정",
      output: "15개 섹션의 pr-report-v2.1",
      passCondition: "15개 섹션이 complete, not-run, blocked, not-applicable 중 하나로 기록됨",
      blocked: "필수 섹션이나 현재 검토 묶음의 검증 자료가 누락됨",
    },
    {
      id: "publish",
      owner: "발행 담당자",
      action: "발행 전 조건을 확인한 뒤 같은 소스·대상 브랜치의 초안을 생성하거나 갱신",
      input: "변경을 커밋한 깨끗한 소스 브랜치",
      output: "일반(ready) 또는 차단 진단(blocked-diagnostic) 초안",
      passCondition: "커밋 SHA에 고정된 검증 자료와 초안 URL이 기록됨",
      blocked: "인증, 변경 내역, 브랜치 선행 여부, 원격 저장소 조건을 충족하지 못함",
    },
    {
      id: "archive",
      owner: "archive-openspec",
      action: "사용자 요청과 신뢰할 수 있는 병합 근거를 확인해 병합 후 자료를 보관",
      input: "신뢰할 수 있는 병합 근거",
      output: "명시적인 병합 후 보관 결과",
      passCondition: "병합 근거와 보관 결과가 실행 기록에 남음",
      blocked: "병합 근거가 없거나 사용자가 보관을 요청하지 않음",
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
      action:
        "Prove API-ready, then implement and collect focused browser evidence once in the same context",
      input: "Accepted contracts",
      output: "API-ready, implementation diff, capture-session evidence",
      passCondition: "Implementation and requiredValidations fully map to accepted contracts",
      blocked: "API-ready and final context do not match",
    },
    {
      id: "functional-review",
      owner: "functional reviewer",
      action:
        "Concurrently read the same packet's contracts, diff, executable evidence, and API/legacy coverage",
      input: "Immutable packet",
      output: "Functional and contract verdict",
      passCondition: "The current-packet verdict is approved",
      blocked: "Acceptance, tests, API, or legacy coverage fails",
    },
    {
      id: "design-review",
      owner: "design reviewer",
      action:
        "Concurrently review visual provenance, interaction, responsive states, design system, and a11y",
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
      aria-label={locale === "ko" ? "8단계 실행 흐름" : "Eight-stage Run pipeline"}
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
          <span>{locale === "ko" ? "담당" : "Owner"}</span>
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
                ? "JavaScript 없이 보는 전체 단계 계약"
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
