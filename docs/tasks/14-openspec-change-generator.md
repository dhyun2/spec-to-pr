---
sidebar_position: 14
title: "T14 · OpenSpec 변경 생성기"
sidebar_label: "T14 OpenSpec 생성"
---

# T14 · OpenSpec 변경 생성기

> **한 줄 요약** — [EvidenceGraph](/reference/glossary#evidencegraph)와 [TraceabilityMatrix](/reference/glossary#traceabilitymatrix)로부터 사람이 리뷰할 수 있는 [OpenSpec](/reference/glossary#openspec) change 폴더를 생성하는 태스크.

| 항목              | 내용                                                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **목적**          | 기계가 읽는 그래프를 리뷰어가 읽는 OpenSpec change(proposal/design/tasks/spec + 증거 요약)로 변환한다                                                     |
| **입력**          | [Run](/reference/glossary#run) ID, EvidenceGraph·TraceabilityMatrix 아티팩트(T13), change 이름, 대상 spec 영역                                            |
| **출력**          | projectRoot 아래 OpenSpec change 폴더, OpenSpec [ArtifactRef](/reference/glossary#artifactref), change manifest → T15·T16·T17과 이후 에이전트 레인이 소비 |
| **선행 태스크**   | T13                                                                                                                                                       |
| **병렬 가능**     | 없음                                                                                                                                                      |
| **관련 스킬**     | `/spec-to-pr:generate-openspec`                                                                                                                           |
| **담당 에이전트** | -                                                                                                                                                         |

## 왜 필요한가

T13이 만든 그래프는 기계가 읽기 좋지만 사람이 리뷰하기 어렵다. 구현 에이전트와 리뷰어가 공유할 단일한 스펙 진실 소스가 없으면, 이후 단계(T15 Gherkin, T19~T21 구현 레인)는 각자 다른 해석 위에서 움직이게 된다.

T14는 그래프를 다음 구조의 OpenSpec change 폴더로 변환한다:

```text
openspec/changes/<change>/
├── proposal.md
├── design.md
├── tasks.md
├── specs/<area>/spec.md
└── artifacts/
    ├── evidence-summary.md
    ├── traceability-matrix.md
    ├── gap-summary.md
    └── change-manifest.json
```

## 동작 흐름

1. change 이름을 검증한다.
2. OpenSpec 디렉터리 구조를 생성한다.
3. EvidenceGraph·TraceabilityMatrix에서 OpenSpec 모델을 빌드한다.
4. 같은 spec 영역에서 같은 요구사항 제목을 설명하는 반복 traceability 행을 렌더링 전에 병합한다 — 증거·[Gap](/reference/glossary#gap)·태그를 합치고 가장 엄격한 상태를 채택한다.
5. `proposal.md`, `design.md`, `tasks.md`, `specs/<area>/spec.md`를 렌더링한다.
6. 증거 요약·추적성 매트릭스·Gap 요약·manifest 아티팩트를 생성한다.
7. 생성 파일을 ArtifactRef로 Run에 기록한다.
8. (선택) OpenSpec CLI 검증을 실행한다.

### 생성 규칙

- 소스 증거 없는 요구사항을 만들지 않는다.
- Gap을 숨기지 않는다.
- 명시적 force 없이 기존 OpenSpec 파일을 덮어쓰지 않는다.
- projectRoot 안에만 쓴다.
- 생성된 spec은 추적성 주석 또는 링크를 포함해야 한다.

### 범위 제외 (Non-goals)

OpenSpec archive(→ T32), OpenSpec apply, 코드 구현, Gherkin 생성(→ T15), 인수 테스트, PR 발행(→ T30~T31)은 하지 않는다.

## 입력 상세

- **Run ID** — 대상 Run.
- **EvidenceGraph / TraceabilityMatrix 아티팩트** — T13 산출물.
- **change 이름** — OpenSpec change 폴더 이름 (검증 대상).
- **대상 spec 영역** — `specs/<area>/spec.md`로 나뉘는 영역 목록.

## 출력 상세

- **OpenSpec change 폴더** — 위 구조. 요구사항이 존재하면 최소 1개의 `specs/<area>/spec.md`가 생성된다.
- **change-manifest.json** — 생성된 파일·요구사항·증거·Gap의 목록:

```json
{
  "changeName": "add-staff-directory",
  "specAreas": ["staff"],
  "files": ["proposal.md", "design.md", "tasks.md", "specs/staff/spec.md"],
  "requirementCount": 12,
  "gapCount": 3
}
```

- **OpenSpec ArtifactRef** — 생성 파일을 Run에 기록.
- **선택적 검증 결과** — OpenSpec CLI 검증은 T14에서 선택 사항.

## 완료 조건 (Definition of Done)

- [ ] change 이름이 검증된다.
- [ ] OpenSpec 디렉터리 구조가 생성된다.
- [ ] `proposal.md`, `design.md`, `tasks.md`가 생성된다.
- [ ] 요구사항이 존재하면 최소 1개의 `specs/<area>/spec.md`가 생성된다.
- [ ] artifacts에 증거 요약·추적성 매트릭스·Gap 요약·manifest가 포함된다.
- [ ] 같은 요구사항의 중복 traceability 행은 증거·Gap·태그가 병합되고 가장 엄격한 상태를 가진 하나의 OpenSpec 요구사항으로 렌더링된다.
- [ ] 내용이 변하지 않았을 때 재생성은 멱등(idempotent)하다.
- [ ] 충돌하는 기존 파일이 감지된다.
- [ ] MCP 도구가 stdio 통합 테스트로 동작한다.

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

- OpenSpec 경로·모델 빌더·Markdown 렌더러·저장소 writer 충돌·`OpenSpecChangeService` 테스트 통과.
- MCP stdio 통합에서 `generate_openspec_change` 호출 성공.

## 알려진 한계

- OpenSpec CLI 검증은 T14에서 선택 사항이다.
- 생성된 요구사항은 보수적이다.
- Gherkin은 여기서 생성하지 않는다 (→ T15).
- 코드 구현은 수행하지 않는다.
- 충돌하는 기존 파일은 force 덮어쓰기가 필요하다.
- proposal·design 문구는 사람 리뷰로 다듬어질 수 있다.
