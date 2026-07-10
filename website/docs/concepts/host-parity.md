---
sidebar_position: 3
title: Claude Code · Codex 호스트 동등성
---

# Claude Code · Codex 호스트 동등성

SpecToPR은 Claude Code와 Codex에서 **같은 요구사항·증거·게이트·발행 판정**을 따르도록 설계되어 있습니다. 목표는 두 모델이 한 글자까지 같은 코드를 쓰는 것이 아니라, 같은 입력을 받으면 같은 검증 계약 안에서 안전하게 진행되게 만드는 것입니다.

## 무엇이 같은가

두 호스트는 같은 `skills/` 워크플로우와 로컬 MCP kernel을 사용합니다. MCP tool 이름의 접두사만 다르고, 실제 Run·artifact·gap·stage·AgentResult 스키마와 PR report 판정 서비스는 같습니다.

| 영역                          | 두 호스트에서 동일      | 달라질 수 있는 것     |
| ----------------------------- | ----------------------- | --------------------- |
| 증거·Run 스키마·스테이지 규칙 | 동일 MCP kernel         | tool namespace 표기   |
| 필수 gate·발행 차단           | 동일 판정 정책          | 명령 로그 형식        |
| AgentResult 계약              | 동일 검증기             | 추론 과정·설명 문장   |
| 구현 코드                     | 동일 요구사항·검증 기준 | 정확한 코드·커밋 해시 |

따라서 한 호스트가 blocker gap, 실패한 CheckResult, 미실행 필수 gate를 남기면 다른 호스트도 그것을 통과로 바꿀 수 없습니다. `blocked` PR report는 어느 호스트에서도 새 draft PR/MR을 만들지 않습니다.

## 무엇을 보장하지 않는가

다음은 모델과 실행 환경에 따라 달라질 수 있으므로 동일성을 보장하지 않습니다.

- 코드의 정확한 줄·파일 분할·커밋 SHA
- 자연어 설명의 문장과 토큰 사용량
- Figma, 브라우저, Git host 같은 외부 도구의 설치·권한 상태
- 서브에이전트를 병렬 실행할 수 있는지 여부

대신 외부 도구가 없거나 증거가 부족하면 추측으로 대체하지 않고 gap 또는 blocked 결과를 기록합니다. Figma 입력이 있으면 시각 비교가, 레거시 마이그레이션이면 feature coverage matrix가 조건부 필수 증거가 됩니다.

## 호스트별 차이

| 항목              | Claude Code                                  | Codex                                        |
| ----------------- | -------------------------------------------- | -------------------------------------------- |
| MCP tool 이름     | `mcp__spec-to-pr__<tool>`                    | `mcp__spec_to_pr__<tool>`                    |
| 에이전트 정의     | `agents/*.md`                                | `.codex/agents/*.toml`                       |
| 모델 설정         | 명시하지 않은 에이전트는 활성 세션 모델 상속 | 에이전트는 현재 `high` reasoning effort 요청 |
| 병렬 실행 불가 시 | 같은 lane을 현재 세션에서 순차 실행          | 같은 lane을 현재 task에서 순차 실행          |

모델 이름이나 병렬성은 parity의 기준이 아닙니다. 중요한 기준은 각 lane이 같은 evidence 제약을 지키고, 구조화된 결과를 기록하며, 동일한 gate와 scorecard를 통과해야 한다는 점입니다.

## 확인 방법

설치 직후 각 호스트에서 `/spec-to-pr:doctor`를 실행하세요. Doctor가 plugin 인식, MCP kernel 기동, `kernel_info`, `kernel_ping`까지 확인합니다. 이후 Run의 PR report에서 evidence, CheckResult, gap, scorecard를 비교하면 호스트별 코드 차이와 별개로 같은 판정 계약을 확인할 수 있습니다.

전체 실행 순서는 [파이프라인 구조](/concepts/pipeline), 역할별 책임은 [서브에이전트와 lane](/concepts/subagents)에서 확인할 수 있습니다.
