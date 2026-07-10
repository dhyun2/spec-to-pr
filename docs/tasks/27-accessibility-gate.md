---
sidebar_position: 27
title: "T27 · 접근성 게이트"
sidebar_label: "T27 접근성"
---

# T27 · 접근성 게이트

> **한 줄 요약** — 자동화된 접근성 검사를 실행하고 수동 리뷰 항목을 생성해, 접근성 위반을 [Gap](/reference/glossary#gap)으로 매핑하고 접근성 리포트를 [Run](/reference/glossary#run)에 아티팩트로 저장한다.

| 항목              | 내용                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| **목적**          | 시각·기능 테스트가 증명하지 못하는 접근성(시맨틱, 키보드, 포커스, 대비)을 명시적으로 검사한다           |
| **입력**          | Run ID, 통합 worktree 구현(T23), 접근성 검사 대상(라우트/컴포넌트), axe 스타일 스캔 결과                |
| **출력**          | 접근성 스캔 리포트, 수동 리뷰 체크리스트, accessibility Gap, 리포트·triage 아티팩트 — T30 리포트가 소비 |
| **선행 태스크**   | T23                                                                                                     |
| **병렬 가능**     | T24, T25, T26, T28, T29 (T26~T29는 서로 완전 병렬)                                                      |
| **관련 스킬**     | `/spec-to-pr:run-accessibility-gate`                                                                    |
| **담당 에이전트** | `agents/accessibility-reviewer.md`                                                                      |

## 왜 필요한가

시각 회귀(T26)와 기능 테스트(T25)는 접근성을 증명하지 못한다. 플러그인이 명시적으로 검사해야 하는 항목:

- 시맨틱 role
- accessible name
- 폼 label
- 색 대비 (color contrast)
- 키보드 내비게이션
- dialog/sheet 포커스 동작
- 포커스 복원 (focus restore)
- 터치 타깃·포인터 전용 상호작용 리스크
- 수동 스크린 리더 리뷰 상태

## 동작 흐름

1. `plan_accessibility_gate` — 검사 대상(라우트·컴포넌트)을 계획한다.
2. `run_accessibility_gate` — axe 스타일 스캔 결과를 정규화하고 키보드/포커스 체크 계약을 평가한다.
3. 위반을 심각도별 [Gap](/reference/glossary#gap) 객체로 매핑한다.
4. 자동 검사로 커버되지 않는 항목(스크린 리더 등)은 수동 리뷰 체크리스트로 생성한다.
5. 접근성 리포트를 [ArtifactRef](/reference/glossary#artifactref)로 Run에 기록한다.
6. `record_accessibility_review` — `accessibility-reviewer` 에이전트가 위반을 triage 해 기록한다. 리뷰어는 gap을 면제(waive)할 수 없고 소스 코드를 수정할 수 없다.

## 입력 상세

- **Run ID** — 대상 Run.
- **접근성 게이트 플랜** — 검사 대상, 검사 종류(자동/수동), 뷰포트.
- **axe 스타일 결과** — 외부 러너가 생산한 원시 스캔 결과. 정규화 계층이 공통 모델로 변환한다.
- **키보드/포커스 체크 계약** — Tab 순서, 포커스 트랩, 포커스 복원 기대치.

## 출력 상세

- **accessibility gate plan** — 계획된 검사 대상.
- **accessibility scan report** — 정규화된 위반 목록(rule, impact, 대상 노드).
- **manual review checklist** — 스크린 리더 등 수동 검증 항목과 상태.
- **accessibility Gap** — 위반에서 매핑된 [CheckResult](/reference/glossary#checkresult)·Gap 항목.
- **accessibility report 아티팩트** — Run에 기록.
- **reviewer triage 아티팩트** — 리뷰어 에이전트의 분류 결과.

## 완료 조건 (Definition of Done)

- [ ] 접근성 검사 대상을 계획할 수 있다.
- [ ] axe 스타일 결과를 정규화할 수 있다.
- [ ] 키보드·포커스 체크 계약이 존재한다.
- [ ] 위반을 Gap 객체로 매핑할 수 있다.
- [ ] 접근성 리포트 아티팩트가 기록된다.
- [ ] 스킬과 리뷰어 에이전트가 문서화되어 있다.
- [ ] MCP stdio 테스트가 접근성 게이트 툴을 호출할 수 있다.

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

- accessibility model 테스트 통과
- axe result normalizer 테스트 통과
- keyboard/focus check 테스트 통과
- violation-to-gap mapper 테스트 통과
- AccessibilityGateService 테스트 통과
- MCP stdio 통합 테스트에서 `plan_accessibility_gate`, `run_accessibility_gate`, `get_accessibility_report`, `record_accessibility_review` 호출 가능

## 알려진 한계

- 키보드·포커스 체크는 모델로 표현되지만 이 태스크에서 완전 자동화되지는 않는다.
- 스크린 리더 리뷰는 수동 리뷰 항목으로만 표현된다.
- 자동 검사는 WCAG 완전 준수를 증명하지 못한다 — 법적 접근성 인증은 범위 밖이다.
- 접근성 리뷰어는 gap을 면제할 수 없고 소스 코드를 수정할 수 없다.
- 실제 Playwright + axe 러너 연결은 이후 품질 통합 태스크에서 확장될 수 있다.
