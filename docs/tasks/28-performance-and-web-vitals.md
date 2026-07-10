---
sidebar_position: 28
title: "T28 · 성능과 Web Vitals 게이트"
sidebar_label: "T28 성능"
---

# T28 · 성능과 Web Vitals 게이트

> **한 줄 요약** — 통합 구현의 라우트에 대해 Lighthouse 랩 지표·번들 예산·[Web Vitals](/reference/glossary#web-vitals) RUM 계측 준비도(readiness)를 검사하고 성능 [Gap](/reference/glossary#gap)을 기록한다.

| 항목              | 내용                                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **목적**          | 기능 테스트·시각 검사가 보장하지 못하는 사용자 경험(로딩·반응성·레이아웃 안정성)을 랩 데이터와 계측 준비도로 검증한다            |
| **입력**          | Run ID, 통합 worktree 구현(T23), 성능 대상 라우트(OpenSpec/visual/manual), Lighthouse 실행 결과, 번들 산출물, package.json·소스  |
| **출력**          | PerformancePlan, Lighthouse 요약, budget 판정, Web Vitals readiness 리포트, performance Gap, 리포트 아티팩트 — T30 리포트가 소비 |
| **선행 태스크**   | T23                                                                                                                              |
| **병렬 가능**     | T24, T25, T26, T27, T29 (T26~T29는 서로 완전 병렬)                                                                               |
| **관련 스킬**     | `/spec-to-pr:run-performance-gate`                                                                                               |
| **담당 에이전트** | `agents/performance-reviewer.md`                                                                                                 |

## 왜 필요한가

기능 테스트와 시각 검사는 좋은 사용자 경험을 보장하지 않는다. T28은 다음을 기록한다:

- Lighthouse 랩 지표
- 번들·에셋 예산 (budget)
- Core Web Vitals 임계값
- Web Vitals RUM 계측 준비도
- 성능 gap과 성능 리뷰어 triage

## 동작 흐름

1. `plan_performance_gate` — PerformancePlan을 생성한다 (`src/performance/performance-model.ts`). Core Web Vitals 임계값 기본값: **LCP 2500ms, INP 200ms, CLS 0.1, TBT 200ms**, 라우트당 반복 실행 `repeats: 3`.
2. Lighthouse CI 설정을 렌더링한다 (`src/performance/lighthouse-config.ts`) — 플랜의 라우트 URL, `numberOfRuns`, `preset: "desktop"`, 그리고 임계값 기반 assertion을 담는다.
3. `run_performance_gate` — Lighthouse 실행 결과(JSON)를 파싱해 라우트별 `performanceScore`(categories.performance.score), `lcpMs`, `cls`, `tbtMs`, `fcpMs`, `speedIndexMs`(audits의 `numericValue`)를 요약한다 (`src/performance/lighthouse-result-parser.ts`).
4. 번들·에셋 예산을 평가한다 (`src/performance/performance-budget.ts`). 기본 예산: 초기 JS 300KB, 초기 CSS 100KB, 이미지 500KB, 폰트 200KB (`maxTransferBytes` 단위 바이트), 리소스 타입별 추가 예산 가능.
5. **Web Vitals readiness** 를 판정한다 (`src/performance/web-vitals-readiness.ts`) — 소스·package.json을 스캔해 7개 항목을 검사한다: `web-vitals` 의존성, `onLCP`/`getLCP`, `onINP`/`getINP`, `onCLS`/`getCLS` 계측, analytics sink(`sendToAnalytics`/`reportWebVitals`/`analytics.track`/`navigator.sendBeacon`), 릴리스 메타데이터, redaction 정책. 누락 0개 → `ready`, 1~2개 → `partial`, 3개 이상 → `missing`.
6. 임계값·예산 초과와 readiness 미달을 performance [Gap](/reference/glossary#gap)으로 기록하고, 리포트를 [ArtifactRef](/reference/glossary#artifactref)로 [Run](/reference/glossary#run)에 저장한다.
7. `record_performance_review` — `performance-reviewer` 에이전트가 결과를 triage 한다. 리뷰어는 소스 코드를 수정하지 않는다.

## 입력 상세

- **PerformanceRouteTarget** — `urlPath`, `label`, `source`(`openspec`/`visual`/`manual`/`route-discovery`), 뷰포트 프로파일 목록.
- **Lighthouse 결과 JSON** — CI 또는 외부 러너가 생산한 원시 리포트.
- **번들 산출물 크기** — budget checker 입력.
- **package.json + 소스 텍스트** — Web Vitals readiness 감지 입력.

## 출력 상세

Lighthouse 요약과 budget 판정 예시:

```json
{
  "lighthouse": {
    "metrics": [
      {
        "url": "http://localhost:3000/dashboard",
        "performanceScore": 0.92,
        "lcpMs": 1840.5,
        "cls": 0.02,
        "tbtMs": 110,
        "fcpMs": 920.1,
        "speedIndexMs": 1420
      }
    ]
  },
  "budget": {
    "passed": false,
    "failures": [
      {
        "kind": "initial-js",
        "observedBytes": 412300,
        "budgetBytes": 300000,
        "message": "Initial JS exceeds budget"
      }
    ]
  },
  "webVitalsReadiness": {
    "status": "partial",
    "hasWebVitalsDependency": true,
    "hasLcpInstrumentation": true,
    "hasInpInstrumentation": false,
    "hasClsInstrumentation": true,
    "hasAnalyticsSink": true,
    "hasReleaseMetadata": true,
    "hasRedactionPolicy": false,
    "notes": ["Missing INP instrumentation", "Missing redaction policy"]
  }
}
```

- **performance report 아티팩트** — 위 요약의 렌더링 결과.
- **performance Gap** — 임계값·예산·readiness 실패 건.
- **reviewer triage 아티팩트**

## 완료 조건 (Definition of Done)

- [ ] PerformancePlan이 생성된다.
- [ ] Lighthouse 실행 결과를 파싱할 수 있다.
- [ ] 번들·에셋 예산을 평가할 수 있다.
- [ ] Web Vitals 계측 준비도를 검사할 수 있다.
- [ ] 성능 리포트 아티팩트가 생산된다.
- [ ] 성능 gap이 기록된다.
- [ ] 스킬과 리뷰어 에이전트가 추가되어 있다.

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

- budget checker 테스트 통과
- Lighthouse parser 테스트 통과
- Web Vitals readiness 테스트 통과
- PerformanceGateService 테스트 통과
- MCP stdio 통합 테스트에서 `plan_performance_gate`, `run_performance_gate`, `get_performance_report`, `record_performance_review` 호출 가능

## 알려진 한계

- Lighthouse 실행 자체는 CI나 외부 러너에 위임될 수 있다 — 플러그인은 결과 파싱과 판정을 담당한다.
- T28은 랩(lab) 결과를 기록하며 프로덕션 필드(field) 데이터를 만들지 않는다. 명시적 필드 아티팩트 없이 필드 데이터를 주장하지 않는다.
- INP는 Lighthouse 직접 지표가 아니므로 필드/RUM 계측 준비도로 다룬다.
- 자동 최적화·이미지 압축·baseline 갱신은 수행하지 않는다.
- 성능 리뷰어는 소스 코드를 수정하지 않는다.
