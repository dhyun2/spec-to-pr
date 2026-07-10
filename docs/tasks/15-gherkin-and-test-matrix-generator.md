---
sidebar_position: 15
title: "T15 · Gherkin·테스트 매트릭스 생성기"
sidebar_label: "T15 Gherkin·테스트 매트릭스"
---

# T15 · Gherkin·테스트 매트릭스 생성기

> **한 줄 요약** — [OpenSpec](/reference/glossary#openspec) change 모델로부터 Gherkin feature 파일과 테스트 매트릭스를 결정적으로 생성하는 태스크.

| 항목              | 내용                                                                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **목적**          | 리뷰 가능한 OpenSpec 요구사항을 시나리오 ID·테스트 레이어·자동화 준비도·증거/Gap 연결이 있는 테스트 커버리지 계산 단위로 변환한다                                          |
| **입력**          | [Run](/reference/glossary#run) ID, OpenSpec change 이름·manifest(T14), Run의 증거·[Gap](/reference/glossary#gap), 선택적 legacy feature coverage matrix                    |
| **출력**          | `.feature` 파일, `gherkin-index.json`, `test-matrix.json/.md`, [ArtifactRef](/reference/glossary#artifactref) → T18 컨텍스트 팩과 T19(Spec/BDD)·T22(Review Council)가 소비 |
| **선행 태스크**   | T14                                                                                                                                                                        |
| **병렬 가능**     | T16 (API 파이프라인), T17 (디자인 계약)                                                                                                                                    |
| **관련 스킬**     | `/spec-to-pr:generate-gherkin`                                                                                                                                             |
| **담당 에이전트** | -                                                                                                                                                                          |

## 왜 필요한가

OpenSpec 요구사항은 리뷰 가능하지만 테스트 커버리지를 계산하기에는 부족하다. 플러그인은 각 요구사항을 다음에 연결해야 한다:

- 하나 이상의 시나리오 ID
- 테스트 레이어
- 자동화 준비도(automation readiness)
- [EvidenceRef](/reference/glossary#evidence) ID
- Gap ID
- 미래의 테스트 파일 타깃

이 매트릭스가 없으면 T22(Review Council)는 "Gherkin 시나리오가 테스트로 커버되었는가"를 판정할 근거가 없다.

## 동작 흐름

1. OpenSpec change manifest와 Run의 증거·Gap을 로드한다.
2. 요구사항 상태에 따라 시나리오를 분류한다:
   - ready 요구사항 → 자동화 후보(automated-candidate) 시나리오
   - partial 요구사항 → review-needed 또는 manual 시나리오
   - blocked 요구사항 → 매트릭스에서 blocked 상태 유지 (실행 가능한 시나리오로 방출하지 않음)
   - Gap 전용 행 → 실행 가능한 시나리오가 되지 않음
3. spec 영역별로 `.feature` 파일을 그룹화해 생성한다.
4. 모든 시나리오에 요구사항 태그를, 가능하면 증거 태그를 붙인다.
5. `test-matrix.json`과 `test-matrix.md`를 생성한다.
6. Gherkin 아티팩트를 Run에 기록한다.

### 생성 규칙

- 마이그레이션 Run에서는 legacy 동작을 하나의 happy path로 뭉개지 말고 분기 동작을 별도 시나리오로 분리한다.
- legacy inventory에서 온 feature coverage Gap은 매트릭스에서 계속 보여야 하며, 조용히 실행 가능한 happy-path 시나리오로 변환되어서는 안 된다.
- 생성 파일은 결정적(deterministic)이어야 한다.

### 범위 제외 (Non-goals)

테스트 실행, Cucumber 러너 설치, Playwright 테스트 구현, step definition 생성, 인수 테스트 코드 실행, CI 통합, 커버리지 측정은 하지 않는다.

## 입력 상세

- **Run ID** — 대상 Run.
- **OpenSpec change 이름 / change-manifest.json** — T14 산출물.
- **Run 증거·Gap** — 시나리오 태그와 매트릭스 행 연결용.
- **legacy feature coverage matrix** (선택) — 마이그레이션 Run에서 분기 커버리지 판단용.

## 출력 상세

- `artifacts/gherkin/*.feature` — spec 영역별 Gherkin feature 파일.
- `artifacts/gherkin-index.json` — 시나리오 인덱스.
- `artifacts/test-matrix.json` / `test-matrix.md` — 요구사항 × 시나리오 매트릭스:

```json
{
  "rows": [
    {
      "requirementId": "REQ-STAFF-001",
      "scenarioIds": ["SCN-STAFF-001"],
      "layer": "e2e",
      "readiness": "automated-candidate",
      "evidenceIds": ["ev_..."],
      "gapIds": []
    }
  ]
}
```

- Run의 ArtifactRef 엔트리.

## 완료 조건 (Definition of Done)

- [ ] Gherkin 모델이 존재한다.
- [ ] 테스트 매트릭스 모델이 존재한다.
- [ ] ready 요구사항이 `.feature` 시나리오를 생성한다.
- [ ] partial/blocked 요구사항이 매트릭스에 표현된다.
- [ ] feature 파일이 spec 영역별로 그룹화된다.
- [ ] `test-matrix.json`과 `test-matrix.md`가 생성된다.
- [ ] Gherkin 아티팩트가 Run에 기록된다.
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

- Gherkin 모델·테스트 매트릭스 정책·생성기·렌더러·writer·`GherkinTestMatrixService` 테스트 통과.
- MCP stdio 통합에서 `generate_gherkin_test_matrix` 호출 성공.

## 알려진 한계

- 생성된 feature 파일은 그 자체로 실행 가능하지 않다 — step definition·Cucumber 러너·Playwright/Vitest 테스트 코드는 생성하지 않는다.
- blocked 요구사항은 매트릭스에는 표현되지만 실행 가능한 시나리오로 방출되지 않는다.
- 시나리오 문구는 보수적이며 이후 Spec/BDD 에이전트(T19)가 다듬어야 한다.
- 관측되지 않은 legacy 분기를 추론하지 않는다 — 누락된 분기 증거는 커버리지 Gap으로 남는다.
