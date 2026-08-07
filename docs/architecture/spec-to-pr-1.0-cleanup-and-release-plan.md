# SpecToPR 1.0.0 정리·마이그레이션·릴리스 계획

- 상태: Accepted plan — deletion remains deferred until each listed exit condition is met
- 목표 릴리스: `1.0.0`
- 작성일: 2026-08-07
- 전제: 이 문서는 삭제와 변경의 계획이다. 현재 dirty worktree의 기존 변경을 삭제하거나 되돌리지 않는다.

## 1. 목적

1. 0.3.x에서 임시로 추가된 fast legacy 우회와 서로 충돌하는 정책을 제거한다.
2. OpenSpec 등 핵심 개발 흐름에 필요하지 않은 결합을 optional adapter로 분리한다.
3. 오래된 스키마와 보고서 호환 코드는 데이터를 내보낸 뒤 제거한다.
4. 화면 비교, source inventory, packet freshness, artifact 검증처럼 가치 있는 안전장치는 유지한다.
5. 버전만 `1.0.0`으로 바꾸는 릴리스가 아니라 계약·데이터·문서·설치본이 일치하는 깨끗한 재출시를 만든다.

목표 아키텍처는 [`spec-to-pr-1.0-architecture.md`](./spec-to-pr-1.0-architecture.md)를 따른다.
네 PR renderer의 상세 계약은
[`spec-to-pr-1.0-pr-templates.md`](./spec-to-pr-1.0-pr-templates.md)를 따른다.

## 2. 정리 원칙

- **지금 지운다**: 같은 버전에서 정책을 뒤집는 임시 우회, dead code, orphan build artifact
- **대체 후 지운다**: 새 Gap ledger, PR renderer, planner가 준비되어야 제거할 코드
- **내보낸 뒤 지운다**: 0.3.x Run·schema compatibility
- **핵심에서 분리한다**: OpenSpec 같은 선택 기능
- **유지한다**: 안전성, 증빙 무결성, 정확한 경로, visual comparator, 독립 리뷰
- **추측으로 지우지 않는다**: import graph, runtime use, fixture, release packaging을 확인한다.

각 삭제는 다음 증거를 갖춰야 한다.

1. 대체 동작과 소유 모듈
2. import와 public export 사용처 0건 또는 명시적 migration
3. 관련 회귀 테스트
4. clean build 후 generated artifact 재생성
5. 0.3.x 데이터 export 또는 삭제 승인

## 3. 삭제·교체 인벤토리

### 3.1 1.0 구현 초기에 제거할 임시 fast legacy 경로

| 후보                                     | 현재 문제                                 | 1.0 처리  | 삭제 조건                                     |
| ---------------------------------------- | ----------------------------------------- | --------- | --------------------------------------------- |
| `isFastLegacyDelivery`                   | legacy라는 이유로 필수 검증을 약화        | 제거      | scope 기반 gate resolver 적용                 |
| `resumeFastLegacyIntake`                 | API 불확실성을 자동 waive하고 진행        | 제거      | Gap ledger가 동일 사유를 open 상태로 보존     |
| `deliveryProfileFromRun`의 legacy 재해석 | 저장된 Run 정책을 현재 코드가 조용히 변경 | 제거      | policy snapshot과 digest를 Run에 고정         |
| contracts/review auto-skip 분기          | `skipped`를 완료처럼 사용 가능            | 제거      | required gate 상태 불변식 적용                |
| fast legacy ready-report 분기            | UI·기능 검증 없이 `ready` 가능            | 제거      | report decision이 실제 gate와 Gap에서 계산    |
| fast-path 전용 테스트와 `it.skip`        | 잘못된 동작을 보존하거나 검증 공백 생성   | 삭제·교체 | gap-first와 mandatory-visual 회귀 테스트 통과 |

주의: API parser의 blocker 분기를 단순 삭제만 해서는 안 된다. `LEGACY_API_METHOD_UNKNOWN`을 open Gap으로 변환하고 API 후보·근거·영향 화면을 보존하는 대체 구현이 먼저다.

### 3.2 대체 없이 제거 가능한 dead·stale 항목

