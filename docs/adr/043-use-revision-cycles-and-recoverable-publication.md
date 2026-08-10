# ADR 043: Use revision cycles and recoverable publication

- Status: Proposed
- Date: 2026-08-10
- Target release: SpecToPR `1.1.0`

## Context

Mapfinder 레거시 UI 이관 Run은 시각 비교 실패 뒤 화면을 보정했지만, 새 커밋을 현재
implementation packet에 안전하게 연결하지 못했다. 이후 일반 GitLab Draft MR은 만들었으나
시각 산출물 동기화와 publication 완료 증빙은 남지 않았다.

조사 결과는 하나의 인증 문제나 상태 전이 문제로 설명되지 않는다.

1. 저장된 Mapfinder Run은 UI 작업인데도 canonical visual을 `not-applicable`로 기록했다.
2. 레거시 캡처는 strict receipt 없이 비교할 수 있지만, 실패 후 repair 증빙은 strict receipt에서만
   생기는 `captureSummary`를 요구한다. 비교 실패가 정상 repair 전이까지 도달하지 못한다.
3. `passed` implementation을 임의로 `running`으로 되돌리는 것은 의도적으로 금지되어 있다. 그러나
   새 Git snapshot으로 기존 packet을 교체하는 일반 revision 계약도 없다.
4. 레거시 visual submission은 현재 review packet freshness를 공통 검사하지 않아, 새 화면이 낡은
   packet에 붙을 수 있다.
5. 캡처 계약은 viewport와 bitmap geometry를 독립적으로 표현하지 못한다. 긴 full-page baseline은
   viewport 캡처와 크기가 다르고, full-page 캡처는 고정 pixel limit에 걸릴 수 있다.
6. Git push와 Node publisher는 서로 다른 TLS trust source를 사용한다. Git의 `http.sslCAInfo`가
   설정돼 있어도 전역 `fetch`는 이를 자동으로 사용하지 않는다. Mapfinder Run은 API URL에
   `/api/v4`도 빠져 있어, CA를 적용한 뒤에는 HTML 로그인 페이지를 JSON으로 읽었다.
7. `glab` 성공은 안전한 fallback의 증거가 아니었다. 해당 host의 `skip_tls_verify`가 켜져 있었다.
8. publication은 push, MR 조회·생성·갱신, asset upload, 원격 검증을 하나의 복구 가능한
   transaction으로 기록하지 않는다. 중간 실패 후 이미 존재하는 Draft를 채택할 공식 경로가 없다.
9. blocker 재구성 및 report renderer가 실제 원인과 다음 조치를 일반 영문과 반복 목록으로 덮는다.

레거시 repair 회귀는 `b9294d2`에서 receipt 없는 결과의 기본 `captureSummary`를 제거하면서,
failed target에는 같은 summary를 계속 요구해 도입됐다. 또한 3차 실패의 전용 attempt-limit 진단보다
일반 implementation guard가 먼저 실행되는 guard-order 결함이 있다.

Immutable review packet은 잘못된 제약이 아니다. 새 코드에 이전 리뷰를 재사용하지 못하게 하는
필수 fence다. 해결책은 packet을 수정하거나 `passed -> running`을 일반 허용하는 것이 아니다.

## Decision

### 1. Implementation은 append-only revision cycle로 관리한다

각 구현 제출은 `ImplementationCycle`에 속한다. 코드가 바뀌면 이전 cycle과 packet은
그대로 보존하고 `cycle-superseded`와 새 `cycle-created` event를 CAS batch로 append한다.
`current/superseded`는 event replay projection이다. 기능·디자인 리뷰, report, publication의 현재
projection만 무효화한다.

초기 호환 구현은 기존 retryable stage와 reopen helper를 사용할 수 있다. 다만 외부 계약에는 이를
실패가 아니라 `revision-required` action으로 표현하며, 모든 revision은 `supersedesPacketId`와
원인을 기록한다.

### 2. 모든 visual submission은 같은 freshness fence를 통과한다

UI scope 또는 visual target이 있으면 visual stage와 report applicability는 필수다. 결과가 없으면
`not-applicable`이 아니라 `not-run + Gap`으로 기록한다.

Figma와 레거시를 구분하지 않고 비교 전에 현재 packet, branch, head, diff digest를 검사한다.
낡은 submission은 비교하지 않고 새 implementation cycle만 안내한다.

### 3. 캡처 획득, 비교, repair를 서로 다른 durable event로 기록한다

획득 오류는 비교 횟수를 소모하지 않는다. 계약상 불가능한 geometry는 intake/contract 단계에서
거절한다. 정상적인 비교 실패는 receipt provenance와 무관하게 repair cycle을 열 수 있어야 한다.
baseline, actual, diff, overlay는 다음 전이 전에 Run artifact ledger에 귀속한다.

### 4. 캡처 계약은 viewport, content, bitmap geometry를 분리한다

`viewport`, `full-page`, `element` capture mode를 명시한다. 긴 full-page 대상은 bounded-memory tile
comparison을 사용한다. 단순히 전역 pixel limit을 높이지 않는다. 타일별 결과와 전체 집계 지표를
함께 저장한다.

### 5. 원격 게시에는 host-bound trust profile과 단일 transport를 사용한다

