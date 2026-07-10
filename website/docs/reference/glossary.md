---
sidebar_position: 5
title: 용어집
---

# 용어집

SpecToPR 문서 전반에서 쓰이는 용어들입니다. 태스크 문서의 용어 링크가 이 페이지로 연결됩니다.

## 실행 단위

### Run {#run}

하나의 요청에 대한 최상위 실행 단위. 소스·증거·산출물·gap·에이전트 결과·스테이지 상태를 모두 소유하는 단일 진실 원천. SQLite에 저장되어 세션이 끊겨도 재개 가능.

### Stage {#stage}

Run을 구성하는 결정론적 작업 단위(총 26개). `pending → running → passed/failed/blocked/skipped/waived` 상태 기계를 따르며 재시도(기본 3회)와 checkpoint를 가진다.

### Lease {#lease}

스테이지 실행권. 5분 TTL로 획득하고 heartbeat로 갱신. 워커가 죽으면 만료 후 다른 워커가 인수한다.

### Checkpoint {#checkpoint}

스테이지 중간 상태 저장점. Run 재개 시 여기서부터 이어서 실행된다.

### RunStore {#runstore}

Run을 저장·조회하는 영속 계층. SQLite + JSON blob으로 구현되며 revision 기반 낙관적 동시성 제어를 제공한다.

## 입력과 증거

### Source {#source}

큰 입력물 — 기획서 파일, Figma URL, OpenAPI 문서, 저장소 스냅샷.

### SourceRef {#sourceref}

Source에 대한 참조. 안정적인 SHA-256 digest, 스냅샷 메타데이터, 출처 정보를 포함한다.

### Content Addressing {#content-addressing}

파일을 SHA-256 digest 기준으로 저장하는 방식. "그때 그 Run이 본 기획서"를 바이트 단위로 고정한다.

### Evidence {#evidence}

Source 안의 정확한 위치를 가리키는 증거 — 파일 라인 범위, JSON Pointer, Figma 노드 ID, git 범위.

### Artifact {#artifact}

파이프라인이 생성한 산출물 — OpenSpec, Gherkin, 테스트 리포트, 스크린샷, PR 리포트 등.

### Gap {#gap}

기대와 관찰의 차이, 또는 확인하지 못한 것의 기록. 상태는 `open / assumed / waived / resolved`. 조용한 추측 대신 gap을 남기는 것이 원칙.

### Gap Ledger {#gap-ledger}

Run의 모든 gap(요구사항·API·디자인·커버리지)을 모아 관리하는 장부. Review Council이 갱신하며 PR 본문에 그대로 노출된다.

### Intake Manifest {#intake-manifest}

사용자 요청을 정규화한 기록 — 프로젝트 위치, 기획서 경로, Figma URL, OpenAPI 경로, 브랜치·발행 정책.

### ProjectProfile {#projectprofile}

대상 저장소를 검사해 얻은 관례 정보 — 패키지 매니저, 프레임워크, TypeScript, FSD 레이어, 디자인 시스템 후보.

## 계약 산출물

### Evidence Graph {#evidencegraph}

요구사항 ↔ API 오퍼레이션 ↔ Figma 노드를 연결한 결정론적 그래프. 연결이 빈 곳이 곧 gap이다.

### Traceability Matrix {#traceabilitymatrix}

Evidence Graph를 표로 편 것 — 요구사항별로 API·디자인·시나리오·테스트가 연결됐는지 보여준다.

### OpenSpec {#openspec}

사람이 리뷰 가능한 변경 제안 문서 묶음(proposal.md, design.md, specs/). 구현 전에 확정되는 계약.

### Gherkin {#gherkin}

Given-When-Then 형식의 BDD 시나리오(.feature). OpenSpec 요구사항마다 생성된다.

### Test Matrix {#test-matrix}

시나리오별로 어떤 종류의 테스트(unit·component·contract·e2e)가 어디에 있어야 하는지의 계획표.

### API Pipeline {#api-pipeline}

OpenAPI에서 생성되는 타입(Zod)·래퍼·mock·계약 테스트 스켈레톤 일체.

### Drift {#drift}

OpenAPI 명세와 실제 생성/구현된 코드 사이의 불일치. 드리프트가 감지되면 gap으로 기록된다.

### Design Contract {#design-contract}

Figma 컴포넌트 ↔ 코드 컴포넌트, 디자인 토큰 매핑을 확정한 계약. UI 에이전트의 하드코딩을 막는다.

### Design System Inventory {#design-system-inventory}

Figma 원본 산출물에서 파싱한 컴포넌트·variant·변수·텍스트 스타일 목록.