아래 항목은 삭제 시점에 한 번 더 참조 검사를 하되 현재 감사에서 활성 경로가 없는 것으로 확인됐다.

- `src/pr-report/pr-report-model.ts`의 미사용 `pr-report-v1` view model과 전용 row schema
  - 공용 locale, decision, intent, metadata schema는 사용 중이므로 함께 지우지 않는다.
- `benchmarks/runtime/baseline-v1.json`
  - 현재 성능 주장에 사용하지 않는 과거 baseline이며 README 설명도 함께 정리한다.
- 사용자에게 노출되는 제품 세대명 `v2`
  - MCP 설명, website 제목, release manifest의 `v2-facade` 같은 문구를 `1.0` 계약 용어로 교체한다.
  - `visual-capture-receipt-v2` 같은 wire schema 식별자는 제품 브랜딩이 아니므로 형식 변경 없이 이름을 되돌리지 않는다.
- transition이 없는 stage-level `waived`
  - 0.3.x Run 격리 뒤 stage 상태에서는 제거한다.
  - 사람의 명시적 승인 이력을 위한 Gap-level `waived`는 유지한다.

로컬 ignored 산출물은 1.0 canary와 rollback 자산을 확보한 뒤 명시 경로별로 정리할 수 있다.

- `artifacts/`와 `.release/`의 과거 release zip·report
- `.superpowers/`, `.playwright-mcp/`, `test-results/`
- `website/build/`과 package별 `node_modules/`
- 빈 `.worktrees`, `.claude/worktrees`, `.spec-to-pr-bin`
- 공식 tag archive와 digest가 확보된 뒤의 과거 plugin cache

이 항목들은 설계 단계에서 삭제하지 않는다. 실제 정리 명령은 workspace root나 glob이 아니라 검증된 개별 절대 경로를 사용한다.

### 3.3 OpenSpec 핵심 결합 분리

현재 OpenSpec 경로와 archive가 기본 delivery profile, workflow contract, archive service, Skill에 결합되어 있다. 1.0의 기본 Run에는 필요하지 않다.

분리 후보:

- `src/workflow/draft-evidence-bundle.ts`
- `src/openspec/openspec-paths.ts`
- `src/application/openspec-archive-service.ts`
- `src/mcp/run-service-provider.ts`의 core wiring
- `workflow-contracts.ts`의 기본 `draftEvidenceBundle`
- OpenSpec 전용 integration/unit tests
- README와 Skill의 필수 OpenSpec 경로 설명
- archive plan 중 OpenSpec만을 전제로 한 schema

목표:

1. core `workflow_archive`는 병합된 Run을 immutable 상태로 보관한다.
2. OpenSpec이 필요한 설치는 plugin의 adapter manager가 `@spec-to-pr/openspec-adapter`를 준비하며, 사용자가 Run 입력에 경로를 만들거나 다시 binding하지 않는다.
3. adapter 누락은 개발·리뷰·Draft 게시의 blocker가 아니다.
4. 기존 OpenSpec change를 지우기 전에 export와 병합 증거를 확인한다.

대체 adapter와 migration 문서가 준비되기 전에는 파일을 물리적으로 삭제하지 않는다.
특히 `draft-evidence-bundle.ts`를 통째로 지우지 않는다. OpenSpec 전용 필드와 archive 결합만
adapter로 옮기고, `.spec-to-pr`의 중립적인 core evidence workspace 계약은 새
`generatedEvidenceRoot` 모델로 대체·유지한다.

### 3.4 계약 호환 코드 정리

