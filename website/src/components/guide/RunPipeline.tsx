import { useState } from "react";

import styles from "./guide.module.css";

type Stage = {
  id: string;
  title: string;
  action: string;
  result: string;
};

const stages: Stage[] = [
  {
    id: "source",
    title: "자료 확인",
    action:
      "선택한 케이스에 필요한 기획서·Figma·레거시 경로와 대상 프로젝트 규칙을 읽습니다. brief와 feature는 OpenSpec 변경 문서로 요구사항을 정리·대조합니다.",
    result: "구현할 범위·OpenSpec 요구사항·참고 기준",
  },
  {
    id: "build",
    title: "구현",
    action:
      "기존 프로젝트 구조를 따르고, UI는 사내 디자인 시스템과 기존 컴포넌트를 우선 사용합니다.",
    result: "실제 코드 변경",
  },
  {
    id: "verify",
    title: "검증",
    action:
      "brief·feature의 test: on이면 OpenSpec 수용 시나리오로 TDD를 합니다. UI 작업이면 기준·구현 화면을 같은 조건으로 비교합니다. feature는 test와 별개로 변경 기능 E2E와 사용자 흐름 영상 한 개도 남깁니다.",
    result: "test 모드·TDD 결과·화면 일치율·feature E2E 영상",
  },
  {
    id: "draft",
    title: "Draft PR",
    action:
      "현재 Git 변경사항을 읽어 개발한 기능, API, 화면 증빙, Gap을 한국어로 정리합니다. feature에는 E2E 영상도 연결합니다.",
    result: "리뷰할 수 있는 Draft PR",
  },
];

export default function RunPipeline() {
  const [activeStage, setActiveStage] = useState(stages[0]!.id);
  const selected = stages.find((stage) => stage.id === activeStage) ?? stages[0]!;

  return (
    <section
      className={styles.pipeline}
      data-testid="delivery-flow"
      aria-label="SpecToPR 진행 방식"
    >
      <div className={styles.pipelineHeader}>
        <p className={styles.pipelineKicker}>선택해서 자세히 보기</p>
      </div>
      <div className={styles.stageGrid}>
        {stages.map((stage, index) => (
          <button
            className={styles.stageButton}
            data-active={activeStage === stage.id ? "true" : "false"}
            type="button"
            key={stage.id}
            aria-pressed={activeStage === stage.id}
            onClick={() => setActiveStage(stage.id)}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{stage.title}</strong>
          </button>
        ))}
      </div>
      <div className={styles.pipelineDetail} aria-live="polite">
        <div>
          <span>단계</span>
          <strong>{selected.title}</strong>
        </div>
        <div>
          <span>하는 일</span>
          <strong>{selected.action}</strong>
        </div>
        <div>
          <span>남기는 것</span>
          <strong>{selected.result}</strong>
        </div>
      </div>
    </section>
  );
}
