---
sidebar_position: 5
title: "T05 · 보안·정책 베이스라인"
sidebar_label: "T05 보안 베이스라인"
---

# T05 · 보안·정책 베이스라인

> **한 줄 요약** — 실제 에이전트 실행이 존재하기 전에, 워크스페이스 경로·명령 실행 경계·시크릿·비신뢰 문서 경계를 보호하는 기본 정책 계층을 만든다.

| 항목              | 내용                                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **목적**          | 외부 콘텐츠(brief, Figma, OpenAPI, 저장소 파일, 생성 코드)를 비신뢰 데이터로 취급하고, 모든 경로·명령·로그 출력을 사용 전에 검증한다.                                                                                                 |
| **입력**          | T04까지 완성된 Run/Stage 커널 (정책 도구가 노출될 MCP 서버)                                                                                                                                                                           |
| **출력**          | 경로 정책 · 명령 정책 · 시크릿 리댁션 · 비신뢰 콘텐츠 래핑 · JSONL 감사 로그 (`src/security/`), MCP 도구 `policy_info` / `validate_path` / `classify_command` / `redact_text` → T06 이후 파일을 읽고 명령을 다루는 모든 태스크가 소비 |
| **선행 태스크**   | T04                                                                                                                                                                                                                                   |
| **병렬 가능**     | 없음                                                                                                                                                                                                                                  |
| **관련 스킬**     | -                                                                                                                                                                                                                                     |
| **담당 에이전트** | -                                                                                                                                                                                                                                     |

## 왜 필요한가

플러그인은 결국 brief, Figma 콘텐츠, OpenAPI 문서, 저장소 파일, 에이전트가 생성한 코드를 읽게 된다. 이 모든 것에는 악의적이거나 우발적인 지시가 섞여 있을 수 있다. 정책 계층이 먼저 존재하지 않으면, 이후 태스크들이 각자 임의의 기준으로 경로와 명령을 다루게 되고 프롬프트 인젝션과 워크스페이스 탈출에 무방비가 된다.

## 동작 흐름

1. 파일 접근 전 `validate_path`로 경로를 검증한다 — 경로 순회(`..`), 워크스페이스 밖 절대 경로, 심링크 탈출을 거부한다 (`src/security/path-policy.ts`).
2. 명령 실행 요청은 `classify_command`로 분류한다 — allowlist 기반으로 `allow` / `approval-required` / `deny` 판정을 내리고, 셸 메타문자가 포함된 인자는 거부한다 (`src/security/command-policy.ts`).
3. 로그·출력 텍스트는 `redact_text`로 시크릿을 리댁션한다 (`src/security/secret-redactor.ts`).
4. 외부 [Source](/reference/glossary#source) 발췌문은 명시적 지시 경계(instruction boundary)로 감싸 모델/도구에 대한 지시로 오인되지 않게 한다 (`src/security/untrusted-content.ts`).
5. 모든 정책 결정은 JSONL 감사 로그로 남긴다 (`src/security/audit-log.ts`).

## 입력 상세

- 검증 대상 경로 (workspace 루트 기준).
- 분류 대상 명령과 인자 배열 (셸 문자열이 아닌 argv 형태).
- 리댁션 대상 텍스트 또는 env 유사 객체.
- 래핑 대상 비신뢰 Source 발췌문.

## 출력 상세

- **PolicyDecision** — `allow` / `requireApproval` / `deny` 판정 + 사유 코드. 예: `git status`는 읽기 전용으로 allow, `npx`는 패키지 다운로드·실행 가능성 때문에 approval-required, 셸 문법이 섞인 인자는 deny.
- 리댁션된 텍스트 — 패턴 기반으로 시크릿이 마스킹된 결과.
- 지시 경계로 래핑된 비신뢰 콘텐츠 블록.
- JSONL 감사 레코드 — 정책 결정의 사후 감사용.
- MCP 도구: `policy_info`, `validate_path`, `classify_command`, `redact_text`.

## 완료 조건 (Definition of Done)

- [ ] 경로 순회(path traversal)가 거부된다.
- [ ] 워크스페이스 밖 절대 경로가 거부된다.
- [ ] 심링크 탈출이 거부된다.
- [ ] 위험한 셸 명령이 거부된다.
- [ ] 허용된 명령이 allow / approval-required / deny로 분류된다.
- [ ] 텍스트와 env 유사 객체에서 시크릿이 리댁션된다.
- [ ] 비신뢰 Source 발췌문이 명시적 지시 경계로 래핑된다.
- [ ] 정책 결정이 JSONL로 감사 가능하다.
- [ ] MCP 정책 도구가 stdio 통합 테스트를 통과한다.

## 검증 방법

```bash
pnpm format:check
pnpm typecheck
pnpm schemas:build
pnpm build
pnpm test
pnpm audit
```

기대 결과: 경로 정책 · 명령 정책 · 시크릿 리댁션 · 비신뢰 콘텐츠 테스트 통과, MCP 정책 도구가 stdio에서 조회 가능, 기존 T01~T04 테스트 통과.

## 알려진 한계

- 실제 명령 실행은 아직 없다 — 판정만 존재한다.
- 승인 워크플로는 정책 판정(verdict)으로만 표현된다 (승인 UI 없음).
- 시크릿 리댁션은 패턴 기반 best-effort다.
- 경로 정책은 파일시스템 동작과 심링크 지원에 의존한다.
- 비신뢰 콘텐츠 래퍼는 프롬프트 인젝션 위험을 줄일 뿐 완전히 제거하지 못한다.
- 샌드박스 격리는 이 태스크 범위가 아니다.
