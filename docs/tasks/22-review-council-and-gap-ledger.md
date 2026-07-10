---
sidebar_position: 22
title: "T22 · Review Council과 Gap Ledger"
sidebar_label: "T22 Review Council"
---

# T22 · Review Council과 Gap Ledger

> **한 줄 요약** — Spec/BDD·API Contract·Design/UI 에이전트 산출물을 교차 검토하고, 증거로 뒷받침되는 finding으로 [Gap Ledger](/reference/glossary#gap-ledger)를 갱신하는 검증 레인.

| 항목              | 내용                                                                                                                                                                                                                                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **목적**          | 구현 [AgentResult](/reference/glossary#agentresult)의 주장이 소스 증거로 뒷받침되는지, 소유권을 벗어난 변경이 없는지, 열린 [Gap](/reference/glossary#gap)이 완료 주장과 모순되지 않는지 판정한다                                                                                                                                          |
| **입력**          | [Run](/reference/glossary#run) ID, [TraceabilityMatrix](/reference/glossary#traceabilitymatrix)(T13), OpenSpec manifest(T14), Gherkin/테스트 매트릭스(T15), API 인테이크·파이프라인 아티팩트(T12/T16), Figma 디자인 계약·인벤토리(T11/T17), 선택적 component contract·legacy coverage 아티팩트, T19~T21의 세 AgentResult, 기존 Gap Ledger |
| **출력**          | ReviewCouncilContextPack, ReviewCouncilResult, 리뷰 리포트·모순 매트릭스 아티팩트, 신규/갱신 Gap, `review-council` VerificationAgentResult → T23(통합)·T30(PR 리포트)이 소비                                                                                                                                                              |
| **선행 태스크**   | T19, T20, T21                                                                                                                                                                                                                                                                                                                             |
| **병렬 가능**     | 없음 (세 구현 레인의 합류 지점)                                                                                                                                                                                                                                                                                                           |
| **관련 스킬**     | `/spec-to-pr:run-review-council`                                                                                                                                                                                                                                                                                                          |
| **담당 에이전트** | `agents/review-council.md`                                                                                                                                                                                                                                                                                                                |

## 왜 필요한가

구현 에이전트의 결과만으로는 충분하지 않다. 시스템은 다음을 판정해야 한다:

- 구현 주장이 소스 증거로 뒷받침되는가
- API 작업이 문서화된 OpenAPI operation만 사용하는가
- UI 작업이 Figma 디자인 계약을 따르는가
- 컴포넌트 수준 UI variant가 생성된 component contract를 만족하는가
- legacy 마이그레이션 동작이 OpenSpec·Gherkin·구현·테스트 증거로 커버되는가
- 테스트가 생성된 Gherkin 시나리오를 커버하는가
- 열린 Gap이 완료 주장과 모순되는가
- 에이전트가 소유권 밖의 파일을 변경했는가
- 요구사항이 ready/partial/blocked/rejected 중 어디에 있는가

## 동작 흐름

`src/application/review-council-service.ts` 기준:

1. **prepare** — `prepare_review_council`이 결정적 프리체크(`runReviewPrechecks`)를 실행하고 ReviewCouncilContextPack을 생성한다. 프리체크 항목: 열린 blocker Gap, 열린 Gap을 참조하는 passed AgentResult, 아티팩트 없는 구현 결과, OpenAPI 증거 없는 API 주장, Figma 증거 없는 디자인 주장, legacy coverage matrix 누락/불완전.
2. **review** — `review-council` 서브에이전트가 Context Pack을 읽고 `ReviewCouncilResultSchema`에 맞는 JSON만 반환한다: finding(심각도 `blocker`/`major`/`minor`/`info`), 요구사항별 verdict, 모순(contradiction) 레코드, 신규 Gap 초안.
3. **record** — `record_review_council_result`가 결과를 검증하고 리뷰 리포트(MD)·구조화 결과(JSON) 아티팩트를 기록한다.

### Verdict 체계

코드에 정의된 판정은 두 층이다:

- **요구사항별 verdict** (`RequirementVerdictSchema`): `accepted` / `partial` / `blocked` / `rejected` / `unverified`. 각 verdict는 evidence·artifact·gap·finding ID를 인용해야 한다.
- **레인 전체 VerificationAgentResult status** — record 시점에 결정적으로 계산된다:
  - blocker finding이 있고 참조된 Gap ID가 있으면 → `blocked`
  - blocker finding이 있지만 참조 Gap이 없으면 → `failed`
  - blocker finding이 없으면 → `passed`

### Gap Ledger 갱신 규칙

- 서브에이전트의 `newGapDrafts`는 record 시 실제 Gap 엔트리로 변환된다 — `status: "open"`, `metadata.reviewFindingId`(원 finding 추적), `metadata.source: "review-council"`이 부여되고 `Run.gaps`에 append된다.
- Review Council은 새 Gap을 열 수는 있지만, resolution 아티팩트 없이 Gap을 resolve할 수 없다 (Gap 상태: `open`/`assumed`/`waived`/`resolved`; waive에는 waiver 증거가 필요).
- 열린 blocker Gap은 accepted verdict를 막는다.
- legacy feature inventory가 존재하면 매칭되는 feature coverage matrix가 승인 전에 필요하며, matrix 재실행은 같은 legacy feature의 기존 open `legacy-coverage` Gap ID를 보존해 중복 블로커가 늘지 않게 한다.
- component contract가 존재하면 컴포넌트 수준 시각 증거가 T26에서 기록될 때까지 누락이 블로커로 남아야 한다.

### 재검토 — 두 층위의 규칙

재검토 상한은 커널이 아니라 **오케스트레이터 스킬 층위**에서 강제된다. 두 층위를 구분해야 한다:

- **커널(서비스) 층위** — 재검토 횟수가 하드코딩되어 있지 않다. `prepare_review_council` → `record_review_council_result`를 다시 호출하면 최신 Run 상태로 새 Context Pack이 만들어져 몇 번이든 재검토할 수 있다. 판정도 요구사항별 verdict(`accepted`/`partial`/`blocked`/`rejected`/`unverified`)와 lane status로 기록된다.
- **오케스트레이터(스킬) 층위** — `skills/spec-to-pr/SKILL.md`가 Council 결과를 `approved`/`changes_requested`로 종합해 루프를 돌리며, **재검토는 최대 2회**로 제한한다(시각 repair loop와 별도 카운트). 2회 후에도 `changes_requested`이면 루프를 멈추고 open gap을 유지한 채 `blocked` 리포트를 만든다 — 발행하지 않는다.

자동 재작업(코드 수리) 반복의 상한은 별도로 T23의 bounded repair loop(`maxRepairAttempts`)가 관리한다.

### 범위 제외 (Non-goals)

제품 코드·API 래퍼·UI 변경, 테스트 실행, 시각 회귀 실행(→ T26), PR 발행(→ T31), 자동 머지 준비 확정은 하지 않는다. Review Council 승인은 최종 발행 준비가 아니다 — T30은 여전히 통과된 리뷰 스코어카드를 요구한다.

## 입력 상세

- **TraceabilityMatrix / OpenSpec manifest / Gherkin 인덱스·테스트 매트릭스** — 요구사항과 시나리오의 근거.
- **API 인테이크·파이프라인 아티팩트** — API 주장 검증용 유일 근거.
- **Figma 디자인 계약·인벤토리 아티팩트** — 디자인 주장 검증용.
- **component contract·component visual 아티팩트** (선택) — 컴포넌트 수준 검증.
- **legacy feature inventory·feature coverage matrix** (선택) — 마이그레이션 커버리지 검증.
- **Spec/BDD·API Contract·Design/UI AgentResult** — 교차 검토 대상.
- **기존 Gap Ledger** — 모순·정책 검사 기준.

## 출력 상세

- **ReviewCouncilContextPack** (`review-council-context-v1`) — run 요약, 증거/아티팩트/Gap 카운트, AgentResult, 프리체크 finding, 지시문.
- **ReviewCouncilResult** (`review-council-v1`):

```json
{
  "schemaVersion": "review-council-v1",
  "runId": "run_...",
  "agent": "review-council",
  "summary": "...",
  "findings": [
    {
      "id": "rf_...",
      "category": "api-contract",
      "severity": "blocker",
      "status": "open",
      "title": "...",
      "expected": "...",
      "observed": "...",
      "recommendation": "...",
      "gapIds": []
    }
  ],
  "requirementVerdicts": [
    { "requirementId": "REQ-...", "verdict": "partial", "reason": "...", "findingIds": ["rf_..."] }
  ],
  "contradictions": [],
  "newGapDrafts": []
}
```

- **ReviewCouncilReport 아티팩트** (Markdown) + 구조화 결과 아티팩트 (JSON).
- **모순 매트릭스** — requirement/agent-result/artifact/gap/evidence 간 충돌 레코드.
- **신규/갱신 Gap 엔트리** — 위 갱신 규칙대로 `Run.gaps`에 반영.
- **`review-council` VerificationAgentResult** — status `passed`/`failed`/`blocked`, 리포트·결과 아티팩트와 참조 Gap ID 포함.

## 완료 조건 (Definition of Done)

- [ ] 리뷰 finding 모델이 존재한다.
- [ ] 요구사항 verdict 모델이 존재한다.
- [ ] 모순 매트릭스 모델이 존재한다.
- [ ] 결정적 프리체크가 실행된다.
- [ ] 리뷰 Context Pack이 생성된다.
- [ ] `review-council` 서브에이전트가 사용 가능하다.
- [ ] Review Council 결과를 기록할 수 있다.
- [ ] 리뷰 리포트 아티팩트가 Run에 추가된다.
- [ ] 신규 Gap을 Run에 append할 수 있다.
- [ ] MCP stdio 테스트가 Review Council 흐름을 커버한다.

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

- 리뷰 모델·프리체크·렌더러·`ReviewCouncilService` 테스트 통과.
- MCP stdio 통합에서 `prepare_review_council`, `get_review_council_context`, `record_review_council_result` 호출 성공.

## 알려진 한계

- Review Council은 제품 코드를 수정하지 않고, 테스트·시각 회귀를 실행하지 않는다.
- 시맨틱 리뷰 품질은 `review-council` 서브에이전트 출력에 의존한다.
- 결정적 프리체크는 불완전하며 계속 늘어난다.
- Gap 해소에는 여전히 resolution 아티팩트가 필요하다.
- legacy 동작 커버리지는 보수적이어서 런타임 전용 분기에는 수동 증거가 필요할 수 있다.
- `approved`/`changes_requested` 같은 단일 종합 verdict와 재검토 2회 상한은 커널 코드가 아니라 오케스트레이터 스킬(`skills/spec-to-pr/SKILL.md`)이 강제한다 — 커널 판정 자체는 요구사항별 verdict와 passed/failed/blocked status로 표현된다.
