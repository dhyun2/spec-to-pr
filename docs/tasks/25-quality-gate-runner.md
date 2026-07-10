---
sidebar_position: 25
title: "T25 · 품질 게이트 러너"
sidebar_label: "T25 품질 게이트"
---

# T25 · 품질 게이트 러너

> **한 줄 요약** — 통합 [Worktree](/reference/glossary#worktree)에서 lint/typecheck/build/test 등 결정론적 [품질 게이트](/reference/glossary#quality-gate)를 순서대로 실행하고 모든 증거를 [Run](/reference/glossary#run) 원장에 남긴다.

| 항목              | 내용                                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **목적**          | 시각·접근성·성능·발행 단계가 돌기 전에, 통합 코드가 프로젝트 수준 검증을 통과함을 증거로 증명한다                                         |
| **입력**          | Run ID, 통합/프로젝트 worktree 경로(T23), package.json 스크립트, 선택적 게이트 선택·타임아웃·커버리지 요약 경로                           |
| **출력**          | quality-gate-report.json/.md, 게이트별 리포트·로그 아티팩트, CheckResult, verification AgentResult, 실패 게이트의 Gap — T30 리포트가 소비 |
| **선행 태스크**   | T23 (T24 아키텍처 가드 이후 실행 권장)                                                                                                    |
| **병렬 가능**     | T24, T26, T27, T28, T29 (T23 이후 게이트 그룹; 특히 T26~T29는 서로 완전 병렬)                                                             |
| **관련 스킬**     | `/spec-to-pr:run-quality-gates`                                                                                                           |
| **담당 에이전트** | -                                                                                                                                         |

## 왜 필요한가

통합이 성공해도 코드가 실제로 lint·타입체크·빌드·테스트를 통과하는지는 별개 문제다. 이 러너가 없으면 "테스트 통과" 주장이 증거 없이 PR 리포트에 실리고, 실패한 게이트가 조용히 무시된다.

플러그인이 기록해야 하는 것:

- lint 리포트
- typecheck 리포트
- build 리포트
- unit 테스트 리포트
- component 테스트 리포트
- contract 테스트 리포트
- acceptance 테스트 리포트
- (있을 때) 커버리지 요약

## 동작 흐름

1. package.json의 scripts에서 게이트 명령 계획을 감지한다.
2. 게이트를 결정론적 순서(lint → typecheck → build → unit → component → contract → acceptance)로 실행한다.
3. 스크립트가 없는 게이트는 `skipped` [CheckResult](/reference/glossary#checkresult)로 기록한다.
4. 명령은 셸 보간(shell interpolation) 없이 실행한다.
5. stdout/stderr와 게이트별 리포트를 [ArtifactRef](/reference/glossary#artifactref)로 Run에 기록한다.
6. `coverage-summary.json`이 존재하면 커버리지 리포트 아티팩트로 변환한다.
7. 실패한 게이트는 blocker/major [Gap](/reference/glossary#gap)을 생성한다 — 일부 게이트가 실패해도 증거 기록은 계속된다.
8. 전체 실행을 verification [AgentResult](/reference/glossary#agentresult)로 남긴다.

## 입력 상세

- **Run ID** — 대상 Run.
- **worktree 경로** — Run에 기록된 통합 또는 프로젝트 worktree.
- **package.json scripts** — 게이트 자동 감지의 근거.
- **선택적 게이트 선택** — 일부 게이트만 실행.
- **선택적 명령 타임아웃** — 장기 실행 방지.
- **선택적 커버리지 요약 경로** — 기존 `coverage-summary.json` 위치.

## 출력 상세

- **quality-gate-report.json / quality-gate-report.md** — 게이트별 상태(passed/failed/skipped), 명령, 소요 시간.
- **게이트별 리포트 아티팩트 + stdout/stderr 로그 아티팩트**
- **선택적 coverage-report 아티팩트**
- **CheckResult 항목** — 통과·실패·건너뜀 모두 기록.
- **verification AgentResult**
- **Gap 항목** — 실패한 게이트 건.

## 완료 조건 (Definition of Done)

- [ ] package.json에서 품질 게이트 명령 계획을 감지할 수 있다.
- [ ] lint/typecheck/build/unit/component/contract/acceptance 게이트가 표현된다.
- [ ] 없는 게이트는 결정론적으로 skip 된다.
- [ ] 통과·실패·건너뜀이 CheckResult로 기록된다.
- [ ] stdout/stderr/리포트 아티팩트가 Run에 기록된다.
- [ ] coverage-summary.json이 있으면 커버리지 아티팩트로 변환된다.
- [ ] 실패한 게이트가 Gap을 생성한다.
- [ ] verification AgentResult가 기록된다.
- [ ] MCP 툴이 stdio 통합 테스트로 동작한다.

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

- quality gate command planner 테스트 통과
- quality gate report 테스트 통과
- QualityGateService 테스트 통과
- MCP stdio 통합 테스트에서 `run_quality_gates` 나열

## 알려진 한계

- 게이트 감지는 package.json 기반이다.
- 러너는 의존성을 설치하지 않는다.
- 커버리지는 이미 존재하는 커버리지 요약 파일이 있을 때만 요약된다.
- 장기 실행·watch 모드 스크립트는 품질 게이트로 설정하면 안 된다.
- 자동 수리는 수행하지 않는다.
- 시각 회귀(T26)·접근성(T27)·성능(T28) 검사는 이 태스크 범위 밖이다.
