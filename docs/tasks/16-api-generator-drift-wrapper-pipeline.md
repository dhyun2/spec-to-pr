---
sidebar_position: 16
title: "T16 · API 생성기·드리프트·래퍼 파이프라인"
sidebar_label: "T16 API 파이프라인"
---

# T16 · API 생성기·드리프트·래퍼 파이프라인

> **한 줄 요약** — OpenAPI 증거로부터 타입·Zod 스키마·클라이언트·feature 래퍼·목·계약 테스트 스켈레톤·소스 가드를 생성하거나 검증하고, 생성물의 드리프트를 digest로 추적하는 태스크.

| 항목              | 내용                                                                                                                                                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **목적**          | T12의 OpenAPI 증거를 실제 코드 산출물(타입/스키마/클라이언트/래퍼/목/계약 테스트/가드)로 변환하고, 문서와 생성 코드의 불일치(드리프트)를 감지 가능하게 만든다                                                                                         |
| **입력**          | [Run](/reference/glossary#run) ID, OpenAPI 인테이크 리포트 아티팩트(T12), 프로젝트 프로필(T06), [TraceabilityMatrix](/reference/glossary#traceabilitymatrix)(T13), 대상 source key·생성 경로·래퍼 경로                                                |
| **출력**          | 생성된 타입/스키마/클라이언트/래퍼/목/계약 테스트/소스 가드 파일, API 파이프라인 리포트 [ArtifactRef](/reference/glossary#artifactref), generated-file-manifest, API [Gap](/reference/glossary#gap) → T18 컨텍스트 팩과 T20(API Contract 레인)이 소비 |
| **선행 태스크**   | T14 (파이프라인 순서 기준; 데이터로는 T12 인테이크 아티팩트 필요)                                                                                                                                                                                     |
| **병렬 가능**     | T15 (Gherkin), T17 (디자인 계약)                                                                                                                                                                                                                      |
| **관련 스킬**     | `/spec-to-pr:generate-api-pipeline`                                                                                                                                                                                                                   |
| **담당 에이전트** | -                                                                                                                                                                                                                                                     |

## 왜 필요한가

T12는 OpenAPI 문서를 분석하지만 API 코드를 생성하지 않는다. T16이 없으면 T20(API Contract 에이전트)은 임의로 클라이언트를 만들거나, UI가 생성 클라이언트를 직접 import하는 구조 위반이 감지되지 않은 채 진행된다.

T16은 OpenAPI 증거를 다음으로 변환한다:

- 생성된 TypeScript 타입
- 생성된 API 클라이언트 또는 기존 클라이언트 연결
- 지원되는 범위의 Zod 런타임 스키마
- feature 레벨 API 래퍼
- 목(MSW) 핸들러 스켈레톤
- 계약 테스트 스켈레톤
- 소스 가드 테스트
- API 파이프라인 리포트

## 동작 흐름

1. Run에서 `openapi-intake-report` 아티팩트와 OpenAPI 인벤토리를 로드한다 (`src/application/api-pipeline-service.ts`).
2. **기존 생성기 우선 탐색** (`src/api-pipeline/api-generator-discovery.ts`, ADR-017) — package script·알려진 생성기 설정 파일을 감지한다. 기존 생성기가 있으면 `existing-generator` 모드, 없으면 `fallback-generator` 모드.
3. fallback 모드에서는 보수적 TS 타입(`types.ts`)·Zod 스키마(`schemas.ts`)·클라이언트 스켈레톤(`client.ts`)을 생성한다.
4. 문서화된 operation마다 feature 래퍼 스켈레톤을 생성한다 (`wrapper-generator.ts`). `operationId` 없는 operation은 `skipped` 처리.
5. MSW 핸들러 스켈레톤과 계약 테스트 스켈레톤을 생성한다.
6. 소스 가드 테스트를 생성한다 — UI 레이어(`pages/widgets/features`)가 생성 클라이언트를 직접 import하지 못하게 검사.
7. 파일마다 sha256 digest와 `changed` 플래그를 기록하고, API 파이프라인 리포트(JSON/MD)·generated-file-manifest·source-guard-report를 Run 아티팩트로 저장한다.

### 드리프트란 무엇인가

이 파이프라인에서 **드리프트(drift)** 는 "현재 OpenAPI 스냅샷으로부터 결정적으로 생성되어야 할 파일 내용"과 "저장소에 실제 존재하는 파일 내용"의 불일치다. 비교 대상과 판정 방식은 코드상 다음과 같다 (`src/application/api-pipeline-service.ts`):

1. **소스 고정** — 파이프라인 리포트는 입력 OpenAPI 문서의 sha256을 `openApiSourceDigest`로 기록한다. 어떤 [Source](/reference/glossary#source) 스냅샷에서 생성되었는지가 content-addressed로 고정된다 (T07의 content addressing에 의존).
2. **파일 단위 비교** — 각 파일을 쓸 때 새로 렌더링한 내용과 디스크의 기존 내용을 비교한다.
   - 내용이 동일하면 `changed: false` — 드리프트 없음, 재생성은 멱등.
   - 내용이 다르면 드리프트로 판정한다. `force`가 아니면 `File already exists with different content` 오류로 중단해 조용한 덮어쓰기를 막고, `force`일 때만 덮어쓰며 `changed: true`로 기록한다.
3. **manifest 기반 재검증** — `generated-file-manifest`가 모든 생성 파일의 경로·종류·sha256 digest를 기록하므로, 이후 Run·리뷰 단계에서 파일이 수동 편집되었는지(digest 불일치) 재확인할 수 있다.

즉 드리프트가 발생하는 두 가지 경로는 (a) OpenAPI 문서가 바뀌어(소스 digest 변경) 기존 생성 파일이 더 이상 문서와 일치하지 않는 경우, (b) 누군가 생성 파일을 수동 편집해 문서에서 결정적으로 생성한 내용과 달라진 경우다. 두 경우 모두 재생성 시 내용 비교로 드러나며, 경고·Gap 또는 명시적 `force` 결정으로만 해소된다. UI가 생성 클라이언트를 직접 import하는 문제는 드리프트가 아니라 소스 가드 테스트가 잡는 별도의 경계 위반이다.

### 생성 규칙

- 프로젝트의 기존 생성기를 우선한다 (existing-generator-first, ADR-017).
- 문서화되지 않은 operation을 발명하지 않는다.
- UI가 생성 클라이언트를 직접 import하게 두지 않는다.
- 생성 파일을 수동 편집하지 않는다.
- 지원하지 않는 스키마 기능은 경고 또는 Gap이 되어야 한다.
- 생성 파일은 소스 digest와 생성기 메타데이터를 포함해야 한다.
- 래퍼가 생성되면 소스 가드 테스트도 반드시 생성한다.

### 범위 제외 (Non-goals)

라이브 API 호출, 파괴적 스테이징 테스트, 강제 생성기 교체, UI 구현(→ T21), PR 발행, 전체 OpenAPI 시맨틱 커버리지, 사전 인테이크에서 해석되지 않은 외부 ref 번들링은 하지 않는다.

## 입력 상세

- **OpenAPI 인테이크 리포트 아티팩트** — T12 산출물 (`openApiIntakeArtifactId`).
- **프로젝트 프로필** — 생성기 탐색·경로 결정에 사용.
- **TraceabilityMatrix** — 요구사항-operation 연결 참조.
- **source key / targetWorkspace / generatedRoot / wrapperRoot / preferredCommand / force** — 생성 대상과 정책 파라미터.

## 출력 상세

- 생성 파일 — `typescript-types`, `zod-schemas`, `api-client`, `feature-wrapper`, `mock-handler`, `contract-test`, `source-guard-test` 종류.
- **API 파이프라인 리포트** (`ApiPipelineReportSchema` 기준, JSON + Markdown):

```json
{
  "adapter": "api-pipeline-v1",
  "sourceKey": "staff",
  "openApiSourceDigest": "sha256:...",
  "mode": "fallback-generator",
  "operationCount": 12,
  "generatedOperationCount": 10,
  "skippedOperationCount": 2,
  "generatedFiles": [
    {
      "kind": "feature-wrapper",
      "path": "src/shared/api/...",
      "digest": "sha256:...",
      "changed": true
    }
  ],
  "warnings": []
}
```

- **generated-file-manifest** — 드리프트 재검증용 파일·digest 목록.
- **source-guard-report** — UI glob과 금지 import 패턴 기록.
- 지원되지 않는 스키마·누락 operation에 대한 API Gap.

## 완료 조건 (Definition of Done)

- [ ] 기존 생성기 탐색이 동작한다.
- [ ] fallback 생성기가 지원 스키마에 대해 보수적 TS/Zod 파일을 생성한다.
- [ ] 래퍼 생성기가 문서화된 operation의 feature API 래퍼 스켈레톤을 생성한다.
- [ ] MSW가 감지되거나 요청되면 목 생성기가 MSW 핸들러 스켈레톤을 생성한다.
- [ ] 계약 테스트 생성기가 스키마 기반 스켈레톤을 생성한다.
- [ ] 소스 가드 테스트가 생성된다.
- [ ] API 파이프라인 리포트 아티팩트가 Run에 기록된다.
- [ ] MCP 도구가 stdio 통합 테스트로 동작한다.

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

- 생성기 탐색, TypeScript/Zod fallback 생성기, 래퍼 생성기, 목 생성기, 소스 가드 생성기 테스트와 `ApiPipelineService` 통합 테스트 통과.
- MCP stdio 통합에서 `generate_api_pipeline` 호출 성공.

## 알려진 한계

- fallback 생성기는 보수적이다 — `oneOf/anyOf/allOf` 지원이 제한적이다.
- 기존 프로젝트 생성기 어댑터는 프로젝트별 하드닝이 필요하다. existing-generator 모드에서 생성기 명령 실행은 프로젝트 명령 정책으로 미뤄지고 경고로 기록된다.
- 외부 `$ref`는 전체 생성 전에 번들링되어야 한다.
- 생성된 래퍼 import는 프로젝트별 어댑터 수정이 필요할 수 있다.
- 소스 가드는 추가 의존성 없이 Node 파일시스템 순회를 사용한다.
- 라이브 API 계약 테스트는 이 태스크에서 실행하지 않는다.
