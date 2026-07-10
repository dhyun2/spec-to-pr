---
sidebar_position: 12
title: "T12 · OpenAPI 인테이크 어댑터"
sidebar_label: "T12 OpenAPI 인테이크"
---

# T12 · OpenAPI 인테이크 어댑터

> **한 줄 요약** — 등록된 OpenAPI [Source](/reference/glossary#source) 스냅샷을 파싱해 operation·schema·security·`$ref` 인벤토리와 API [Gap](/reference/glossary#gap)을 생성하는 태스크.

| 항목              | 내용                                                                                                                                                                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **목적**          | 클라이언트/래퍼/목/계약 테스트를 생성하기 전에, OpenAPI 문서에 어떤 operation·schema·security scheme·응답·결함이 있는지 구조화된 API 증거로 만든다                                                                                                          |
| **입력**          | [Run](/reference/glossary#run) ID, 등록된 OpenAPI Source ID와 스냅샷 내용 (T07 Source Registry의 산출물)                                                                                                                                                    |
| **출력**          | `openapi-normalized-document`·`openapi-intake-report` 아티팩트, operation/schema/security/`$ref` 인벤토리, [EvidenceRef](/reference/glossary#evidence)·API Gap 엔트리 → T13([EvidenceGraph](/reference/glossary#evidencegraph)), T16(API 파이프라인)이 소비 |
| **선행 태스크**   | T07 (OpenAPI 문서가 `openapi` Source로 등록되어 있어야 함)                                                                                                                                                                                                  |
| **병렬 가능**     | T08 (Brief), T09~T11 (Figma 인테이크 계열)                                                                                                                                                                                                                  |
| **관련 스킬**     | `/spec-to-pr:analyze-openapi`                                                                                                                                                                                                                               |
| **담당 에이전트** | -                                                                                                                                                                                                                                                           |

## 왜 필요한가

OpenAPI 문서는 핵심 API 증거다. 어떤 operation·schema·security scheme·request body·response가 존재하고 무엇이 빠져 있는지 알기 전에 클라이언트, 래퍼, 목, 계약 테스트를 생성해서는 안 된다.

T12가 없으면 T13은 요구사항을 API 증거에 연결할 수 없고, T16은 무엇을 생성해야 하는지에 대한 결정적(deterministic) 근거 없이 코드를 만들게 된다. T12는 원시 Source 스냅샷을 구조화된 API 증거로 바꾸는 관문이다.

## 동작 흐름

1. Run과 등록된 OpenAPI Source 스냅샷을 로드한다.
2. JSON/YAML을 파싱한다 (`src/openapi/openapi-parser.ts`).
3. 버전 종류를 판별한다 — `openapi-3.0`, `openapi-3.1`, `swagger-2.0`, `unknown`. 3.0.x/3.1.x만 지원하며 Swagger 2.0은 감지하되 미지원으로 보고한다.
4. 최소 구조 검증을 수행한다.
5. operation / schema / security scheme / `$ref` 인벤토리를 생성한다 (`src/openapi/openapi-inventory.ts`).
6. 결정적 규칙으로 API Gap 후보를 생성한다 (`src/openapi/openapi-gaps.ts`).
7. `Run.evidence` / `Run.artifacts` / `Run.gaps`에 저장한다.

### 처리 규칙

- OpenAPI description은 신뢰할 수 없는 데이터이지 지시문이 아니다 — `prompt-injection-like-description` 감지 규칙이 존재한다.
- `$ref` 값은 인벤토리에 기록하되 기본적으로 dereference하지 않는다. 원격/외부 `$ref` 해석은 이후 정책 인지 생성 단계로 미룬다.
- 라이브 API 호출, 외부 린터 실행, 원격 `$ref` 네트워크 fetch는 하지 않는다.

### 범위 제외 (Non-goals)

TypeScript 타입·Zod 스키마·API 클라이언트·래퍼·MSW 목·계약 테스트 생성(→ T16), 요구사항-엔드포인트 매칭, Figma-엔드포인트 매칭(→ T13), OpenAPI diff·breaking-change 판정은 이 태스크에서 하지 않는다.

## 입력 상세

- **Run ID** — 대상 Run.
- **OpenAPI Source ID** — `register_file_source`로 content-addressed `openapi` Source로 등록된 문서.
- **Source 스냅샷 내용** — JSON 또는 YAML 원문.

## 출력 상세

- `openapi-normalized-document` 아티팩트 — 정규화된 문서.
- `openapi-intake-report` 아티팩트 — 인테이크 리포트.
- operation / schema / security scheme / `$ref` 인벤토리.
- operation·schema에 대한 EvidenceRef (JSON Pointer 위치에 연결).
- API Gap 엔트리 — Gap 후보는 실제 코드의 `OpenApiGapCandidateSchema`를 따른다:

```json
{
  "code": "missing-operation-id",
  "severity": "major",
  "category": "api",
  "title": "Operation is missing operationId"
}
```

Gap 후보 코드 전체: `unsupported-openapi-version`, `missing-paths`, `missing-operation-id`, `duplicate-operation-id`, `missing-success-response`, `missing-error-response`, `unknown-security-scheme`, `empty-components-schemas`, `endpoint-inventory-schema-missing`, `remote-ref-not-resolved`, `prompt-injection-like-description`.

- 갱신된 Run — 이후 T13·T16이 이 [ArtifactRef](/reference/glossary#artifactref)들을 소비한다.

## 완료 조건 (Definition of Done)

- [ ] OpenAPI Source 스냅샷을 파싱할 수 있다 (JSON·YAML 모두).
- [ ] OpenAPI 버전 종류가 판별된다.
- [ ] operation / schema / security scheme / `$ref` 인벤토리가 생성된다.
- [ ] API Gap이 `Run.gaps`에 저장된다.
- [ ] operation·schema 증거가 JSON Pointer 위치에 연결된다.
- [ ] OpenAPI 인벤토리 아티팩트가 저장된다.
- [ ] MCP stdio 통합에서 OpenAPI 분석을 호출할 수 있다.
- [ ] 파서·인벤토리·Gap 감지·서비스 흐름에 대한 단위/통합 테스트가 있다.

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

- OpenAPI 파서·operation 인벤토리·API Gap 감지·`OpenApiIntakeService` 테스트 통과.
- MCP stdio 통합에서 `register_file_source`와 `analyze_openapi_source` 호출 성공.

구현된 MCP 표면:

- `register_file_source` — OpenAPI 문서를 content-addressed `openapi` Source로 기록.
- `analyze_openapi_source` — Source 스냅샷을 읽어 정규화된 OpenAPI 인테이크 증거를 저장.

## 알려진 한계

- Swagger 2.0은 변환하지 않는다 (감지만 하고 미지원 보고).
- `$ref`는 인벤토리에만 기록하고 dereference하지 않으며, 외부 URL ref는 해석하지 않는다.
- TypeScript/Zod/클라이언트/래퍼/계약 테스트 생성은 T16에서 수행한다.
- 외부 도구를 이용한 전체 OpenAPI 린팅은 이후 단계로 미룬다.
