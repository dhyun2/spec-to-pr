# SpecToPR 1.0.0 PR 템플릿 설계

- 상태: Accepted
- 목표 릴리스: `1.0.0`
- report schema: `pr-report-v2.1` (1.0 reviewer-first template extension)
- 작성일: 2026-08-07
- 범위: PR/MR 기본 본문 렌더링 계약

## 1. 결정

`pr-report-v2.1` 데이터 모델은 하나로 유지하고, PR 기본 본문 renderer를 다음 네 종류로
분리한다.

1. `legacy-migration`
2. `brief-delivery`
3. `feature-flow`
4. `figma-ui`

한 PR에 generic 템플릿을 사용하거나 네 템플릿을 섞지 않는다. `workflow_plan`이 primary
mode와 scope를 기준으로 `templateKind`를 확정하고, `workflow_start`가 그 값을 Run policy
snapshot에 고정한다.

```ts
type PrTemplateKind = "legacy-migration" | "brief-delivery" | "feature-flow" | "figma-ui";
```

## 2. 선택 규칙

| Primary mode | `templateKind`     | 리뷰어가 가장 먼저 판단할 것                         |
| ------------ | ------------------ | ---------------------------------------------------- |
| `legacy`     | `legacy-migration` | 무엇을 어디에서 어디로 이관했고 무엇이 남았는가      |
| `brief`      | `brief-delivery`   | Brief의 수용 기준을 무엇으로 충족했는가              |
| `feature`    | `feature-flow`     | 사용자의 시작부터 완료까지 실제 흐름이 동작하는가    |
| `figma`      | `figma-ui`         | Figma 화면·상태·component가 구현과 얼마나 일치하는가 |

여러 source가 함께 있어도 primary mode가 템플릿을 고른다. 예를 들어 legacy 이관에 Figma와
OpenAPI가 보조 자료로 붙어도 `legacy-migration`을 사용한다. renderer가 changed file 이름이나
키워드로 템플릿을 다시 추론하지 않는다.

## 3. 모든 템플릿의 공통 계약

### 3.1 기본 순서

1. 제목과 한 줄 상태
2. 해결되지 않은 Gap — 존재할 때만
3. 템플릿별 핵심 요약
4. UI 범위의 화면 비교 — UI면 반드시
5. Feature 사용자 흐름 영상 — `feature-flow`이면 반드시
6. 구현 내용
7. 검증 결과
8. 리뷰 방법
9. 리뷰에 실제로 필요한 상세 증빙 — 존재할 때만 접어서 표시

Gap은 상태 줄 바로 아래에 둔다. 구현 요약이나 성공 결과 아래로 밀지 않는다.

### 3.2 Gap block

`open`, `assumed`, `waived` Gap을 모두 표시한다. `resolved`만 기본 본문에서 제외하고 canonical
report와 로컬 evidence에 남긴다.

| 필드        | 의미                                                                         |
| ----------- | ---------------------------------------------------------------------------- |
| 상태        | `Open`, `Assumed`, `Waived`                                                  |
| Gap         | 확인된 사실만 한 문장으로 설명                                               |
| 영향        | 사용자·제품·리뷰 판단에 미치는 결과                                          |
| 리뷰어 결정 | `수정 필요`, `허용 여부`, `정보 필요`, `후속 작업 허용`처럼 지금 필요한 결정 |

모든 열은 값이 있을 때만 row를 만든다. 비어 있는 row, placeholder, 빈 checklist는 생성하지
않는다.

```md
## 먼저 결정할 Gap

| 상태 | Gap                      | 영향                       | 리뷰어 결정                  |
| ---- | ------------------------ | -------------------------- | ---------------------------- |
| Open | 제출 payload 일부 미확인 | 제출 동작은 safe stub 상태 | API 담당자 payload 확인 필요 |
```

### 3.3 UI 화면 비교 block

네 템플릿 중 어느 것을 사용하더라도 `scope.ui=true`이면 화면 비교를 반드시 실행하고 본문에
표시한다. `figma-ui`는 항상 UI scope다. mode나 template이 화면 비교를 끌 수 없다.

- route, state, viewport별 모든 `visualTargets`를 표시한다.
- 결과는 `Passed`, `Failed`, `Not-run` 중 하나다.
- `Failed`와 `Not-run`은 상단 Gap과 연결한다.
- 기준 출처와 실제 임계값을 표시한다.
- baseline/current는 같은 크기로 나란히 표시한다.
- diff/overlay는 진단 링크로 둔다.
- 실패 target은 펼쳐서 표시하고, 통과 target은 요약하거나 접을 수 있다.
- target이 하나라도 누락되면 자동으로 `Not-run + Gap`이다.