| 후보                                                 | 1.0 목표                             | 선행 조건                                                               |
| ---------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| persisted `mode: auto`                               | 명시적 mode만 저장                   | `workflow_plan`이 mode를 결정·노출                                      |
| singular `figmaUrl` compatibility                    | `figmaUrls[]`로 통일                 | 0.3.x export에서 변환 안내                                              |
| `LegacyInventoryV2CompatibilitySchema`               | current inventory schema 하나만 사용 | 0.3.x read-only exporter 제공                                           |
| source digest v1/v2 normalization                    | current digest만 쓰기                | 과거 artifact export 완료                                               |
| Figma geometry v1과 visual capture receipt v1 reader | current acquisition schema만 사용    | archive reader/exporter로 이동                                          |
| `legacy-v1` implementation-repair action             | generic packet repair로 통일         | old Run export와 새 repair action 완료                                  |
| `PrReportViewModelSchema`의 `pr-report-v1`           | 제거                                 | `pr-report-v3` renderer와 fixture 완성                                  |
| `pr-report-v2` / `v2.1` current publish acceptance   | v3 publish만 허용                    | 과거 report read-only viewer/export 제공                                |
| `draftEvidenceBundle` compatibility normalization    | 제거                                 | OpenSpec adapter 분리와 데이터 migration                                |
| old Run schema literal parse                         | version-dispatched read-only loader  | 0.3.x export/diagnostic path 완성                                       |
| 단수·복수 공개 입력 동시 지원                        | 배열 입력만 유지                     | `figmaUrls`, `docsPaths`, `openApiPaths/Urls`, named fixtures migration |

1.0 core는 0.3.x Run을 mutable resume하지 않는다. 정확한 오류와 다음 명령을 제공한다.

```text
This Run uses the 0.3.x contract and is read-only in SpecToPR 1.0.
Export it with the 0.3.7 bridge or `spec-to-pr legacy export <run-id>`.
Start a new 1.0 Run from the exported scope and Gap summary.
```

### 3.5 PR report 정리

교체 대상:

- 15개 section을 기본 본문에 모두 출력하는 v2 renderer
- 내부 stage/revision/schema/artifact 정보를 전면에 노출하는 block
- old `pr-report-v1`, `pr-report-v2`, `pr-report-v2.1` current publication branches
- ready/blocked 이분법

대체:

- `pr-report-v3` canonical model
- `draft-with-gaps`, `verified`, `changes-requested`, `publish-failed` 같은 reviewer 의미 중심 decision
- 공통 Gap-first shell과 `legacy-migration`, `brief-delivery`, `feature-flow`, `figma-ui` discriminated renderer
- UI scope의 필수 화면 비교와 Feature flow의 필수 사용자 흐름 영상
- 전체 파일, API inventory, artifact metadata는 접힌 상세 또는 링크
- baseline/current 같은 크기 preview와 diff/overlay 진단
- internal/raw log, Run ID, 빈 section·표·checklist를 생성하지 않는 negative rendering rule

기존 report artifact를 삭제하지 않는다. read-only export에서 원본을 유지한다.

### 3.6 generated output 정리

현재 `dist/mcp`에는 hash가 바뀐 chunk의 삭제·추가가 함께 존재할 수 있다. 개별 hash 파일을 손으로 고르지 않는다.

1. source 변경을 먼저 확정한다.
2. release build가 output directory를 안전하게 clean하고 전부 재생성한다.
3. manifest/import가 참조하지 않는 orphan chunk가 0개인지 검사한다.
4. repository가 `dist`를 배포물로 commit할지, release artifact에서만 만들지 한 방식을 선택한다.
5. 선택한 방식을 README, CI, prepare-release 절차에 고정한다.

### 3.7 삭제하면 안 되는 핵심 자산

다음은 복잡해 보여도 1.0의 신뢰성에 필요하다.

- bounded legacy inventory와 source dependency graph
- exact root/path safety 검사
- legacy API provenance와 terminal HTTP call 추적
- 동일 operation을 호출 위치별로 구분하는 `callSiteKey`
- visual capture validator와 runtime-owned comparator
- baseline/current/diff/overlay artifact
- immutable review packet과 stale packet 차단
- artifact digest와 content-addressed storage
- independent functional/design reviewer 경계
- GitHub/GitLab host adapter의 idempotency와 mutation fence
- secret-shaped path/URL 검사
- workload와 capture reuse 최적화 중 품질을 약화하지 않는 부분

version 문자열이 오래됐다는 이유만으로 schema를 먼저 삭제하지 않는다. 대체 schema와 export 경로가 있어야 한다.

## 4. 목표 코드 경계

