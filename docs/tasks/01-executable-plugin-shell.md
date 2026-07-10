---
sidebar_position: 1
title: "T01 · 실행 가능한 플러그인 셸"
sidebar_label: "T01 플러그인 셸"
---

# T01 · 실행 가능한 플러그인 셸

> **한 줄 요약** — Claude Code가 이 플러그인을 발견하고, stdio로 MCP 서버를 띄우고, 도구 목록을 조회하고, 최소한의 읽기 전용 커널 도구를 호출할 수 있음을 증명한다.

| 항목              | 내용                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **목적**          | 이후 모든 태스크가 올라탈 실행 기반(플러그인 발견 → MCP stdio 서버 → 도구 노출)을 검증 가능한 워킹 스켈레톤으로 확보한다.           |
| **입력**          | `plugin.json`, `.mcp.json`, `src/mcp/server.ts` · `src/mcp/create-server.ts` (저장소 자체 — 선행 태스크 산출물 없음)                |
| **출력**          | 실행 가능한 MCP 서버 번들(`dist/mcp/server.js`)과 `kernel_info` / `kernel_ping` 도구 → T02 이후 모든 태스크가 이 서버에 도구를 등록 |
| **선행 태스크**   | 없음                                                                                                                                |
| **병렬 가능**     | 없음                                                                                                                                |
| **관련 스킬**     | `/spec-to-pr:doctor`                                                                                                                |
| **담당 에이전트** | -                                                                                                                                   |

## 왜 필요한가

플러그인이 Claude Code에서 실제로 발견되고 실행된다는 사실이 증명되지 않으면, 이후의 [Run](/reference/glossary#run) 원장, [Source](/reference/glossary#source) 인테이크, 에이전트 실행 같은 기능은 모두 검증 불가능한 가정 위에 쌓이게 된다. T01은 가장 얇은 끝단(도구 2개)만으로 "설치 → 핸드셰이크 → 도구 호출" 전체 경로를 끝까지 관통시킨다.

## 동작 흐름

1. Claude Code가 `plugin.json`으로 플러그인을 발견한다.
2. `.mcp.json` 선언에 따라 `node dist/mcp/server.js`를 실행한다.
3. MCP stdio 핸드셰이크가 완료된다.
4. `tools/list`로 도구 목록을 조회한다.
5. `kernel_info`, `kernel_ping`을 호출해 응답을 확인한다.

```text
plugin.json
  → .mcp.json
  → node dist/mcp/server.js
  → MCP stdio handshake
  → tools/list
  → kernel_info / kernel_ping
```

## 입력 상세

- `plugin.json` — Claude Code 플러그인 매니페스트.
- `.mcp.json` — MCP 서버 선언. stdio 트랜스포트로 `node dist/mcp/server.js`를 기동한다.
- `src/mcp/server.ts` — stdio 엔트리포인트.
- `src/mcp/create-server.ts` — `createKernelServer()`가 도구를 등록한다.

## 출력 상세

`kernel_info`는 설치된 커널의 버전·계약 버전·런타임 요구사항·도구 목록을 반환한다.

```json
{
  "pluginName": "spec-to-pr",
  "serverName": "spec-to-pr",
  "pluginVersion": "0.1.0",
  "contractVersion": "1",
  "transport": "stdio",
  "runtime": { "name": "node", "minimumMajor": 20 },
  "tools": ["kernel_info", "kernel_ping", "..."]
}
```

`kernel_ping`은 입력 `echo` 문자열을 그대로 되돌려 MCP 요청/응답 배관을 검증한다. 두 도구 모두 `readOnlyHint` / `idempotentHint` 어노테이션이 붙은 읽기 전용 도구다.

## 완료 조건 (Definition of Done)

- [ ] TypeScript typecheck가 통과한다.
- [ ] 번들이 빌드된다 (`dist/mcp/server.js`).
- [ ] 플러그인 레이아웃 테스트가 통과한다.
- [ ] 실제 MCP stdio 통합 테스트가 통과한다.
- [ ] Claude 플러그인 strict validation이 통과한다.
- [ ] Doctor 스킬이 존재한다.

## 검증 방법

```bash
pnpm typecheck
pnpm build
pnpm test
```

Claude Code에서 `/spec-to-pr:doctor`를 실행해 `kernel_info` / `kernel_ping` 응답을 확인한다.

## 알려진 한계

- Run 영속화 없음 — SQLite는 T03에서 도입된다.
- Source / [Evidence](/reference/glossary#evidence) / [Gap](/reference/glossary#gap) 모델 없음 — T02에서 정의된다.
- Figma 연동, OpenAPI 파싱, 서브에이전트 실행, PR 발행 없음.