공개 core에 회사 GitLab 주소를 하드코딩하지 않는다. 설치 또는 workspace 설정의 host profile로
회사 GitLab을 zero-config에 가깝게 제공한다. CA 우선순위는 명시적 profile, exact-host Git 설정,
process-level Node CA, system CA다. API base URL과 JSON identity도 검증한다. TLS 검증 비활성화 및
`glab skip_tls_verify=true` fallback은 지원하지 않는다.

Preflight와 실제 GitLab API 호출은 동일한 HTTP transport를 사용한다. preflight는 host, project,
API identity, permission, TLS를 읽기 전용 요청으로 실제 검증한다.

### 6. Publication은 idempotent transaction으로 기록한다

transaction은 `preflight -> source-pushed -> request-bound -> assets-synced -> body-verified` 단계를
가진다. 재시도는 source/target branch와 head가 일치하는 기존 Draft를 조회해 채택하고, 누락된
asset과 본문만 동기화한다. 외부에서 생성한 MR 등록은 같은 조건을 원격에서 확인한 경우에만
허용한다.

동일 idempotency key의 publisher는 CAS claim, lease, heartbeat, fencing token으로 owner를 하나만
선출한다. 만료 lease를 인수한 owner는 원격 Draft를 reconcile하기 전 create를 호출할 수 없다.
원격 mutation을 발행했지만 응답을 확인하지 못한 claim은 `uncertain`으로 격리한다. successor는
deadline 이후 반복 reconcile에서 기존 MR을 확인하기 전에는 create할 수 없고, 끝내 확인되지 않으면
자동 생성 대신 명시적 recovery를 요구한다.

publication 실패는 제품 검증 실패가 아니라 `publication-pending`이다. transaction 완료 전에는
시각 산출물을 정리하지 않는다.

### 7. 사람용 표현과 기계용 진단을 분리한다

stable error code와 구조화 사실은 보존한다. 기본 사용자·MR 출력은 한국어로 원인 한 줄, 영향,
다음 조치를 먼저 보여준다. 내부 code, digest, 전체 파일 목록은 machine artifact 또는 접기 영역에
둔다. 레거시 범위는 requirement당 한 행만 렌더링한다.

## Consequences

### Positive

- 시각 보정 커밋이 기존 증빙을 오염시키지 않고 같은 Run에서 계속 진행된다.
- 레거시와 Figma가 같은 freshness와 artifact lifecycle을 공유한다.
- 긴 baseline이 구현을 끝낸 뒤에야 구조적으로 실패하는 일을 막는다.
- Git push 성공과 Node publisher 실패의 TLS 차이를 설정으로 흡수한다.
- MR 생성과 이미지 첨부 중 하나만 성공해도 재시도로 수렴한다.
- 사용자는 내부 상태 전이보다 실제 원인과 다음 행동을 먼저 본다.

### Negative

- cycle/event projection과 schema migration이 필요하다.
- tiled PNG comparison과 composite artifact 표현은 구현·테스트 비용이 크다.
- Git 및 Node의 CA source가 여러 개이므로 우선순위와 보안 경계 테스트가 필요하다.
- 기존 1.0 Run은 새 cycle 모델로 자동 변환하지 않고 read-only 또는 호환 projection으로 다뤄야 한다.

## Rejected alternatives

### Allow `passed -> running`

이전 리뷰가 새 코드에도 유효한 것처럼 보이게 하므로 거절한다.

### Mutate the existing packet SHA

불변 증빙과 감사 이력을 깨므로 거절한다.

### Increase the PNG pixel limit only

메모리 사용량과 diff output 크기를 통제하지 못하고 더 긴 화면에서 같은 문제가 반복되므로 거절한다.

### Set `NODE_TLS_REJECT_UNAUTHORIZED=0`

서버 인증을 제거하므로 거절한다.

### Hardcode Golfzon GitLab in the public core

공개 플러그인의 self-hosted GitLab 지원 범위를 훼손한다. 회사 배포 profile에서 기본값을 제공한다.

### Use an ad-hoc `glab mr create` after any HTTP error

POST 성공 여부가 모호한 상황에서 중복 MR을 만들 수 있다. transport는 mutation 전에 정하고,
재시도 전에는 반드시 기존 Draft를 reconcile한다.

현재처럼 `skip_tls_verify=true`인 `glab`은 transport 후보에서도 제외한다.

## Compatibility

- facade 도구 수는 유지한다. `workflow_submit(kind: implementation)`에 revision envelope를 추가하고
  status/advance가 `revise-implementation` action을 반환한다.
- 기존 visual target은 `capture.mode=viewport`로 해석하되, baseline header geometry가 맞지 않으면
  새 typed contract Gap으로 명확히 중단한다.
- 기존 publisher configuration은 기본 host profile로 승격한다.
- 기존 Run은 기록된 policy version으로 재생하며 새 schema로 조용히 재해석하지 않는다.

## Verification

결정은 다음 golden scenario가 한 Run에서 통과할 때 완료된다.

```text
legacy visual 1차 실패
→ 구현 수정·새 commit
→ 이전 packet supersede·새 packet 생성
→ 2차 통과
→ 독립 리뷰 완료
→ 사내 CA를 사용한 preflight
→ 기존 또는 새 Draft MR 동기화
→ baseline / actual / diff 링크와 본문을 원격 재조회로 확인
```