```text
src/
  planning/                 # workflow_plan, exact scope/binding, safety
  policy/                   # canonical versioned policy + digest
  gaps/                     # Gap ledger, effect, resolution history
  workflow/                 # generic state machine, no mode-specific fast path
  legacy/                   # bounded discovery and provenance, never a gate owner
  review-packet/            # Git-owned snapshot and freshness
  visual/                   # mandatory-for-UI capture and comparison
  user-flow/                # packet-bound Feature video receipt and validator
  review/                   # functional/design/accessibility adapters
  report/                   # pr-report-v3 common Gap-first shell
    templates/              # legacy, brief, feature, figma renderer
  publication/              # host-neutral service + GitHub/GitLab adapters
  persistence/              # versioned durable store and export
packages/
  codex-sdk/                # generated from public contract/policy
  openspec-adapter/         # optional; core에서 분리할 경우
```

`workflow-service.ts`의 거대한 mode·stage 조건문을 그대로 확장하지 않는다. planner, policy, Gap, packet, report, publication 책임을 각각 분리한 뒤 facade는 orchestration만 담당한다.

## 5. 데이터 마이그레이션 계획

### 5.1 릴리스 전 호환·export bridge

이미 배포된 `0.3.6`을 같은 버전의 다른 바이트로 다시 발행하지 않는다. read-only 기능은
`0.3.7` 호환 bridge 또는 1.0과 함께 배포하는 독립 exporter로 먼저 제공한다.

- `legacy list`: 저장된 Run과 schema version 확인
- `legacy export <run-id>`: manifest, scope, binding, Gap/blocker, report, artifact index export
- `legacy backup`: SQLite와 artifact store consistent backup
- `legacy doctor`: 손상·누락 artifact와 secret-shaped path 검사

bridge는 기존 Run 의미를 바꾸지 않는다.

### 5.2 1.0 store

- OS temp가 아닌 플랫폼별 durable user data directory를 기본값으로 쓴다.
- repository identity로 namespace를 나눈다.
- schema version table과 forward-only migration journal을 둔다.
- migration은 `--dry-run`을 먼저 제공한다.
- 원본 DB와 artifact는 성공 확인 전까지 수정하거나 삭제하지 않는다.

### 5.3 호환 정책

- 1.0은 0.3.x metadata를 탐지하고 read-only 진단만 제공한다.
- 0.3.x Run을 새 policy로 조용히 재해석하지 않는다.
- 새 1.0 Run을 만들 때 export된 scope·Gap을 입력으로 사용할 수 있다.
- 새 Run은 새 base/head에서 검증을 다시 실행한다. 과거 `passed`를 자동 승계하지 않는다.

## 6. 구현 단계

### Phase 0 — 동결과 기준선

- 0.3.6 source, 설치 캐시, generated dist의 차이를 기록한다.
- dirty tree의 기존 작업을 별도 commit/patch로 보존한다.
- 현재 policy matrix를 snapshot test로 고정해 모순을 가시화한다.
- 0.3.x Run/export fixture를 만든다.

완료 조건: 삭제 전에 되돌아갈 source tag, 데이터 backup, 재현 fixture가 있다.

### Phase 1 — 계약과 정책 단일 원천

- plugin `1.0.0`, workflow contract `3.0.0`, report `v3`, Run manifest 새 버전을 정의한다.
- 입력 `mode`와 검증 `scope`를 분리한다. 어떤 mode도 UI scope의 화면 비교를 끌 수 없다.
- mode→네 PR template mapping과 Feature 영상 requirement를 canonical policy에 포함한다.
- core에는 공급자 이름 대신 `fast`/`build`/`expert` 역할과 `adaptive-verified`/`pinned`/`custom`
  전략만 저장한다. host adapter의 Codex 또는 Claude mapping, 실제 fallback, 품질 저하 Gap을
  release fixture로 검증한다.
- 필수 gate의 `skipped != passed` 불변식을 구현한다.
- policy manifest와 digest에서 SDK, Skill 표, README 검증을 생성한다.

완료 조건: legacy UI도 화면 비교·기능·디자인 검증이 필수로 계산된다.

### Phase 2 — Plan, Gap, implementation flow