```md
## 화면 비교

| 화면/상태        | 결과   | 일치율 | 기준 | 기준 출처      | 증빙               | Gap   |
| ---------------- | ------ | -----: | ---: | -------------- | ------------------ | ----- |
| 상품 목록 / 기본 | Passed |  96.8% |  92% | Legacy runtime | 기준 · 현재 · Diff | —     |
| 상품 상세 / 오류 | Failed |  90.7% |  92% | Legacy runtime | 기준 · 현재 · Diff | GAP-3 |
```

기준 획득이나 capture가 실패해도 section을 생략하지 않는다. 일치율은 `—`, 결과는 `Not-run`,
이유와 존재하는 증빙만 표시하고 Draft를 계속 만든다.

### 3.4 Feature 사용자 흐름 영상 block

`feature-flow`는 사용자 흐름 영상이 필수다. UI가 없는 내부 feature라는 이유로
`feature-flow`를 선택했다면 renderer가 아니라 `workflow_plan`에서 mode/template 선택을 다시
검토한다.

영상은 다음 조건을 만족한다.

- 사용자 시작 상태부터 성공 또는 의도한 종료 상태까지 한 개의 대표 흐름
- 현재 review packet의 head와 fixture에 묶인 `.webm` 또는 `.mp4`
- 시나리오 이름, 시작점, 종료점, 결과, 재생 링크
- 민감 정보 redaction
- 임의 대기나 편집으로 실패 구간을 숨기지 않음

영상 획득 실패는 section 삭제가 아니라 `Not-run + merge-blocking Gap`이다. Draft PR은 만들 수
있지만 verified 또는 merge recommended가 될 수 없다.

```md
## 사용자 흐름 영상

| 시나리오               | 실행 결과 | 시작 → 종료                | 영상        | Gap |
| ---------------------- | --------- | -------------------------- | ----------- | --- |
| 상품 선택 후 예약 완료 | Passed    | 목록 진입 → 예약 완료 화면 | ▶ 흐름 재생 | —   |
```

### 3.5 검증 상태

실행 여부와 판정을 섞지 않는다.

| 검증             | 실행               | 판정                                | 핵심 결과                |
| ---------------- | ------------------ | ----------------------------------- | ------------------------ |
| 기능 리뷰        | `Executed`         | `Passed/Failed/Changes requested`   | reviewer가 볼 한 문장    |
| 화면 비교        | `Executed/Not-run` | `Passed/Failed/—`                   | 통과 target 수와 전체 수 |
| 사용자 흐름 영상 | `Executed/Not-run` | `Passed/Failed/—`                   | Feature에서만 출력       |
| 디자인·접근성    | `Executed/Not-run` | `Passed/Failed/Changes requested/—` | UI에서만 출력            |
| 대상 테스트      | `Executed/Not-run` | `Passed/Failed/—`                   | pass/fail 수와 실패 영향 |

적용 대상이 아닌 검증 row는 출력하지 않는다. `Skipped` row나 빈 checklist를 채워 넣지 않는다.

### 3.6 기본 PR 본문에서 제외

다음 정보는 네 템플릿 모두에서 기본 본문에 출력하지 않는다.

- 내부 tool log, terminal log, raw stack trace
- Run ID, revision, stage machine 상태, resume 정보
- token budget, workload 추정, reasoning 정보
- Skill 이름과 agent 실행 지시
- schema version, artifact ID, 전체 digest dump
- 값이 없는 section, 빈 표, 빈 checklist, placeholder 문구
- Gap이 없는 전체 API inventory
- 의미 없는 전체 변경 파일 목록
- OpenSpec 내부 경로와 archive 절차

Run ID와 내부 로그는 `workflow_status`, 로컬 canonical report, debug artifact에서만 조회한다.
리뷰에 필요한 전체 파일·API mapping·증빙 링크는 값이 있을 때만 `<details>`에 렌더링할 수
있지만, raw log와 Run ID는 그 안에도 넣지 않는다.

## 4. Legacy migration 템플릿

### 목적

리뷰어가 정확한 legacy source → target, 이관 범위, 제외 범위, API/UI Gap을 판단한다.

### 기본 본문

