---
sidebar_position: 2
title: "T02 · 공유 런타임 계약"
sidebar_label: "T02 런타임 계약"
---

# T02 · 공유 런타임 계약

> **한 줄 요약** — 앞으로 모든 도구와 에이전트가 제출해야 하는 구조화 데이터, 즉 시스템의 공용 언어(Source / Evidence / Artifact / Check / Decision / Gap / AgentResult)를 정의한다.

| 항목              | 내용                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **목적**          | "구현했다", "테스트 통과했다" 같은 자연어 주장 대신, 기계 검증 가능한 계약 타입으로 시스템 상태를 표현한다.                     |
| **입력**          | T01의 실행 가능한 MCP 서버 셸 (계약이 노출될 기반)                                                                              |
| **출력**          | `src/runtime`의 Zod 스키마와 `schemas/runtime`의 JSON Schema 아티팩트 → T03의 Run 애그리게이트를 비롯한 모든 후속 태스크가 소비 |
| **선행 태스크**   | T01                                                                                                                             |
| **병렬 가능**     | 없음                                                                                                                            |
| **관련 스킬**     | -                                                                                                                               |
| **담당 에이전트** | -                                                                                                                               |

## 왜 필요한가

"implemented", "tests passed", "Figma matched" 같은 자연어 진술은 신뢰할 수 있는 시스템 상태가 아니다. 계약이 없으면 이후의 검증·리뷰·PR 리포트가 모두 주장(assertion) 위에 서게 된다. T02는 다음 원칙을 코드로 고정한다.

1. 계약 우선(contract-first) 개발
2. 주장보다 증거(evidence over assertion)
3. 역할별 AgentResult 계약 분리
4. 유효하지 않은 상태는 스키마 경계에서 실패
5. 비 TypeScript 소비자를 위한 JSON Schema 아티팩트 생성

## 동작 흐름

1. `src/runtime/` 아래에 7개 계약 타입을 Zod 스키마로 정의한다.
2. 각 스키마에 불변식(invariant)을 refinement로 강제한다.
3. `pnpm schemas:build`로 `schemas/runtime/`에 JSON Schema 아티팩트를 생성한다.
4. 계약 불변식 테스트로 잘못된 상태가 스키마 경계에서 거부됨을 증명한다.

## 입력 상세

T01이 만든 플러그인 셸과 빌드 파이프라인. 외부 데이터 입력은 없다 — 이 태스크의 산출물은 순수하게 타입과 스키마다.

## 출력 상세

`src/runtime/` 아래에 정의되는 계약 타입:

| 계약                                     | 의미                                                                                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [Source](/reference/glossary#source)     | brief 파일, Figma URL, OpenAPI 문서, 저장소 스냅샷 같은 큰 입력 단위                                                                            |
| [Evidence](/reference/glossary#evidence) | Source 내부의 정밀한 위치 — 파일 라인 범위, JSON Pointer, Figma 노드, Git 파일 범위                                                             |
| [Artifact](/reference/glossary#artifact) | 에이전트/검증기가 생산한 출력 — OpenSpec 문서, Gherkin feature, API 계약 리포트, 스크린샷, 시각 diff, 테스트 리포트, 리뷰 스코어카드, PR 리포트 |
| [Check](/reference/glossary#checkresult) | 실행된 검증 결과                                                                                                                                |
| [Decision](/reference/glossary#decision) | 구현/리뷰 선택의 기록 — 근거, 리스크, evidence 포함                                                                                             |
| [Gap](/reference/glossary#gap)           | 기대 동작과 관찰 동작의 차이                                                                                                                    |
| **AgentResult**                          | 역할별(implementation / verification / publishing) 에이전트 실행 결과                                                                           |

스키마가 강제하는 주요 불변식:

- Check — 통과한 Check는 0이 아닌 exit code를 가질 수 없다. 실패한 Check는 `failureReason`, 스킵된 Check는 `skipReason`이 필수다.
- Gap — 상태는 `open` / `assumed` / `waived` / `resolved` 중 하나. `resolved`는 해결 Artifact가, `waived`는 waiver evidence가, `assumed`는 가정 상세가 필수다.
- AgentResult — implementation 결과는 통과 시 `commitSha` 필수. verification 결과는 파일을 변경할 수 없다. publishing 결과는 통과 시 `prUrl`과 `reportArtifactId` 필수.

```json
{
  "status": "resolved",
  "category": "requirement",
  "severity": "major",
  "title": "정렬 기준 미정의",
  "expected": "종목 목록 정렬 기준이 brief에 정의되어야 한다.",
  "observed": "정렬 기준 언급 없음.",
  "resolutionArtifactIds": ["artifact_..."]
}
```

## 완료 조건 (Definition of Done)

- [ ] 런타임 스키마가 `src/runtime` 아래에 존재한다.
- [ ] JSON Schema 아티팩트가 `schemas/runtime` 아래에 생성된다.
- [ ] 계약 불변식 테스트가 통과한다.
- [ ] T01 MCP 테스트가 계속 통과한다.
- [ ] `pnpm check`가 통과한다.

## 검증 방법

```bash
pnpm schemas:build
pnpm check
```

## 알려진 한계

- [Run](/reference/glossary#run) 애그리게이트 없음 (T03).
- SQLite 영속화, 참조 무결성 검사 없음 (T03).
- Source 콘텐츠 수집, SHA-256 계산 없음 (T07).
- Figma MCP 호출, OpenAPI 파싱, 에이전트 실행, PR 발행 없음.
