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
      action: "요구사항·UI 비교 대상·확인된 API 계약과 이미 알려진 Gap을 현재 입력 자료에 연결",
      input: "고정된 입력 자료와 프로젝트 지침",
      output: "수용 조건, 화면 비교 대상, API·binding Gap",
      passCondition: "안전한 구현 범위와 필수 검증 대상이 고정됨",
      blocked: "안전한 쓰기 대상이나 정확한 범위를 확정할 수 없음",
    },
    {
      id: "implementation",
      owner: "구현 담당자",
      action:
        "확인된 동작부터 구현하고 UI 비교·테스트 근거를 수집하며, 불명확한 API는 Gap으로 남김",
      input: "승인된 계약",
      output: "코드 변경, 화면 비교 결과, API·binding Gap",
      passCondition: "확인된 범위의 구현과 적용 대상 검증이 현재 packet에 연결됨",
      blocked: "안전하지 않은 쓰기를 막아야 함",
    },
    {
      id: "functional-review",
      owner: "기능 검토자",
      action: "동일한 검토 묶음에서 계약, 코드 변경, 테스트 결과와 남은 Gap을 읽기 전용으로 검토",
      input: "현재 상태로 고정된 검토 묶음",
      output: "기능·계약 판정",
      passCondition: "현재 검토 묶음에 대한 판정이 승인됨",
      blocked: "독립 검토를 실행할 수 없으면 not-run Gap으로 기록됨",
    },
    {
      id: "design-review",
      owner: "디자인 검토자",
      action: "기능 검토와 동시에 화면 비교, 상호작용, 반응형, 디자인 시스템, 접근성을 검토",
      input: "UI 검토 묶음과 화면 비교 보고서",
      output: "화면·상호작용·접근성 판정",
      passCondition: "UI 작업은 승인되고, UI가 아니면 해당 없음(not-applicable)으로 기록됨",
      blocked: "화면 비교 실패·미실행은 merge-blocking Gap으로 기록됨",
    },
    {
      id: "report",
      owner: "진행 담당자",
      action: "현재 packet을 네 가지 리뷰어용 PR 본문과 기계용 보고서로 정리",
      input: "적용 대상 검증의 passed·failed·not-run 결과와 Gap",
      output: "Legacy / Brief / Feature / Figma Gap-first Draft",
      passCondition: "모든 적용 검증이 사실대로 기록되고 Gap이 상단에 표시됨",
      blocked: "안전 중단 외의 불확실성은 Draft를 막지 않고 Gap으로 남김",
    },
    {
      id: "publish",
      owner: "발행 담당자",
      action: "발행 전 조건을 확인한 뒤 같은 소스·대상 브랜치의 초안을 생성하거나 갱신",
      input: "변경을 커밋한 깨끗한 소스 브랜치",
      output: "Draft PR/MR 또는 게시 Gap이 있는 로컬 보고서",
      passCondition: "호스트에 동기화된 Draft만 verified/merge-ready로 표시할 수 있음",
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
      action:
        "Bind requirements, UI comparison targets, confirmed API contracts, and known Gaps to current sources",
      input: "Pinned sources and project guidance",
      output: "Acceptance, visual targets, and API/binding Gaps",
      passCondition: "A safe implementation boundary and required validation targets are pinned",
      blocked: "A safe write target or exact scope cannot be established",
    },
    {
      id: "implementation",
      owner: "implementation writer",
      action:
        "Implement confirmed behavior, collect UI/test evidence, and retain uncertain API behavior as Gaps",
      input: "Accepted contracts",
      output: "Implementation diff, visual results, and API/binding Gaps",
      passCondition: "Confirmed work and applicable validation are bound to the current packet",
      blocked: "An unsafe write must be prevented",
    },
    {
      id: "functional-review",
      owner: "functional reviewer",
      action:
        "Concurrently read the same packet's contracts, diff, executable evidence, and remaining Gaps",
      input: "Immutable packet",
      output: "Functional and contract verdict",
      passCondition: "The current-packet verdict is approved",
      blocked: "Unavailable review is recorded as a not-run Gap",
    },
    {
      id: "design-review",
      owner: "design reviewer",
      action:
        "Concurrently review visual comparison, interaction, responsive states, design system, and a11y",
      input: "UI packet and visual report",
      output: "Visual, interaction, and a11y verdict",
      passCondition: "Approved for UI, or not-applicable for non-UI",
      blocked: "A failed or not-run comparison becomes a merge-blocking Gap",
    },
    {
      id: "report",
      owner: "orchestrator",
      action:
        "Assemble the current packet into four reviewer-first PR templates and a machine report",
      input: "Applicable passed, failed, and not-run validations plus Gaps",
      output: "Legacy / Brief / Feature / Figma Gap-first Draft",
      passCondition: "Every applicable validation is truthful and unresolved Gaps appear first",
      blocked: "Only an unsafe stop prevents a Draft; other uncertainty remains a Gap",
    },
    {
      id: "publish",
      owner: "publisher",
      action: "Run publication preflight, then create or update the same source/target draft",
      input: "Clean committed source branch",
      output: "Draft PR/MR or a local report with a publication Gap",
      passCondition:
        "Only a host-synced Draft with passed gates can be labelled verified/merge-ready",
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
