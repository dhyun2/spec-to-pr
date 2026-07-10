---
sidebar_position: 26
title: "T26 · 시각 회귀와 스크린샷 비교"
sidebar_label: "T26 시각 회귀"
---

# T26 · 시각 회귀와 스크린샷 비교

> **한 줄 요약** — 저장된 baseline 스크린샷(Figma 또는 legacy 캡처)과 통합 구현의 브라우저 스크린샷을 픽셀 단위로 비교해 시각적 증거와 [Gap](/reference/glossary#gap)을 생산한다.

| 항목              | 내용                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| **목적**          | 기능 테스트가 통과해도 UI가 디자인/레거시 기준에서 벗어날 수 있으므로, 시각적 일치를 수치화된 증거로 남긴다       |
| **입력**          | Run ID, baseline 스크린샷 아티팩트(T10/T17 또는 legacy 캡처), 통합 worktree 구현(T23), 마스크 영역, 컴포넌트 계약 |
| **출력**          | 비교 지표·overlay·diff 아티팩트, VisualReport, visual Gap — T30 리포트와 visual repair 루프가 소비                |
| **선행 태스크**   | T23                                                                                                               |
| **병렬 가능**     | T24, T25, T27, T28, T29 (T26~T29는 서로 완전 병렬)                                                                |
| **관련 스킬**     | `/spec-to-pr:run-visual-regression`, `/spec-to-pr:run-visual-repair-loop`                                         |
| **담당 에이전트** | `agents/visual-regression-reviewer.md`                                                                            |

## 왜 필요한가

기능 테스트가 전부 통과해도 UI는 여전히 Figma, 레거시 baseline, 컴포넌트 계약과 어긋날 수 있다. 시스템은 다음 시각적 증거를 생산해야 한다:

- Figma 또는 legacy baseline 스크린샷
- 브라우저 실측 스크린샷
- overlay 이미지, diff 히트맵
- exact match / review match 지표
- 마스크 영역, 시각 리포트, visual gap

## 동작 흐름

1. `plan_visual_regression` — VisualTarget(route, viewport, baseline 아티팩트, 마스크, `comparisonScope`)을 계획한다.
2. `capture_browser_screenshots` — Playwright + Chromium으로 통합 구현의 스크린샷을 캡처한다.
3. `compare_visual_snapshots` — 마스크를 적용한 뒤 픽셀을 비교해 지표를 계산한다 (`src/visual/image-comparator.ts`).
4. 게이트 정책(`src/visual/visual-policy.ts`)으로 pass/fail을 판정한다: `exactMatchRatio ≥ 0.95` **또는** `reviewMatchRatio ≥ 0.8`이면 `passed`. review 픽셀 판정 거리 임계값은 `reviewDistanceThreshold: 64` (색 거리 0~441), `failBelowReviewThreshold: true`가 기본이다.
5. 실패 비교는 visual [Gap](/reference/glossary#gap)을 만들고, VisualReport를 [ArtifactRef](/reference/glossary#artifactref)로 [Run](/reference/glossary#run)에 기록한다.
6. `record_visual_review_result` — `visual-regression-reviewer` 에이전트가 mismatch 원인을 분류(triage)해 기록한다. 에이전트는 pass/fail을 결정하지 않고 소스 코드를 수정하지 않는다.
7. **Bounded visual repair 루프** (`/spec-to-pr:run-visual-repair-loop`, `src/visual/visual-repair-policy.ts`) — 판정 지표는 기본 `reviewMatchRatio`이고 `exactMatchRatio`로 바꿀 수 있다. 정책 기본값:
   - `minPassingScore: 0.98` — 가장 낮은 타깃 점수가 이 값 미만이면 실패로 간주
   - `maxAttempts: 3` (설정 가능, 상한 20)
   - `retryOnReviewNeeded: true` — `review-needed` 타깃도 재시도 대상
   - 판정: 전 타깃 통과 → `passed`; 실패 타깃 존재 + 시도 여유 → `retry` (nextOwner `design-ui`); 시도 소진 → `failed` (nextOwner `human`)

## 입력 상세

- **Baseline 모드** — `visualBaseline`은 기본값 `figma`. 레거시 마이그레이션 Run은 `visualBaseline: "legacy-screenshot"`으로 설정해 레거시 화면 캡처 대 타깃 구현으로 pass/fail을 판정한다 (`VisualBaselineModeSchema`, `src/visual/visual-model.ts`).
- **비교 범위** — `comparisonScope`는 `screen`(기본) 또는 `component`. 컴포넌트 계약이 있으면 전체 화면 리포트에 더해 `component` 범위 리포트가 요구된다.
- **마스크 영역** — 이름·좌표·사유를 가진 VisualMaskRegion. 동적 영역은 명시적으로 제공된 마스크만 제외된다.
- **VisualTarget** — route, viewport(width/height/deviceScaleFactor/isMobile), baseline 아티팩트 ID, 컴포넌트 계약 메타데이터.

## 출력 상세

VisualReport의 비교 지표(`VisualComparisonMetricsSchema`):

```json
{
  "visualBaseline": "figma",
  "comparisonScope": "screen",
  "results": [
    {
      "targetId": "vt-dashboard-desktop",
      "status": "passed",
      "metrics": {
        "width": 1440,
        "height": 900,
        "comparedPixelCount": 1284000,
        "maskedPixelCount": 12000,
        "exactMatchRatio": 0.9931,
        "reviewMatchRatio": 0.9987,
        "meanDistance": 1.42,
        "maxDistance": 96
      }
    }
  ]
}
```

- **overlay / diff 히트맵 아티팩트** — 시각적 검토용.
- **VisualReviewResult** — 리뷰어 에이전트의 finding(카테고리: `implementation-mismatch`, `design-contract-gap`, `fixture-data-mismatch`, `dynamic-region-mask-needed`, `excessive-mask`, `font-rendering-tolerance`, `acceptable-difference`, `reviewer-needed`).
- **visual Gap** — 실패 비교 건.

## 완료 조건 (Definition of Done)

- [ ] 시각 타깃 모델이 존재한다.
- [ ] 브라우저 스크린샷을 캡처할 수 있다.
- [ ] Figma/legacy baseline과 브라우저 스크린샷을 비교할 수 있다.
- [ ] 시각 리포트가 `visualBaseline`, `comparisonScope`, 컴포넌트 계약 메타데이터를 기록한다.
- [ ] 컴포넌트 수준 시각 리포트가 공식 시각 증거로 인정된다.
- [ ] 마스크 영역이 적용·기록된다.
- [ ] exactMatchRatio와 reviewMatchRatio가 계산된다.
- [ ] diff·overlay 아티팩트가 생산된다.
- [ ] 시각 리포트 아티팩트가 기록되고, 실패 비교가 visual gap을 생성한다.
- [ ] 스킬과 리뷰어 에이전트가 문서화되어 있다.

## 검증 방법

```bash
pnpm format:check
pnpm typecheck
pnpm schemas:build
pnpm build
pnpm test
pnpm audit
```

선택적 브라우저 설치:

```bash
pnpm exec playwright install --with-deps chromium
```

기대 결과:

- image mask / image comparator / visual policy 테스트 통과
- VisualRegressionService 테스트 통과
- legacy baseline·component scope 정책 테스트 통과
- MCP stdio 통합 테스트에서 `plan_visual_regression`, `capture_browser_screenshots`, `compare_visual_snapshots`, `get_visual_report`, `record_visual_review_result` 나열

## 알려진 한계

- Figma/legacy baseline 스크린샷이 Run 아티팩트로 이미 존재해야 한다.
- 브라우저 캡처는 Playwright와 설치된 Chromium이 필요하다. 다운로드된 플러그인 런타임에 Playwright가 없으면 캡처 툴은 Node 모듈 해석 오류 대신 blocked visual-capture dependency gap을 보고한다.
- 이 태스크는 대상 프로젝트의 dev 서버를 실행하지 않는다.
- 동적 영역은 마스크가 명시적으로 제공될 때만 제외된다.
- 시각 차이는 gap으로 기록되어 bounded visual repair 루프(최대 3회 기본)로 전달될 수 있으며, 루프 소진 시 사람에게 넘어간다.
- UI 코드 수정·baseline 자동 갱신·Figma MCP 호출은 하지 않는다.
