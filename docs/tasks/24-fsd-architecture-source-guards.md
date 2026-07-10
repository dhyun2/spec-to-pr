---
sidebar_position: 24
title: "T24 · FSD 아키텍처·소스 가드"
sidebar_label: "T24 아키텍처 가드"
---

# T24 · FSD 아키텍처·소스 가드

> **한 줄 요약** — 통합된 [Worktree](/reference/glossary#worktree)를 정적 분석해 FSD 레이어 경계, public API 규칙, API 접근 경계 위반을 찾아 아키텍처 리포트와 [Gap](/reference/glossary#gap)으로 기록한다.

| 항목              | 내용                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **목적**          | Git 통합 성공(T23)이 아키텍처 경계 준수를 증명하지는 않으므로, 경계 위반을 결정론적으로 검출한다                                     |
| **입력**          | Run ID, 통합 worktree 경로(T23), 프로젝트 프로파일(T06), 파일 소유권 정책, API 파이프라인 리포트(T16), Figma 디자인 계약 리포트(T17) |
| **출력**          | architecture-report.json/.md, 선택적 source guard 테스트, CheckResult·ArtifactRef·Gap — T25 이후 게이트와 T30 리포트가 소비          |
| **선행 태스크**   | T23                                                                                                                                  |
| **병렬 가능**     | T25, T26, T27, T28, T29 (T23 이후 게이트 그룹; 특히 T26~T29는 서로 완전 병렬)                                                        |
| **관련 스킬**     | `/spec-to-pr:run-architecture-guard`                                                                                                 |
| **담당 에이전트** | -                                                                                                                                    |

## 왜 필요한가

통합 브랜치가 빌드된다는 사실만으로는 코드가 Feature-Sliced Design 경계를 지켰는지 알 수 없다. 이 가드가 없으면 UI 코드가 생성된 API 클라이언트를 직접 import 하거나, 하위 레이어가 상위 레이어를 참조하는 구조적 부채가 게이트를 통과해 PR까지 흘러간다.

플러그인이 검출해야 하는 위반:

- 잘못된 FSD 레이어 방향 import
- 슬라이스 간 딥 import (public API 우회)
- public API(index) 미사용
- UI 코드의 직접 `fetch` 호출
- UI 코드의 직접 `httpClient` import
- UI 코드의 생성된 API 클라이언트 직접 import
- 허용된 API wrapper 존 밖에서의 생성 클라이언트 사용

## 동작 흐름

1. 통합 worktree의 소스 파일을 스캔한다.
2. import/export 선언을 추출한다 (문자열 리터럴 경로 기준).
3. 파일 경로에서 FSD 레이어와 슬라이스를 감지한다.
4. 규칙 위반을 판정한다 — 상위 레이어는 하위 레이어를 import 할 수 있지만 역방향은 금지, 다른 슬라이스는 public API로만 접근, 생성 클라이언트는 허용된 wrapper 존 안에서만 사용.
5. 위반을 architecture-report.json/.md로 렌더링하고 [Run](/reference/glossary#run)에 [ArtifactRef](/reference/glossary#artifactref)로 기록한다.
6. blocker/major 위반은 Architecture [Gap](/reference/glossary#gap)으로 등록하고, 가드 실행 자체는 [CheckResult](/reference/glossary#checkresult)로 남긴다.
7. 선택적으로 대상 리포지토리에 source guard 테스트를 생성한다 (`generate_source_guard_tests`).

## 입력 상세

- **Run ID** — 대상 Run.
- **통합 worktree 경로** — T23이 만든 `.spec-to-pr/worktrees/<runId>/integration`.
- **프로젝트 프로파일** — 레이어 루트·alias 등 경로 해석 힌트.
- **파일 소유권 정책** — 검사 범위 판단.
- **API 파이프라인 리포트 / Figma 디자인 계약 리포트** — 허용된 API wrapper 존과 UI 계약 판단 근거.

## 출력 상세

- **architecture-report.json / architecture-report.md** — 위반 목록(규칙, 파일, import 대상, 심각도).
- **선택적 source guard 테스트** — 대상 리포지토리에 생성되는 간이 가드 테스트.
- **CheckResult** — 아키텍처 가드 실행 결과.
- **ArtifactRef 항목** — 리포트 아티팩트 참조.
- **Architecture Gap** — blocker/major 위반 건.

## 완료 조건 (Definition of Done)

- [ ] 소스 파일을 스캔할 수 있다.
- [ ] import/export 선언이 추출된다.
- [ ] 경로에서 FSD 레이어·슬라이스가 감지된다.
- [ ] 잘못된 레이어 방향이 보고된다.
- [ ] 슬라이스 간 딥 import가 보고된다.
- [ ] UI의 직접 fetch/httpClient/생성 클라이언트 import가 보고된다.
- [ ] 아키텍처 리포트 아티팩트가 Run에 기록된다.
- [ ] 선택적 source guard 테스트가 대상 리포지토리에 생성된다.
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

- import parser 테스트 통과
- project boundary 테스트 통과
- FSD 규칙 테스트 통과
- source guard 규칙 테스트 통과
- ArchitectureGuardService 테스트 통과
- MCP stdio 통합 테스트에서 `analyze_architecture_boundaries`, `generate_source_guard_tests` 나열

## 알려진 한계

- alias 해석은 기본 수준이며 프로젝트 프로파일 연동 보강이 필요할 수 있다.
- TypeScript 컴파일러 API 사용으로 번들 크기가 커진다.
- 생성되는 source guard 테스트는 플러그인 내부 분석보다 의도적으로 단순하다.
- 문자열 리터럴이 아닌 동적 import 경로는 무시된다.
- 자동 수정(auto-fix)은 수행하지 않는다.
- 이 태스크에서는 lint/typecheck/test를 실행하지 않는다 (T25 담당).
