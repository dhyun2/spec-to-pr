---
sidebar_position: 11
title: "T11 · Figma 디자인 시스템 인벤토리와 크로스체크"
sidebar_label: "T11 Figma 인벤토리"
---

# T11 · Figma 디자인 시스템 인벤토리와 크로스체크

> **한 줄 요약** — T10이 기록한 Figma 원시 [Artifact](/reference/glossary#artifact)들을 파싱해 구조화된 디자인 시스템 인벤토리(컴포넌트·variant·변수·텍스트 스타일·에셋)를 만들고, 프로바이더 출력을 교차 검증한다.

| 항목              | 내용                                                                                                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **목적**          | 감사(audit)용 원시 출력만으로는 구현 에이전트가 일할 수 없다 — 컴포넌트/토큰/에셋/Code Connect 매핑을 구조화 데이터로 만들고, 누락·불일치를 [Gap](/reference/glossary#gap)으로 드러낸다. |
| **입력**          | Run ID · Figma [Source](/reference/glossary#source) ID · T10이 기록한 `figma-intake-v1` 원시 Artifact들(metadata, design-context, screenshot, variable-defs, code-connect-map)           |
| **출력**          | `figma-design-inventory` · `figma-provider-comparison` Artifact와 design Gap들 → T17 디자인 계약, T21 Design-UI 에이전트 레인이 소비                                                     |
| **선행 태스크**   | T10                                                                                                                                                                                      |
| **병렬 가능**     | T08 (brief), T12 (openapi)                                                                                                                                                               |
| **관련 스킬**     | `/spec-to-pr:spec-to-pr` (전체 워크플로에서 `analyze_figma_design_inventory` 호출)                                                                                                       |
| **담당 에이전트** | -                                                                                                                                                                                        |

## 왜 필요한가

Figma MCP의 원시 출력은 감사 가능성(auditability)에는 유용하지만, 구현 에이전트에게 필요한 것은 구조화 데이터다 — 컴포넌트, variant, 변수(variable), 텍스트 스타일, 이펙트, 에셋, Code Connect 매핑, 스크린샷 베이스라인, 프로바이더 비교, 그리고 Gap. 인벤토리가 없으면 UI 에이전트는 원시 텍스트를 매번 다시 해석해야 하고, 디자인 시스템 컴포넌트 재사용 대신 커스텀 UI를 만들 위험이 커진다.

## 동작 흐름

1. `analyze_figma_design_inventory`가 [Run](/reference/glossary#run)에서 대상 Figma Source와, `adapter: "figma-intake-v1"` + 해당 `sourceId` metadata를 가진 원시 Artifact들을 수집한다 (`src/application/figma-design-inventory-service.ts`).
2. 원시 Artifact 집합의 안정 digest(`rawArtifactSetDigest`)를 계산한다 — 동일 집합에 대한 재분석은 기존 인벤토리를 반환하는 멱등 동작이다.
3. 필수 종류(metadata / design-context / screenshot / variable-defs / code-connect-map) 중 누락된 것마다 design Gap을 만든다 — screenshot·design-context 누락은 `major`, 나머지는 `minor`.
4. 원시 텍스트를 휴리스틱 파서(`src/figma/figma-raw-parser.ts`)로 파싱한다.
   - `parseComponentsFromText()` — XML 유사 노드에서 component/instance/button/input 등으로 보이는 노드를 컴포넌트 후보로 추출.
   - `parseTokensFromText()` — variable/style/token 패턴에서 토큰을 추출하고 kind(`color` / `spacing` / `radius` / `typography`(텍스트 스타일) / `effect` / `unknown`)를 추론.
   - `parseAssetsFromText()` — icon/image/vector 노드를 에셋으로 추출.
   - `parseCodeConnectMap()` — JSON(또는 폴백 정규식)에서 nodeId → 코드 컴포넌트 매핑을 수집.
5. Code Connect 매핑을 컴포넌트에 결합해 `mapped` 여부를 판정하고, 매핑되지 않은 컴포넌트마다 design Gap(`Unmapped Figma component`)을 만든다.
6. 프로바이더 비교를 수행한다 — 서로 다른 프로바이더의 metadata Artifact digest가 다르면 `metadataMismatch` = true + `major` Gap.
7. 인벤토리와 프로바이더 비교 리포트를 각각 `figma-design-inventory` / `figma-provider-comparison` Artifact로 저장하고 Gap과 함께 Run에 append한다. `get_figma_design_inventory`로 최신 인벤토리를 조회한다.

## 입력 상세

- `analyze_figma_design_inventory` / `get_figma_design_inventory` 입력: `{ runId, sourceId }` — sourceId는 kind `figma`인 SourceRef여야 한다.
- 원시 Artifact는 Run 안에서 metadata(`adapter`, `sourceId`, `providerId`, `figmaArtifactKind`)로 식별된다.

## 출력 상세

인벤토리 스키마는 `FigmaDesignInventorySchema`(`src/figma/figma-design-inventory.ts`)다. 컴포넌트는 variant 속성(`variantProperties`)을, 토큰은 변수·텍스트 스타일(kind `typography`)을 포함한다.

```json
{
  "sourceId": "source_9f2c...",
  "sourceDigest": "aaaa...64hex",
  "generatedAt": "2026-07-10T00:00:00.000Z",
  "sourceArtifactIds": ["artifact_meta1", "artifact_ctx1", "artifact_vars1"],
  "components": [
    {
      "nodeId": "238:941",
      "name": "Button/Primary",
      "type": "INSTANCE",
      "mainComponentId": "12:34",
      "variantProperties": { "size": "md", "state": "default" },
      "codeConnectComponent": "Button",
      "codeConnectSource": "src/shared/ui/button.tsx",
      "mapped": true
    },
    {
      "nodeId": "238:955",
      "name": "StockPriceCard",
      "variantProperties": {},
      "mapped": false
    }
  ],
  "tokens": [
    { "name": "color/primary/500", "kind": "color", "source": "variable-defs" },
    { "name": "spacing/md", "kind": "spacing", "source": "variable-defs" },
    { "name": "text/title-lg", "kind": "typography", "source": "design-context" }
  ],
  "assets": [{ "nodeId": "240:10", "name": "icon/arrow-up", "kind": "icon" }],
  "providerComparison": {
    "comparedProviderIds": ["figma-desktop", "figma-remote"],
    "metadataMismatch": false,
    "screenshotMissing": false,
    "variableDefsMissing": false,
    "codeConnectMissing": true,
    "notes": []
  },
  "gapIds": ["gap_unmapped_stockpricecard", "gap_missing_code_connect"]
}
```

생성되는 Gap 종류 (모두 category `design`, status `open`):

| Gap                                    | severity                                           | 조건                                 |
| -------------------------------------- | -------------------------------------------------- | ------------------------------------ |
| `Missing figma-screenshot artifact` 등 | screenshot/design-context는 `major`, 그 외 `minor` | 필수 원시 Artifact 종류 누락         |
| `Unmapped Figma component: <name>`     | `minor`                                            | Code Connect 매핑이 없는 컴포넌트    |
| `Figma provider metadata mismatch`     | `major`                                            | 프로바이더 간 metadata digest 불일치 |

## 완료 조건 (Definition of Done)

- [ ] 인벤토리 스키마가 존재한다.
- [ ] 분석기가 Run에서 Figma 원시 Artifact를 읽는다.
- [ ] 분석기가 컴포넌트/토큰/에셋/Code Connect 인벤토리를 생성한다.
- [ ] 누락된 핵심 Artifact마다 Gap이 생성된다.
- [ ] 매핑되지 않은 컴포넌트와 프로바이더 불일치가 Gap이 된다.
- [ ] 인벤토리와 크로스체크 리포트가 ArtifactRef로 저장된다.

## 검증 방법

```bash
pnpm format:check
pnpm typecheck
pnpm schemas:build
pnpm build
pnpm test
```

MCP stdio 경로: `register_figma_source` → `record_figma_*` → `analyze_figma_design_inventory` → `get_figma_design_inventory`. 동일 원시 Artifact 집합으로 재호출 시 `duplicate: true`로 기존 인벤토리를 반환해야 한다.

## 알려진 한계

- 파서는 정규식 기반 휴리스틱이다 — Figma MCP 출력 형식이 크게 바뀌면 추출 정확도가 떨어질 수 있다.
- UI 코드 생성 없음 (T21), 시각 diff·브라우저 스크린샷 없음 (T26).
- 저장소 내 디자인 시스템 import 검증은 하지 않는다 (T17 디자인 계약의 몫).
- 에이전트 실행 없음.
- variant 속성·토큰 값(value)은 원시 출력에 명시된 범위에서만 채워진다.