- read-only `workflow_plan`과 one-time `planToken`을 구현한다.
- exact path, isolated worktree, safety-stop 규칙을 구현한다.
- Gap ledger와 기본 effect를 구현한다.
- API matcher failure와 binding/publish preflight failure를 Gap으로 변환한다.
- runtime-owned Git snapshot으로 `changedFiles` 이중 입력을 제거한다.

완료 조건: `shop`을 `shopping`으로 바꾸지 않으며, API ambiguity가 구현을 막지 않는다.

### Phase 3 — UI·흐름 증빙과 네 PR template

- UI scope promotion과 mandatory comparison action을 구현한다.
- capture 실패·점수 실패를 Draft 가능 Gap으로 표현한다.
- Feature 사용자 흐름 영상의 capture, redaction, 재생, packet freshness를 검증한다.
- 기능 리뷰와 화면 비교를 병렬화하고 design/accessibility verdict를 packet에 묶는다.
- `pr-report-v3` 공통 shell과 Legacy migration, Brief delivery, Feature flow, Figma UI renderer를 구현한다.
- 네 template의 pass/fail/not-run/Gap-first snapshot과 금지 정보 negative snapshot을 만든다.
- 오래된 report model과 renderer를 대체 후 제거한다.

완료 조건: 모든 UI fixture가 `passed|failed|not-run` 화면 결과를 가지며, 모든 Feature fixture가
`executed|not-run + Gap` 영상 결과를 가지고, mode별 정확한 template 하나에 렌더링된다.

### Phase 4 — 게시, optional adapter, persistence

- GitHub/GitLab 인증·CA preflight와 idempotent find/create/update를 구현한다.
- `requestSynced` 확인 없이 성공 보고하지 못하게 한다.
- OpenSpec을 optional adapter로 분리한다.
- durable store, export, dry-run migration을 완성한다.
- compatibility normalization을 제거한다.

완료 조건: 인증 실패는 개발을 막지 않으며, 중복 PR 없이 같은 Draft를 갱신한다.

### Phase 5 — 정리와 RC

- fast legacy, old report, old OpenSpec core wiring, dead compatibility code를 삭제한다.
- clean build로 dist를 재생성한다.
- docs/Skill/SDK/manifest의 policy digest를 검증한다.
- clean machine과 기존 설치 환경에서 RC canary를 실행한다.

완료 조건: 아래 릴리스 gate를 모두 통과한다.

## 7. 테스트 전략

### 필수 회귀 시나리오

1. legacy root `shop` 옆에 `shopping`이 있어도 `shop`만 선택한다.
2. 명시한 외부 `../sandbox_new/.../shop`은 read-only source로 허용하지만 그 경로에는 쓰지 않는다.
3. 동일 origin의 GET/POST 후보가 여러 개여도 open API Gap을 만들고 implementation action을 반환한다.
4. API body를 모르는 POST는 추측 연결하지 않고 UI와 확인된 GET은 구현한다.
5. UI scope는 delivery mode와 관계없이 visual action을 가진다.
6. 선언한 visual target 중 하나가 누락되면 `not-run` Gap이 되고 Draft에는 그대로 보인다.
7. visual 91%는 `failed`, Draft 가능, merge recommendation 불가다.
8. baseline 획득 실패는 `not-run`, Draft 가능, `passed` 불가다.
9. required review를 `skipped`로 제출하면 거절한다.
10. 검증 도구 timeout은 `not-run` Gap으로 확정되고 report·Draft가 계속된다.
11. 코드 변경 후 이전 packet review가 stale이 된다.
12. caller `changedFiles`와 관계없이 runtime Git diff가 authoritative다.
13. GitLab TLS/auth 실패 뒤 local report가 남고 `requestSynced: false`다.
14. publish retry는 기존 Draft를 update하고 중복 생성하지 않는다.
15. 0.3.x Run은 1.0에서 mutable resume되지 않고 export 안내를 반환한다.
16. token/cookie가 log, artifact, DB, PR body에 나타나지 않는다.
17. 네 mode가 각각 정확한 PR template 하나만 선택한다.
18. Legacy·Brief·Feature의 UI scope와 Figma UI가 화면 비교를 우회하지 못한다.
19. Feature 영상은 현재 packet에서 재생 가능하고 필수 사용자 단계를 포함한다.
20. Feature 영상 누락·stale·재생 불가는 `not-run + Gap`이며 Draft는 계속된다.
21. unresolved Gap은 본문 최상단에 영향과 리뷰어 결정을 포함한다.
22. 네 template 어디에도 internal/raw log, Run ID, 빈 section·표·checklist가 없다.