### Component Contract {#component-contract}

개별 Figma 컴포넌트의 치수·패딩·radius·그림자·타이포·variant와 시각 검증 임계값 명세.

### Code Connect {#code-connect}

Figma 컴포넌트와 코드 컴포넌트를 매핑하는 Figma 기능. Design Contract의 입력으로 쓰인다.

## 에이전트 실행

### Lane {#lane}

역할별 구현 흐름 — Spec/BDD, API Contract, Design/UI 세 개. 각자 격리된 worktree에서 병렬 작업한다.

### Worktree {#worktree}

에이전트에게 주어지는 격리된 git 작업 폴더. `.spec-to-pr/worktrees/<runId>/<agent>` 경로, `spec-to-pr/<runId 축약>/<agent>` 브랜치.

### Context Pack {#context-pack}

에이전트별로 조립된 구조화된 입력 — Run 요약, 필요한 계약 산출물, 역할 지시, 파일 소유권 정책, 사용자 제약.

### File Ownership Policy {#file-ownership-policy}

에이전트가 수정할 수 있는 경로의 명시적 목록. lane 간 침범을 구조적으로 막는다.

### AgentResult {#agentresult}

에이전트가 반환하는 구조화된 결과 — 체크 결과, gap, 권고. 자연어 보고를 대체한다.

### CheckResult {#checkresult}

개별 검증(테스트·게이트·비교)의 구조화된 결과 — 무엇을 어떤 기준으로 검사했고 pass/fail이 무엇인지 기록한다.

### ArtifactRef {#artifactref}

Artifact에 대한 안정적인 참조. digest와 종류(kind)를 포함해, 리포트·PR 본문에서 산출물을 정확히 가리킬 때 쓴다.

### Decision {#decision}

파이프라인의 판정 기록 — 무엇을 근거(Evidence·CheckResult)로 어떤 결정(passed/retry/blocked 등)을 내렸는지 남긴다.

### Review Council {#review-council}

세 lane의 결과를 교차 검토하는 판정 에이전트. verdict는 `approved / changes_requested / blocked`, 재검토는 최대 2사이클입니다. 모델 선택은 활성 호스트와 세션 설정에 따릅니다.

### Integrator {#integrator}

승인된 변경만 통합 worktree로 cherry-pick하고 충돌 시 bounded repair를 수행하는 에이전트.

## 평가와 게이트

### Scorecard {#scorecard}

Run의 9차원 평가표(각 0~10점, 기본 임계값 8.0). 비율 입력은 자동 정규화(0.85 → 8.5). 판정은 `passed / retry / blocked`.

### Quality Gate {#quality-gate}

lint·typecheck·build·자동화 테스트로 구성된 필수 결정론적 검증. 끌 수 없다.

### Visual Baseline {#visual-baseline}

시각 회귀의 비교 기준 이미지. 기본은 Figma 스크린샷, 마이그레이션에서는 `legacy-screenshot`으로 전환 가능.

### Repair Loop {#repair-loop}

기준 미달 시 자동 수리를 반복하는 한정 루프. 시각 회귀는 0.98 도달까지 최대 3회. 상한 도달 시 blocker를 남기고 사람에게 넘긴다.

### FSD {#fsd}

Feature-Sliced Design. `app/processes/pages/widgets/features/entities/shared` 레이어와 단방향 의존 규칙. T24가 경계를 검증한다.

### Web Vitals {#web-vitals}

Google의 사용자 경험 핵심 지표 — LCP·INP·CLS 등. T28 성능 게이트가 랩 환경에서 측정하고 readiness를 판정한다.

### Redaction {#redaction}

로그·텔레메트리에서 비밀값(토큰·키·개인정보)을 `[REDACTED]`로 치환하는 규칙. 키 패턴과 값 패턴(bearer, `sk-`, `ghp_` 등)으로 감지한다.

## 마이그레이션

### Legacy Feature Inventory {#legacy-feature-inventory}

레거시 저장소를 스캔해 추출한 기능 목록(15개 카테고리 — native-bridge, analytics, query-param 등). 파일·라인·스니펫 포함.

### Feature Coverage Matrix {#feature-coverage-matrix}

레거시 기능 → OpenSpec → Gherkin → 테스트/증거 연결표. 빈 칸은 Review Council 전에 blocker가 된다.

## 발행

### Publish Policy {#publish-policy}

PR/MR 발행 여부와 모드(draft 고정 권장). blocked 판정 시 신규 발행이 차단된다.

### PublishResult {#publishresult}

발행 시도의 구조화된 결과 — 대상(GitHub/GitLab), PR/MR URL, 상태, 실패 사유를 기록한다.
