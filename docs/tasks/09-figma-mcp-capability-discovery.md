---
sidebar_position: 9
title: "T09 · Figma MCP 능력 탐색"
sidebar_label: "T09 Figma 능력 탐색"
---

# T09 · Figma MCP 능력 탐색

> **한 줄 요약** — Figma 디자인 인테이크가 시작되기 전에, 사용 가능한 Figma MCP 프로바이더와 각각의 능력(capability)을 [Run](/reference/glossary#run) 원장에 기록한다.

| 항목              | 내용                                                                                                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **목적**          | 특정 Figma MCP 프로바이더의 존재를 가정하지 않고, 실제 환경에서 어떤 프로바이더가 어떤 도구를 노출하는지 조사해 목적별 우선 프로바이더 정책을 도출한다.                                       |
| **입력**          | Run ID(T04 원장), Claude Code 환경에서 관찰된 Figma MCP 프로바이더 목록과 각 프로바이더의 원시 도구 이름                                                                                      |
| **출력**          | `FigmaCapabilityReport` [Artifact](/reference/glossary#artifact), `FigmaProviderPolicy`, 누락 능력에 대한 design [Gap](/reference/glossary#gap) → T10 Figma 인테이크가 프로바이더 선택에 사용 |
| **선행 태스크**   | T07                                                                                                                                                                                           |
| **병렬 가능**     | T08 (brief), T12 (openapi)                                                                                                                                                                    |
| **관련 스킬**     | `/spec-to-pr:figma-doctor`                                                                                                                                                                    |
| **담당 에이전트** | -                                                                                                                                                                                             |

## 왜 필요한가

플러그인은 특정 Figma MCP 프로바이더가 있다고 가정해서는 안 된다. Claude Code 환경에는 로컬 데스크톱 Figma MCP, 원격 Figma MCP, 플러그인 전용 Figma 도구가 있을 수도, 아무것도 없을 수도 있다. Figma 메타데이터·스크린샷·변수·Code Connect 매핑을 기록하기 전에 Run 원장은 다음을 알아야 한다.

- 어떤 프로바이더가 사용 가능한가
- 각 프로바이더가 어떤 도구를 노출하는가
- 목적별로 어떤 프로바이더가 primary여야 하는가
- 필수 능력 중 무엇이 누락되었는가

## 동작 흐름

1. `/spec-to-pr:figma-doctor` 스킬(또는 호출자)이 환경의 Figma MCP 프로바이더와 원시 도구 이름을 수집한다.
2. `record_figma_mcp_capabilities`가 원시 도구 이름을 정규화하고(`normalizeFigmaToolName()`), 프로바이더 종류를 추론한다(`inferProviderKind()` — `local-desktop` / `remote` / `plugin` / `unknown`).
3. `deriveFigmaProviderPolicy()`(`src/figma/figma-capability.ts`)가 목적별 primary 프로바이더를 선택한다 — 필요한 도구를 노출하는 프로바이더 중 local-desktop → remote → plugin 순으로 선호.
4. 필수 능력(`metadata`, `design-context`, `screenshot`, `variable-defs`, `code-connect-map`)이 어느 프로바이더에도 없으면 `missingCapabilities`에 기록되고 design Gap이 생성된다.
5. 능력 리포트가 Artifact로 저장되고, `get_figma_provider_policy`로 정책을 조회할 수 있다.

## 입력 상세

- Run ID.
- 프로바이더별 관찰 결과: `providerId`, 서버 이름, 트랜스포트(`stdio` / `http` / `sse` / `unknown`), 원시 도구 이름 목록, 가용 여부.

## 출력 상세

`FigmaCapabilityReport` (`src/figma/figma-capability.ts`):

```json
{
  "runId": "run_...",
  "capturedAt": "2026-07-10T00:00:00.000Z",
  "providers": [
    {
      "providerId": "figma-desktop",
      "kind": "local-desktop",
      "available": true,
      "transport": "stdio",
      "tools": ["get_metadata", "get_design_context", "get_screenshot", "get_variable_defs"],
      "rawToolNames": ["mcp__figma__get_metadata", "mcp__figma__get_design_context", "..."],
      "notes": []
    }
  ],
  "policy": {
    "metadataProviderId": "figma-desktop",
    "designContextProviderId": "figma-desktop",
    "screenshotProviderId": "figma-desktop",
    "variableDefsProviderId": "figma-desktop",
    "crossCheckProviderIds": ["figma-desktop", "figma-remote"],
    "missingCapabilities": ["code-connect-map"],
    "rationale": [
      "Prefer local desktop when it exposes the required tool, then remote, then plugin/unknown."
    ]
  },
  "gapIds": ["gap_..."]
}
```

- 프로바이더 종류: `local-desktop`, `remote`, `plugin`, `unknown`.
- 필수 능력: `metadata`, `design-context`, `screenshot`, `variable-defs`, `code-connect-map` (추가로 `code-connect-suggestions`, `asset-download`, `write-design`, `selected-node`가 스키마에 존재).
- 여러 프로바이더가 metadata/screenshot을 제공하면 `crossCheckProviderIds`로 교차 검증 대상이 된다 — T11의 provider comparison이 이를 활용한다.
- MCP 도구: `record_figma_mcp_capabilities`, `get_figma_provider_policy`.

## 완료 조건 (Definition of Done)

- [ ] Figma capability report 스키마가 존재한다.
- [ ] Provider policy 스키마가 존재한다.
- [ ] Capability report를 Artifact로 기록할 수 있다.
- [ ] Provider policy를 도출하고 조회할 수 있다.
- [ ] 누락된 필수 능력이 design Gap을 생성한다.
- [ ] MCP 도구가 능력 기록과 정책 조회를 노출한다.

## 검증 방법

```bash
pnpm format:check
pnpm typecheck
pnpm schemas:build
pnpm build
pnpm test
```

Claude Code에서 `/spec-to-pr:figma-doctor [run-id]`를 실행해 실제 환경의 프로바이더가 기록되는지 확인한다.

## 알려진 한계

- spec-to-pr 서버가 Figma MCP를 직접 호출하지 않는다 — 관찰 결과를 기록할 뿐이다.
- Figma URL 파싱, 스크린샷 기록 없음 (T10).
- 디자인 시스템 인벤토리 없음 (T11).
- 시각 diff, UI 코드 생성 없음.
- 프로바이더 종류 추론은 이름 기반 휴리스틱이다.
