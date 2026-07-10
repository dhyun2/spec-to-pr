---
sidebar_position: 13
title: "T13 · EvidenceGraph와 요구사항 추적성"
sidebar_label: "T13 EvidenceGraph"
---

# T13 · EvidenceGraph와 요구사항 추적성

> **한 줄 요약** — Brief 요구사항 증거, OpenAPI operation, Figma 노드, 아티팩트, Gap을 하나의 추적성 그래프로 연결해 [EvidenceGraph](/reference/glossary#evidencegraph)와 [TraceabilityMatrix](/reference/glossary#traceabilitymatrix)를 생성하는 태스크.

| 항목              | 내용                                                                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **목적**          | 입력이 파싱되었다는 사실을 넘어, 각 요구사항이 구현 관련 증거(API·Figma)에 실제로 연결되어 있음을 증명한다                                                                                                 |
| **입력**          | [Run](/reference/glossary#run) ID, Brief 증거(T08), Figma 증거·아티팩트(T09~T11), OpenAPI 증거·아티팩트(T12), 선택적 legacy feature inventory·feature coverage matrix, 기존 [Gap](/reference/glossary#gap) |
| **출력**          | EvidenceGraph·TraceabilityMatrix 아티팩트, 추적성 Gap, orphan 리포트 → T14(OpenSpec 생성)가 소비                                                                                                           |
| **선행 태스크**   | T08, T10, T11, T12                                                                                                                                                                                         |
| **병렬 가능**     | 없음 (인테이크 레인들의 합류 지점)                                                                                                                                                                         |
| **관련 스킬**     | `/spec-to-pr:build-traceability`                                                                                                                                                                           |
| **담당 에이전트** | -                                                                                                                                                                                                          |

## 왜 필요한가

T08은 Brief 증거를, T09~T11은 Figma 증거를, T12는 OpenAPI 증거를 추출한다. 그러나 개별 증거만으로는 "이 요구사항이 구현 가능한 근거를 가졌는가"를 답할 수 없다.

T13이 없으면 T14(OpenSpec)는 근거 없는 요구사항을 스펙으로 만들 수 있고, 어떤 요구사항이 API나 디자인 지원 없이 표류하는지 아무도 알 수 없다. 마이그레이션 Run에서는 legacy 코드에서 발견된 동작이 OpenSpec·Gherkin 생성 전에 유실되지 않도록 legacy feature inventory와 feature coverage matrix 아티팩트도 함께 소비한다.

## 동작 흐름

1. Run에서 Brief / Figma / OpenAPI 증거와 아티팩트를 수집한다.
2. 노드를 생성한다 (`src/traceability/node-builder.ts`) — `TraceNodeKind`: `requirement`, `api-operation`, `api-schema`, `figma-node`, `figma-component`, `figma-token`, `gap`, `artifact`.
3. 결정적 링커(`src/traceability/link-builder.ts`)가 confidence(0~1)와 사유를 붙여 엣지를 만든다 — `TraceEdgeKind`: `derived-from`, `mentions`, `requires-api`, `requires-design`, `matches-api`, `matches-figma`, `blocked-by-gap`, `supported-by-artifact`. 키워드 중첩 기반 매칭은 `min(0.95, 0.35 + score×0.6)`으로 confidence를 계산하고, 정확 매칭은 1이다.
4. TraceabilityMatrix를 생성한다. 행 상태: `linked`, `missing-api`, `missing-figma`, `missing-api-and-figma`, `blocked`.
5. API/Figma 지원이 없는 요구사항에 대해 리뷰 가능한 Gap을 생성한다 (`src/traceability/traceability-gap-detector.ts`).
6. 어떤 요구사항에도 연결되지 않은 orphan API / orphan Figma 증거를 리포트한다.
7. 마이그레이션 증거가 있으면 legacy feature coverage 리포트를 생성한다.
8. EvidenceGraph·TraceabilityMatrix를 [ArtifactRef](/reference/glossary#artifactref)로 Run에 저장한다.

### 범위 제외 (Non-goals)

OpenSpec 생성(→ T14), Gherkin·테스트 코드 생성(→ T15), API 클라이언트 생성(→ T16), UI 구현(→ T21), LLM 기반 시맨틱 매칭, 최종 리뷰 승인(→ T22)은 하지 않는다.

## 입력 상세

- **Brief 증거** — T08이 추출한 요구사항 [EvidenceRef](/reference/glossary#evidence).
- **Figma 증거·아티팩트** — T09~T11의 raw 아티팩트와 design-system 인벤토리.
- **OpenAPI 증거·아티팩트** — T12의 operation/schema 인벤토리.
- **legacy feature inventory / feature coverage matrix** (선택) — 마이그레이션 Run에서 legacy 동작 증거.
- **기존 Gap** — 이미 열린 Gap은 `blocked-by-gap` 엣지로 연결된다.

## 출력 상세

- **EvidenceGraph 아티팩트** — 노드·엣지 컬렉션 (`src/traceability/traceability-contracts.ts` 타입 기준):

```json
{
  "nodes": [
    { "id": "tn_...", "kind": "requirement", "label": "직원 목록 조회", "evidenceIds": ["ev_..."] },
    { "id": "tn_...", "kind": "api-operation", "label": "GET /staff" }
  ],
  "edges": [
    {
      "id": "te_...",
      "kind": "matches-api",
      "confidence": 0.83,
      "reason": "keyword overlap: staff"
    }
  ]
}
```

- **TraceabilityMatrix 아티팩트** — 요구사항별 행과 상태(`linked` / `missing-api` / `missing-figma` / `missing-api-and-figma` / `blocked`).
- **추적성 Gap** — API/Figma 지원 누락 요구사항, `legacy-coverage` Gap(마이그레이션).
- **orphan API / orphan Figma 리포트** — 자동 블로커가 아닌 리포트.
- **legacy feature coverage 리포트** (마이그레이션 증거가 있을 때).
- 갱신된 Run.

## 완료 조건 (Definition of Done)

- [ ] Brief 증거에서 requirement 노드가 생성된다.
- [ ] OpenAPI 증거에서 api-operation 노드가 생성된다.
- [ ] Figma 증거/아티팩트에서 figma 노드가 생성된다.
- [ ] confidence와 사유가 있는 결정적 링크가 생성된다.
- [ ] TraceabilityMatrix가 생성된다.
- [ ] API/Figma 지원 누락이 리뷰 가능한 Gap을 만든다.
- [ ] 요구사항·Gherkin·타깃 구현·테스트 증거 어디에도 연결되지 않은 legacy feature는 `legacy-coverage` Gap을 만든다.
- [ ] feature coverage matrix를 다시 빌드할 때 같은 legacy feature ID의 기존 open `legacy-coverage` Gap을 재사용하며 중복 블로커를 추가하지 않는다.
- [ ] orphan API/Figma 증거가 리포트된다.
- [ ] MCP 도구로 legacy feature coverage 아티팩트를 생성·조회할 수 있다 (`generate_legacy_feature_inventory`, `build_feature_coverage_matrix`).
- [ ] MCP 도구로 TraceabilityMatrix를 빌드·조회할 수 있다.

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

- traceability 계약, 키워드 추출, 그래프 노드 빌더, 결정적 링커, 추적성 Gap 감지기, `EvidenceGraphService` 테스트 통과.
- MCP stdio 통합에서 `build_evidence_graph`, `get_traceability_matrix` 호출 성공.

## 알려진 한계

- 매칭은 결정적이고 보수적이다. LLM 시맨틱 링크는 수행하지 않는다.
- 요구사항 타입이 아직 세분화되지 않아 API/Figma가 필수인지 알 수 없다 — missing-api/figma Gap은 이후 리뷰에서 조정이 필요할 수 있다.
- orphan API/Figma 노드는 리포트일 뿐 자동 블로커가 아니다.
- legacy feature 추출은 보수적이어서 런타임 동적 동작은 수동 확인이 필요할 수 있다.
- OpenSpec/Gherkin/테스트/코드는 여기서 생성하지 않는다.