### 테스트 층

- unit: policy, Gap effect, status semantics, exact path, renderer
- property: state transition, idempotency, path escape, canonical digest
- integration: legacy intake→implementation→visual fail→Draft update
- renderer snapshot: 네 template의 verified/gap/visual/video failure variant
- adapter contract: GitHub/GitLab auth, TLS, uncertain mutation
- media contract: Feature video playback, steps, redaction, packet freshness
- visual golden: threshold, mask, alpha, viewport, fixture drift
- migration: 0.3.x fixture export, backup, read-only rejection
- packaging: source와 bundled dist의 version/policy equality

## 8. 버전과 릴리스 표면

버전은 현재 여러 manifest에 수동 중복되어 있다. 1.0에서는 release manifest 한 곳에서 다음 파일을 검증·갱신한다.

- root `package.json`
- `packages/codex-sdk/package.json`
- `.codex-plugin/plugin.json`
- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`

추가 marketplace 또는 generated metadata가 있으면 release inventory에 포함한다. 버전 불일치는 release preflight 실패다.
`pnpm version:set 1.0.0` 같은 단일 명령이 다섯 선언과 marketplace tag ref를 원자적으로 갱신하고 검증해야 한다. `website/package.json`의 비공개 문서 패키지 버전은 이 동기화 대상이 아니다.

| 식별자               | 1.0 값                         | 의미                          |
| -------------------- | ------------------------------ | ----------------------------- |
| plugin/package       | `1.0.0`                        | 사용자에게 배포되는 제품 버전 |
| public protocol      | `3.0.0`                        | tool 입력·출력과 단계 의미    |
| persisted Run schema | `3`                            | SQLite에 저장되는 Run 구조    |
| report               | `pr-report-v3`                 | canonical report 구조         |
| delivery policy      | 독립 semantic version + digest | 실제 mode/scope별 필수 gate   |
| build identity       | Git commit + bundle digest     | 같은 버전의 실제 설치 바이트  |

## 9. 릴리스 Gate

### 계약·정책

- runtime, SDK, Skill, README, plugin description의 mode/gate 표가 동일하다.
- Codex와 Claude adapter는 한 Run에 섞이지 않으며, `pinned`/`custom`도 화면 비교·테스트·독립
  리뷰·Gap 공개를 약화하지 않는다는 matrix test가 있다.
- bundled server의 `pluginVersion`, contract version, policy digest가 source와 동일하다.
- legacy UI에서 visual/functional/design가 opt-out되지 않는다.
- required `skipped`가 release fixture에서 0건이다.

### 기능·품질

- 전체 unit/integration/property/packaging test 통과
- 대표 legacy, brief, feature, figma Run E2E 통과
- visual pass/fail/not-run Draft fixture 검토
- 네 PR template의 pass/fail/not-run Gap-first golden body 승인
- 대표 Feature Run의 재생 가능한 사용자 흐름 영상 확인
- PR body 금지 정보와 빈 checklist negative snapshot 통과
- 0.3.x export와 1.0 read-only 진단 검증

### 게시

- GitHub와 GitLab preview가 mutation 전에 auth, remote, CA, identity를 확인한다.
- branch push 전에 host API 준비 상태를 확인한다.
- API가 실패하면 불필요한 remote mutation을 남기지 않는다.
- 생성·업데이트 후 host 재조회로 `requestSynced: true`를 확정한다.
- `glab` fallback 명령은 지원 버전에서 실제 실행 검증한다.

### 패키징·설치

- clean checkout build 결과에 orphan chunk가 없다.
- 설치된 canary에서 `workflow_info`가 `1.0.0/3.0.0`과 올바른 policy matrix를 반환한다.
- local path marketplace와 Git marketplace 업그레이드 경로를 각각 검증한다.
- dry-run은 실제 preflight를 모두 수행하고 mutation 직전에 멈춘다.
- local installed-canary가 성공하기 전 tag 또는 release branch를 push하지 않는다.
- branch와 tag는 검증된 commit에서 `git push --atomic`으로 함께 게시한다.
- Node 22 최소 지원 환경과 현재 지원 환경에서 archive smoke를 실행한다.
- website typecheck, build, broken-link 검사를 release plan에 포함한다.
- release notes와 manifest에 개인 절대 경로가 없는지 검사한다.

### 문서

- 설치, 인증, CA, upgrade, rollback 명령을 clean environment에서 복사 실행한다.
- `glab config get token --host <hostname>` 등 CLI 옵션은 지원 버전의 help와 integration test로 확인한다.
- 현재 GitLab CLI fallback 후보인 `glab config get token --host <hostname>`을 지원 버전에서 실제 검증하고 문서와 구현을 함께 고정한다.
- 0.3.x hardcode와 “legacy strict” 같은 오래된 표현이 남지 않는다.
- 한국어·영어 문서의 정책 의미를 비교하고 영문에 남은 `0.3.0` 고정 문구를 제거한다.

## 10. 릴리스 순서

1. 0.3.7 export bridge 또는 독립 exporter와 migration guide 배포
2. 1.0 source freeze
3. full preflight와 clean build
4. local tarball/plugin canary 설치
5. 실제 legacy UI fixture Run과 Draft PR 생성
6. GitHub/GitLab adapter canary
7. release candidate tag를 만들기 전 최종 diff 확인
8. 검증된 commit의 branch와 annotated tag를 atomic push
9. package/plugin/marketplace metadata 동시 게시
10. 설치본에서 다시 `workflow_info`와 smoke Run 확인
11. 성공 확인 뒤 공지 확정

원격 tag와 branch를 먼저 push한 뒤 local canary를 하는 순서를 금지한다.

개발 설치는 안정판 캐시를 같은 버전의 다른 바이트로 덮어쓰지 않는다. `1.0.0-dev.<commit>` 또는 `1.0.0-rc.N`과 별도 local marketplace를 사용한다. 안정판은 tag archive를 격리된 Codex home에 설치한 뒤 `pluginVersion`, build commit, bundle digest를 확인한다.

## 11. Rollback

- 공식 0.3.6 tag, 0.3.7 bridge를 발행했다면 그 tag, 1.0.0 tag를 각각 immutable하게 보존한다.
- 1.0 DB migration은 원본 backup을 수정하지 않는 forward-only 방식으로 한다.
- rollback은 0.3.6 binary와 원본 store를 다시 선택하는 방식이며 1.0 DB를 downgrade하지 않는다.
- package/plugin 게시가 일부만 성공하면 새 설치를 중단하고 일치하는 버전 세트를 다시 게시한다.
- host에 생성된 canary Draft는 명시적으로 표시하고 수동 정리한다. 사용자 PR을 자동 삭제하지 않는다.
- 보안·데이터 손상 문제는 즉시 배포 중단, 그 외 문제는 1.0.1 forward fix를 우선한다.

## 12. 삭제 완료의 정의

다음을 모두 만족해야 “레거시 정리 완료”다.

- fast legacy 분기와 mode별 hidden skip 0건
- core OpenSpec 의존 0건 또는 명시적 optional interface만 존재
- current runtime이 old report schema로 publish하는 경로 0건
- 0.3.x mutable normalization 0건
- orphan dist chunk 0건
- skipped test 0건
- README/Skill/SDK/runtime policy 불일치 0건
- 0.3.x export와 backup이 실제 fixture에서 복구 가능
- 대표 UI Run에서 화면 비교가 무조건 실행되고 PR 본문에 결과가 보임
- 네 mode가 정확한 PR template 하나를 사용하고 Feature 영상 결과가 본문에 보임
- 기본 PR 본문의 internal log, Run ID, 빈 checklist 0건

물리적 파일 수를 줄이는 것보다 숨은 우회와 중복 진실의 원천을 없애는 것이 이 정리의 성공 기준이다.