```md
# Legacy migration — {{title}}

상태: {{reviewStatusLine}}

{{#if unresolvedGaps}}

## 먼저 결정할 Gap

{{gapTableWithImpactAndReviewerDecision}}
{{/if}}

## 이관 요약

- {{userVisibleMigrationSummary}}
- {{confirmedApiAndBehaviorSummary}}

| Legacy source | Target     | 이관 범위 |
| ------------- | ---------- | --------- |
| {{source}}    | {{target}} | {{scope}} |

## 이관 범위

| 항목                | 결과                      | 설명                     |
| ------------------- | ------------------------- | ------------------------ |
| {{routeOrBehavior}} | Migrated / Excluded / Gap | {{reviewRelevantReason}} |

{{#if uiScope}}

## 화면 비교

{{mandatoryVisualComparison}}
{{/if}}

## 구현 내용

{{implementedBehaviorBullets}}

## 검증 결과

{{applicableValidationRowsOnly}}

## 리뷰 방법

{{routesFixturesAndInteractions}}

{{#if reviewerRelevantDetails}}
<details>
<summary>상세 변경 파일·API 매핑·증빙</summary>
{{reviewerRelevantDetails}}
</details>
{{/if}}
```

규칙:

- source/target mapping은 필수이며 fuzzy path를 허용하지 않는다.
- 확인된 API 수와 남은 API Gap은 요약하되 Gap이 없는 전체 inventory는 숨긴다.
- UI 이관이면 실행 legacy 또는 승인된 기준 화면과 비교한다.
- 제외 범위에는 이유와 후속 여부를 표시한다.

## 5. Brief delivery 템플릿

### 목적

리뷰어가 Brief의 수용 기준과 실제 구현·검증의 대응 관계를 판단한다.

### 기본 본문

```md
# Brief delivery — {{title}}

상태: {{reviewStatusLine}}

{{#if unresolvedGaps}}

## 먼저 결정할 Gap

{{gapTableWithImpactAndReviewerDecision}}
{{/if}}

## 전달 요약

{{userVisibleDeliveryBullets}}

## 수용 기준 충족

| 수용 기준     | 구현 결과          | 검증         | 판정                  |
| ------------- | ------------------ | ------------ | --------------------- |
| {{criterion}} | {{implementation}} | {{evidence}} | Passed / Failed / Gap |

{{#if uiScope}}

## 화면 비교

{{mandatoryVisualComparison}}
{{/if}}

## 구현 내용

{{implementedBehaviorAndKeyModules}}

## 검증 결과

{{applicableValidationRowsOnly}}

## 리뷰 방법

{{routesFixturesAndAcceptanceSteps}}

{{#if reviewerRelevantDetails}}
<details>
<summary>상세 변경 파일·API 매핑·증빙</summary>
{{reviewerRelevantDetails}}
</details>
{{/if}}
```

규칙:

- Brief 원문 전체를 복사하지 않고 reviewer가 판단할 수용 기준만 표시한다.
- acceptance row가 하나도 없으면 빈 표를 만들지 않고 Gap을 만든다.
- UI criterion이 있으면 화면 비교를 생략할 수 없다.
- API·성능 등 비-UI 검증은 Brief와 scope가 요구할 때만 표시한다.

## 6. Feature flow 템플릿

### 목적

리뷰어가 사용자의 시작점, 주요 interaction, 성공·오류 종료 상태를 영상과 검증으로 확인한다.

### 기본 본문

```md
# Feature flow — {{title}}

상태: {{reviewStatusLine}}

{{#if unresolvedGaps}}

## 먼저 결정할 Gap

{{gapTableWithImpactAndReviewerDecision}}
{{/if}}

## 사용자 흐름 요약

{{entryState}} → {{keyInteraction}} → {{completionState}}

- {{userVisibleBehaviorBullets}}

## 사용자 흐름 영상

{{mandatoryCurrentPacketFeatureVideo}}

{{#if uiScope}}

## 화면 비교

{{mandatoryVisualComparison}}
{{/if}}

## 구현 내용

{{implementedFlowStatesAndKeyModules}}

## 검증 결과

{{applicableValidationRowsIncludingVideo}}

## 리뷰 방법

{{entryRouteFixtureAndFlowSteps}}

{{#if reviewerRelevantDetails}}
<details>
<summary>상세 변경 파일·API 매핑·증빙</summary>
{{reviewerRelevantDetails}}
</details>
{{/if}}
```

규칙:

- 사용자 흐름 영상 section은 항상 존재한다.
- 영상은 현재 packet의 대표 happy path를 담고, 오류 흐름이 핵심이면 추가 영상 또는 명확한
  검증 evidence를 제공한다.
- 영상이 없으면 `Not-run`과 상단 Gap을 표시하며 section을 숨기지 않는다.
- UI가 포함되면 영상과 별개로 route/state별 화면 비교도 필수다. 영상은 pixel comparison을
  대신하지 않는다.

## 7. Figma UI 템플릿

### 목적

리뷰어가 Figma node/state와 구현 route/state의 대응, 시각 일치율, 디자인 시스템 예외를
판단한다.

### 기본 본문

```md
# Figma UI — {{title}}

상태: {{reviewStatusLine}}

{{#if unresolvedGaps}}

## 먼저 결정할 Gap

{{gapTableWithImpactAndReviewerDecision}}
{{/if}}

## 디자인 구현 요약

{{implementedScreenAndInteractionBullets}}

| Figma 화면/상태 | 구현 route/state | 범위            |
| --------------- | ---------------- | --------------- |
| {{figmaNode}}   | {{routeState}}   | {{screenScope}} |

## 화면 비교

{{mandatoryFigmaVisualComparison}}

## 디자인 시스템 적용

| 항목              | 사용한 component/token/asset | 예외 또는 차이      |
| ----------------- | ---------------------------- | ------------------- |
| {{designElement}} | {{implementationMapping}}    | {{exceptionOrNone}} |

## 구현 내용

{{implementedComponentsInteractionsAndResponsiveStates}}

## 검증 결과

{{applicableValidationRowsOnly}}

## 리뷰 방법

{{routesFixturesViewportsAndInteractions}}

{{#if reviewerRelevantDetails}}
<details>
<summary>상세 변경 파일·디자인 매핑·증빙</summary>
{{reviewerRelevantDetails}}
</details>
{{/if}}
```

규칙:

- `figma-ui`는 항상 UI scope이며 화면 비교 section을 조건부로 만들지 않는다.
- 모든 Figma target node/state가 비교 결과를 가져야 한다.
- 디자인 시스템 mapping은 reviewer에게 의미 있는 component, token, asset, 예외만 보여준다.
- Figma capture metadata와 digest 전체는 기본 본문에서 제외한다.

## 8. Renderer 불변식

1. `templateKind`는 plan에서 확정되고 publish 시 다시 추론하지 않는다.
2. unresolved Gap이 있으면 모든 템플릿에서 상태 줄 바로 아래에 Gap block을 렌더링한다.
3. 모든 Gap row는 영향과 리뷰어 결정을 가진다.
4. UI scope는 template과 관계없이 화면 비교 block을 가진다.
5. `feature-flow`는 사용자 흐름 영상 block을 가진다.
6. 필수 evidence가 없으면 section을 숨기지 않고 `Not-run + Gap`으로 표시한다.
7. 값이 없는 선택 section과 row는 완전히 생략하며 빈 checklist를 만들지 않는다.
8. internal log와 Run ID는 어떤 기본 PR variant에도 나타나지 않는다.
9. 동일 canonical report를 다시 렌더링하면 byte-stable한 본문을 만든다.
10. host adapter는 renderer 결과를 수정하지 않고 그대로 create/update한다.

## 9. 필수 snapshot·회귀 테스트

| Case                      | 기대 결과                                           |
| ------------------------- | --------------------------------------------------- |
| Legacy + UI + API Gap     | 상단 Gap, source→target, 필수 화면 비교             |
| Legacy + non-UI           | 화면 비교 section 없음, 이관/API 검증만 표시        |
| Brief + UI                | 수용 기준 뒤 필수 화면 비교                         |
| Brief + non-UI            | 화면 비교와 빈 UI checklist 없음                    |
| Feature + UI              | 상단 Gap, 사용자 영상, 화면 비교 모두 표시          |
| Feature video missing     | 영상 `Not-run`, merge-blocking Gap, Draft 생성 가능 |
| Figma UI                  | node→route mapping과 전체 target 화면 비교 필수     |
| No unresolved Gap         | Gap heading/table 자체가 없음                       |
| Validation not applicable | row와 빈 checklist 자체가 없음                      |
| Debug metadata present    | Run ID와 raw log가 PR 본문에 없음                   |

각 template은 `verified`, `draft-with-gaps`, visual `failed`, visual `not-run` fixture를
snapshot으로 검증한다. Feature는 video `passed`와 `not-run` fixture를 추가한다.
