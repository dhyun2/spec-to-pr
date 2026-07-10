---
sidebar_position: 32
title: "T32 · 수동 머지 후 OpenSpec 아카이브 라이프사이클"
sidebar_label: "T32 아카이브"
---

# T32 · 수동 머지 후 OpenSpec 아카이브 라이프사이클

> **한 줄 요약** — 사용자가 명시적으로 머지 후 워크플로를 시작하고 명시적 머지 증거가 있을 때만 [OpenSpec](/reference/glossary#openspec) 변경을 아카이브한다 — 폴링도 백그라운드 워처도 없다.

| 항목              | 내용                                                                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **목적**          | PR/MR 머지 후 OpenSpec 변경을 안전하게 아카이브하되, 추측된 머지 상태로는 절대 실행하지 않는다                                                                  |
| **입력**          | 선택적 Run ID·change name(fallback), T31 [PublishResult](/reference/glossary#publishresult) 아티팩트, 머지 증거(사용자 확인/1회 원격 확인/웹훅), execute 플래그 |
| **출력**          | 머지 증거 아티팩트, 아카이브 플랜·결과·리포트 아티팩트, 로그 아티팩트, 후속 커밋 요구사항 — T33 릴리스 준비의 전제                                              |
| **선행 태스크**   | T31 (+ 사람이 수행한 실제 PR/MR 머지)                                                                                                                           |
| **병렬 가능**     | 없음                                                                                                                                                            |
| **관련 스킬**     | `/spec-to-pr:archive-openspec` (`disable-model-invocation: true`)                                                                                               |
| **담당 에이전트** | `agents/openspec-archive-reviewer.md`                                                                                                                           |

## 왜 필요한가

T31은 PR/MR을 발행·갱신하고 멈춘다. 플러그인은 리뷰 상태를 계속 감시하지 않는다. 이후 사람들이 PR/MR을 리뷰하고, [Gap](/reference/glossary#gap)을 해소하고, CI를 재실행하고, 머지한다. T32는 사용자가 돌아와 머지 후 아카이브를 명시적으로 요청할 때만 시작된다. **T32는 백그라운드 워커가 아니다.**

## 동작 흐름

1. 사용자가 명시적으로 요청한다. 일반 경로는 짧다:

   ```text
   PR 머지했어. archive 해줘.
   ```

   또는 슬래시 커맨드:

   ```text
   /spec-to-pr:archive-openspec --merge-confirmed
   ```

   Run ID와 change name은 fallback 입력이며 일반 경로에서는 불필요하다:

   ```text
   /spec-to-pr:archive-openspec --run <run-id> --change <change-name> --merge-confirmed --execute
   ```

2. `resolve_archive_target` (읽기 전용) — 사용자가 생략한 [Run](/reference/glossary#run)·변경·PR/MR URL을 [RunStore](/reference/glossary#runstore)에서 해석한다:
   - `runId`가 있으면 해당 Run 안에서 해석, `changeName`이 있으면 명시적 fallback으로 사용.
   - 둘 다 없으면 최근 Run에서 T31 publish 결과와 미아카이브 OpenSpec 변경을 탐색.
   - 후보 1개 → 반환. 복수 → 목록 반환 후 사용자 선택 요구. 0개 → unresolved 반환, 플랜 없음.
   - 폴링·백그라운드 감시·머지 상태 추론은 하지 않는다.
3. 머지 증거를 기록한다 — 셋 중 하나:
   - `record_user_merge_attestation` — 사용자 확인(user-attested)
   - `check_review_request_status_once` — 호출당 최대 1회의 명시적 원격 API 상태 확인
   - 웹훅 기록 (미래 통합)
4. `plan_openspec_archive` (읽기 전용) — 아카이브 플랜을 만들고 `polling: false`를 보고한다.
5. `run_openspec_archive` — `yes: true`가 필수이며, 실행 전에 서버 측에서 플랜을 재계산한다. 열린 blocker gap 또는 "closed지만 unmerged"인 리뷰 요청은 아카이브를 차단한다.
6. 아카이브 실행의 stdout·stderr·exit code·결과·리포트를 [ArtifactRef](/reference/glossary#artifactref)로 기록한다. 실패한 아카이브는 자동 되돌리기 하지 않는다.
7. `get_openspec_archive_report` — 결과 조회.

## 입력 상세

- **선택적 Run ID / OpenSpec change name** — fallback 전용.
- **T31 PublishResult 아티팩트** — Run에 이미 기록된 발행 증거.
- **머지 증거** — user-attested < remote-checked < webhook-recorded 순으로 신뢰도가 높아진다.
- **execute 플래그** — 실제 아카이브 실행 여부. 없으면 플랜까지만.

## 출력 상세

- **머지 증거 아티팩트** — 증거 종류·시각·출처.
- **아카이브 플랜** — `polling: false` 포함.
- **아카이브 결과·리포트 아티팩트** — blocked/failed도 결과 아티팩트로 기록된다.
- **stdout/stderr 로그 아티팩트** — 아카이브 명령 실행 시.
- **후속 커밋 요구사항** — 아카이브로 변경된 OpenSpec 파일의 커밋/푸시는 사용자 몫.

## 완료 조건 (Definition of Done)

- [ ] 머지 증거 계약이 존재한다.
- [ ] 아카이브 타깃 리졸버가 Run ID·change name 생략을 지원한다.
- [ ] 아카이브 플랜 계약에 `polling: false`가 포함된다.
- [ ] 사용자 확인이 머지 증거 아티팩트를 기록한다.
- [ ] 1회성 원격 상태 확인이 머지 증거 아티팩트를 기록한다.
- [ ] 아카이브 실행이 증거 없음·미머지 상태를 거부한다.
- [ ] 아카이브 실행이 stdout·stderr·exit code·결과·리포트를 기록한다.
- [ ] MCP가 수동 아카이브 툴(`resolve_archive_target`, `plan_openspec_archive`, `record_user_merge_attestation`, `check_review_request_status_once`, `run_openspec_archive`, `get_openspec_archive_report`)을 노출한다.
- [ ] 스킬이 수동·무폴링 워크플로를 문서화한다.
- [ ] 타깃 해석·플랜·확인·1회 상태 확인·아카이브 결과·MCP stdio 테스트가 존재한다.

## 검증 방법

```bash
pnpm format:check
pnpm typecheck
pnpm schemas:build
pnpm build
pnpm test
pnpm audit
```

## 알려진 한계

- 기본 구현은 폴링하지 않고, 웹훅 리스너는 포함되지 않는다.
- 원격 상태 확인은 명시적으로 요청될 때만 일어난다.
- 사용자 확인 머지 증거는 원격 API 증거보다 약하다.
- 아카이브 커밋/푸시는 자동이 아니다.
- 실제 아카이브 실행에는 OpenSpec CLI가 필요하다.
- closed지만 unmerged인 PR/MR은 아카이브되지 않는다.

## 실패 정책

- blocked 아카이브와 failed 아카이브 모두 아카이브 결과 아티팩트로 기록된다.
- 서비스는 OpenSpec 파일을 자동으로 되돌리지 않는다.
- 서비스는 blocker gap을 면제하지 않는다.
- 후속 수리·커밋·푸시·롤백은 사용자 또는 릴리스 프로세스의 결정으로 남는다.
