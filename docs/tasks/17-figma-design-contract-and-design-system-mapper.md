---
sidebar_position: 17
title: "T17 · Figma 디자인 계약과 디자인 시스템 매퍼"
sidebar_label: "T17 디자인 계약"
---

# T17 · Figma 디자인 계약과 디자인 시스템 매퍼

> **한 줄 요약** — Figma 디자인 인벤토리와 대상 저장소의 디자인 시스템을 매핑해, Design/UI 에이전트가 따라야 할 디자인 구현 계약(design contract)을 생성하는 태스크.

| 항목              | 내용                                                                                                                                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **목적**          | Figma 인벤토리만으로는 구현할 수 없으므로, 어떤 코드 컴포넌트·토큰·타이포그래피·에셋이 어떤 Figma 요소에 대응하는지와 발명 금지 상태를 계약으로 못 박는다                                                                                       |
| **입력**          | [Run](/reference/glossary#run) ID, [OpenSpec](/reference/glossary#openspec) change 이름, Figma 디자인 인벤토리 아티팩트(T11), 프로젝트 프로필(T06), 선택적 Code Connect 맵, 기존 저장소의 디자인 시스템 파일                                    |
| **출력**          | `figma-design-contract.json/.md`, component/token/typography/asset 맵, `component-contracts.json`, UI 구현 규칙, 디자인 [Gap](/reference/glossary#gap) 요약 → T18 [Context Pack](/reference/glossary#context-pack)과 T21(Design/UI 레인)이 소비 |
| **선행 태스크**   | T14 (파이프라인 순서 기준; 데이터로는 T11 인벤토리·T06 프로필 필요)                                                                                                                                                                             |
| **병렬 가능**     | T15 (Gherkin), T16 (API 파이프라인)                                                                                                                                                                                                             |
| **관련 스킬**     | `/spec-to-pr:generate-design-contract`                                                                                                                                                                                                          |
| **담당 에이전트** | -                                                                                                                                                                                                                                               |

## 왜 필요한가

Figma 인벤토리는 구현에 충분하지 않다. UI 에이전트에게는 다음을 말해주는 계약이 필요하다:

- 어떤 코드 컴포넌트가 어떤 Figma 컴포넌트에 매핑되는가
- 어떤 디자인 토큰이 어떤 Figma variable에 매핑되는가
- 어떤 타이포그래피 클래스가 어떤 Figma text style에 매핑되는가
- Figma의 스타일성 컴포넌트 prop이 기존 UI 라이브러리의 variant/토큰으로 어떻게 정규화되는가
- 어떤 에셋을 import/export하거나 Gap으로 처리해야 하는가
- 어떤 상태를 발명해서는 안 되는가

이 계약이 없으면 T21의 에이전트는 임의의 하드코딩 값과 ad-hoc 스타일로 UI를 구현하게 된다.

## 동작 흐름

1. T11의 Figma 디자인 인벤토리와 T06의 프로젝트 프로필을 로드한다.
2. 대상 저장소의 디자인 시스템 파일을 스캔한다 (design-system scanner).
3. Code Connect 맵이 있으면 우선 적용한다.
4. component / token / typography / asset 매핑을 생성한다.
5. 측정 가능한 UI 구조를 가진 Figma 노드에 대해 component contract를 생성한다 — width/height, padding, radius, shadow/border, 타이포그래피, 아이콘 슬롯, 에셋 슬롯, variant prop, 기대 시각 임계값 포함.
6. 매핑되지 않은 항목을 디자인 Gap으로 생성한다.
7. UI 구현 규칙(`ui-implementation-rules.md`)과 Gap 요약을 렌더링하고, 산출물을 [ArtifactRef](/reference/glossary#artifactref)로 Run에 기록한다.

### 매핑 규칙

- Code Connect 매핑이 있으면 우선한다.
- 새 컴포넌트보다 기존 디자인 시스템 컴포넌트를 우선한다.
- 프로젝트 UI 라이브러리가 있으면 Figma 스타일성 prop을 ad-hoc 스타일 prop이 아니라 지원되는 variant/토큰으로 변환한다.
- component contract는 compact/list/empty/bookable/no-phone 같은 variant를 하나의 CSS 규칙으로 합치지 말고 구분해야 한다.
- 누락된 매핑은 디자인 Gap이 된다. Figma에 없는 상태를 발명하지 않는다.
- 매핑되지 않은 토큰이 임의의 하드코딩 값이 되어서는 안 된다.
- UI 라이브러리 variant/토큰 누락은 명시적 스타일 오버라이드를 쓰기 전에 디자인 Gap으로 기록되어야 한다.
- 생성된 계약은 이후 Design/UI 에이전트(T21)가 반드시 소비해야 한다.

### 범위 제외 (Non-goals)

UI 구현(→ T21), CSS 수정, 소스 코드 내 토큰 생성, 시각 diff(→ T26), Playwright 실행, Design/UI 에이전트 실행은 하지 않는다.

## 입력 상세

- **Figma 디자인 인벤토리 아티팩트** — T11 산출물 (컴포넌트·variant·variable·text style·에셋·Code Connect).
- **프로젝트 프로필 아티팩트** — T06 산출물 (UI 라이브러리·디자인 시스템 위치 파악).
- **Code Connect 맵 아티팩트** (선택) — 있으면 신뢰하되 여기서 재검증하지 않는다.
- **기존 저장소 디자인 시스템 파일** — 스캐너가 읽는 실제 코드.

## 출력 상세

`openspec/changes/<change>/artifacts/design-contract/` 아래에 생성:

- `figma-design-contract.json` / `figma-design-contract.md`
- `component-map.json`, `token-map.json`, `typography-map.json`, `asset-map.json`
- `component-contracts.json` — variant별 측정 가능한 계약:

```json
{
  "contracts": [
    {
      "figmaNode": "StaffCard/compact",
      "codeComponent": "entities/staff/ui/StaffCard",
      "variantProps": { "size": "compact" },
      "metrics": { "padding": "12px", "radius": "8px" },
      "visualThreshold": 0.98
    }
  ]
}
```

- `ui-implementation-rules.md`, `design-gap-summary.md`
- Run의 ArtifactRef 엔트리.

## 완료 조건 (Definition of Done)

- [ ] 디자인 계약 모델이 존재한다.
- [ ] 프로젝트 디자인 시스템 스캐너가 존재한다.
- [ ] component/token/typography/asset 매핑이 생성된다.
- [ ] component contract가 생성되어 `component-contracts.json`에 기록된다.
- [ ] 매핑되지 않은 항목에 디자인 Gap이 생성된다.
- [ ] UI 구현 규칙이 생성된다.
- [ ] MCP 도구로 디자인 계약을 생성할 수 있다.
- [ ] 스킬이 워크플로 실행 방법을 설명한다.

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

- design-system scanner, design contract mapper, component contract 매핑, design contract service 테스트 통과.
- MCP stdio 테스트에서 `generate_figma_design_contract` 호출 성공.
- 생성 파일이 `openspec/changes/<change>/artifacts/design-contract` 아래에 기록됨.

## 알려진 한계

- 컴포넌트 스캔은 휴리스틱이다.
- Code Connect 매핑은 제공되면 신뢰하지만 여기서 재검증하지 않는다.
- 토큰 매핑은 보수적이다.
- UI 코드 생성·디자인 토큰 소스 수정·시각 회귀 검사는 수행하지 않는다.
- 누락된 매핑은 열린 디자인 Gap으로 남는다.
