---
sidebar_position: 30
title: "T30 · 증거 기반 PR/MR 리포트"
sidebar_label: "T30 PR 리포트"
---

# T30 · 증거 기반 PR/MR 리포트

> **한 줄 요약** — [Run](/reference/glossary#run)의 증거·아티팩트·체크·[Gap](/reference/glossary#gap)·결정으로부터 리뷰어용 PR/MR 본문과 내부 감사 리포트를 결정론적으로 생성하고, 9개 차원 [Review Scorecard](/reference/glossary#scorecard)로 발행 가능 여부를 판정한다.
>
> 렌더링된 PR 본문의 섹션 구성·판정 4단계·실제 예시는 [PR 리포트 구조](/concepts/pr-report) 가이드를 보라.

| 항목              | 내용                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **목적**          | 에이전트가 기억으로 쓰는 PR 요약은 증거 없이 완료를 주장할 수 있으므로, Run 아티팩트에서만 리포트를 생성한다                                                        |
| **입력**          | Run ID, OpenSpec·traceability·API·디자인 계약 아티팩트(T13~~T17), Review Council 결과(T22), 통합 리포트(T23), 게이트 리포트(T24~~T29), Review Scorecard, Gap Ledger |
| **출력**          | PR 리포트 뷰모델, PR/MR 본문 Markdown, 내부 감사 Markdown, scorecard 행, 결정(Blocked/Draft/Ready) — T31 퍼블리셔가 소비                                            |
| **선행 태스크**   | T22, T23, T24, T25, T26, T27, T28, T29                                                                                                                              |
| **병렬 가능**     | 없음 (모든 게이트 증거를 수렴하는 지점)                                                                                                                             |
| **관련 스킬**     | `/spec-to-pr:generate-pr-report`                                                                                                                                    |
| **담당 에이전트** | `agents/pr-report-reviewer.md`                                                                                                                                      |

## 왜 필요한가

에이전트가 작성한 PR 요약은 신뢰할 수 없다 — 증거 없이 완료를 주장할 수 있기 때문이다. T30은 Run 아티팩트로부터 결정론적 Markdown 리포트를 생성한다. PR/MR 본문은 리뷰어에게 최적화하고, 장황한 감사 세부사항은 별도 아티팩트에 남긴다.

## 동작 흐름

1. `generate_review_scorecard` — Run의 아티팩트·체크·소스에서 **Review Scorecard**를 생성한다 (`src/application/review-scorecard-service.ts`).
   - **9개 차원** (`src/review-scorecard/review-scorecard.ts`의 `ReviewScorecardDimensionIdSchema`): `brief-fidelity`, `legacy-coverage`, `gherkin-completeness`, `tdd-evidence`, `design-system-usage`, `visual-parity`, `resource-contract`, `api-contract`, `publish-sync`.
   - 각 차원은 0~10 점수와 임계값을 가진다. 기본 임계값은 `DEFAULT_REVIEW_SCORE_THRESHOLD = 8` (**8.0/10**).
   - **정규화**: `minimumScore`가 0~1 범위이면 비율로 간주해 10배 한다 — `0.85` → `8.5/10` (`normalizeMinimumScore`).
   - **결정 로직**: 실패 차원(status `fail` 또는 `score < threshold`)이 없으면 `passed`; 있으면 `attempt >= maxAttempts`(기본 3)일 때 `blocked`, 아니면 `retry`. `nextRepairTarget`은 실패 차원 중 점수가 가장 낮은 차원이다.
2. `generate_pr_report` — Run 증거를 수집해 PR 리포트 뷰모델을 만들고 Markdown으로 렌더링한다.
3. 결정 정책이 **Blocked / Draft / Ready**를 산출한다. `review-scorecard-json` 아티팩트가 없으면 리포트는 발행 가능(publishable) 상태가 될 수 없고, scorecard의 `decision !== "passed"`, `lowestScore < minimumScore`, 임의 차원 `fail`, 또는 남아 있는 `nextRepairTarget`은 리포트 결정을 `blocked`로 유지한다 (`isReviewScorecardBlocking`).
4. scorecard 행은 PR/MR 본문과 내부 감사 리포트 양쪽에 렌더링된다.
5. 리포트 [ArtifactRef](/reference/glossary#artifactref)를 Run에 추가한다.
6. `record_pr_report_review` — `pr-report-reviewer` 에이전트가 불일치를 지적할 수 있으나 결정론적 결정을 바꿀 수는 없다.

## 입력 상세

- **OpenSpec 아티팩트, [Traceability Matrix](/reference/glossary#traceabilitymatrix)** — 요구사항 추적 근거.
- **API 리포트, 디자인 계약 리포트, AgentResult, [Review Council](/reference/glossary#review-council) finding**
- **Review Scorecard 아티팩트** — kind `review-scorecard`, `reportKind: "review-scorecard-json"`.
- **통합 리포트(T23), 아키텍처 가드 리포트(T24), 품질 게이트 리포트(T25)**
- **시각 리포트(T26)** — 컴포넌트 계약이 있으면 component 범위 시각 리포트 필수, 레거시 인벤토리가 있으면 legacy feature coverage matrix 필수.
- **접근성(T27)·성능(T28)·OpenTelemetry(T29) 리포트, [Gap Ledger](/reference/glossary#gap-ledger)**

## 출력 상세

scorecard 아티팩트 요약 예시:

```json
{
  "adapter": "review-scorecard-v1",
  "minimumScore": 8,
  "lowestScore": 7.4,
  "decision": "retry",
  "nextRepairTarget": "visual-parity",
  "dimensions": [
    { "id": "brief-fidelity", "score": 9.1, "threshold": 8, "status": "pass" },
    {
      "id": "visual-parity",
      "score": 7.4,
      "threshold": 8,
      "status": "fail",
      "nextRepairTarget": true
    }
  ],
  "summary": "Review scorecard retry; repair visual-parity next."
}
```

- **PR 리포트 뷰모델 아티팩트** — 렌더링 전 구조화 데이터.
- **PR/MR 본문 Markdown 아티팩트** — 리뷰어용 요약 + scorecard 행.
- **내부 감사 Markdown 아티팩트** — 장황한 증거 상세.
- **리포트 리뷰 아티팩트** (요청 시) 와 갱신된 Run 아티팩트 목록.

## 규칙

- Pass는 통과한 [CheckResult](/reference/glossary#checkresult)에서만 나올 수 있다. Skipped/Not Run을 Pass로 서술해서는 안 된다.
- 열린 gap은 반드시 보여야 하며, 같은 원인의 반복 gap은 요구사항별 반복 대신 그룹화한다.
- 비어 있는 traceability 섹션은 비게 만든 blocker를 설명해야 한다.
- 시각 지표는 알고리즘과 임계값을 포함해야 한다. legacy-vs-target 시각 증거는 report kind가 `visual-report-json`이고 `visualBaseline`이 `legacy-screenshot`일 때 인정된다.
- 컴포넌트 계약이 있는데 component 범위 시각 증거가 없으면 리포트는 blocked다.
- 성능은 lab/field 데이터를 구분하고, 접근성은 자동/수동 리뷰를 구분해야 한다.
- OpenSpec archive는 archive 증거가 없는 한 "계획"으로만 서술한다.

## 완료 조건 (Definition of Done)

- [ ] PR 리포트 뷰모델이 생성된다.
- [ ] Markdown 리포트가 생성된다.
- [ ] 장황한 증거가 있으면 내부 감사 리포트가 생성된다.
- [ ] Review scorecard 행이 렌더링되고 scorecard blocker가 결정 정책에 반영된다.
- [ ] 결정 정책이 Blocked / Draft / Ready를 산출한다.
- [ ] 리포트 아티팩트 참조가 Run에 추가된다.
- [ ] 스킬과 리뷰어 에이전트가 존재한다.
- [ ] MCP 툴이 stdio 통합 테스트로 동작한다.

## 검증 방법

```bash
pnpm format:check
pnpm typecheck
pnpm schemas:build
pnpm build
pnpm test
pnpm audit
```

기대 결과:

- PR report collector / decision policy / renderer / service 테스트 통과
- MCP stdio 통합 테스트에서 `generate_review_scorecard`, `generate_pr_report`, `get_pr_report`, `record_pr_report_review` 호출 가능

## 알려진 한계

- 리포트 섹션의 완성도는 상류(upstream) 아티팩트의 완성도에 종속된다.
- PR/MR 본문은 의도적으로 일부 내부 증거를 요약한다 — 상세는 감사 아티팩트에 남는다.
- T30은 PR/MR을 발행하지 않고(T31), 체크를 재실행하지 않으며, gap waiver를 승인하지 않고, OpenSpec 변경을 아카이브하지 않는다(T32).
- 리포트 리뷰어 에이전트는 불일치를 지적할 수 있지만 결정론적 결정을 변경할 수 없다.
