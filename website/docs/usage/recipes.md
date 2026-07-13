---
sidebar_position: 1
title: 사용 레시피
---

# 사용 레시피

모드, 대상 저장소, 실제 source, 변경 범위, publication intent를 명시하면 가장 안정적입니다.

## 1. 기획서 → draft PR

```text
/spec-to-pr /absolute/path/to/app
mode: brief
briefPath: docs/checkout.md
changeKind: feature
기획서의 수용 조건만 구현하고 관련 검사로 검증해줘.
준비되면 draft PR로 발행해줘.
```

`briefPath`가 없으면 brief 모드를 시작할 수 없습니다. 문서에 없는 endpoint나 UI 동작은 추측하지 않고 gap으로 남깁니다.

## 2. 레거시 프로젝트의 특정 변경 → draft PR

```text
/spec-to-pr /absolute/path/to/legacy-app
mode: legacy
changeKind: fix
결제 재시도에서 409를 받았을 때 중복 알림이 뜨는 문제만 고쳐줘.
현재 동작을 focused baseline으로 남기고 영향받은 검사만 실행해.
전체 프로젝트 inventory나 migration은 하지 말고 draft PR로 발행해줘.
```

Legacy 모드는 구체적인 delta가 필요합니다. baseline은 해당 동작의 테스트, 로그, screenshot 등 실제 파일이어야 하며 contracts evidence에 포함됩니다.

## 3. 사용자 기능 → targeted E2E + 영상 + draft PR

```text
/spec-to-pr /absolute/path/to/app
mode: feature
changeKind: feature
저장 주소 선택 기능을 구현해줘.
이 기능을 고르는 test path/tag/project로 E2E 하나만 실행하고,
.webm 또는 .mp4 영상은 정확히 하나만 기록해서 draft PR에 링크해줘.
프로젝트 전체 E2E는 실행하지 마.
```

Feature evidence에는 selector를 실제 인자로 쓰고 `--list`/`--pass-with-no-tests`를 쓰지 않는 단일 Playwright command, `status: passed`·정확한 selector·같은 `implementationContextId`·양수 `testCount`만 담은 strict JSON 결과, 재생 시간이 0보다 큰 구조적으로 유효한 WebM/MP4 video path가 필요합니다. 명령 체이닝, 전체 E2E, 이름만 영상인 파일, 영상 0개/2개 이상은 거부됩니다.

## 4. Figma URL → 디자인 구현

```text
/spec-to-pr /absolute/path/to/app
mode: figma
changeKind: design
figmaUrl: https://www.figma.com/file/AbCdEf123/checkout?node-id=12-345
호스트에 연결된 Figma 기능으로 실제 node, screenshot, variable,
asset, component context를 가능한 범위에서 읽고 구현해줘.
provider: host-connected-figma, capturedAt, fileUrl, nodeIds, manifestPath와
strict manifest에 나열한 실제 PNG visualPaths를 project-local figma-bundle 한 번으로 제출해.
URL만 근거로 주장하거나 Figma를 polling하지 마.
```

Figma 모드는 디자인 구현까지만 끝낼 수 있습니다. draft PR도 원하면 마지막에 `publication: draft` 또는 “draft PR로 발행”을 추가하세요.

## 5. API가 있는 UI

```text
/spec-to-pr /absolute/path/to/app
mode: brief
briefPath: docs/profile.md
OpenAPI: docs/openapi.yaml
물리적으로 서로 다른 비어 있지 않은 API type/schema/wrapper/mock 파일과 status: passed인
contract-test JSON, 안정적인 implementationContextId를 먼저 api-ready로 제출하고,
같은 구현 context에서 mock 기반 UI를 검증한 뒤 draft PR로 발행해줘.
```

API와 UI를 별도 구현 agent로 나누지 않습니다. `apiArtifacts`와 `implementationContextId`가 있는 `kind: api-ready` 제출이 UI 완료 증거보다 먼저이며 최종 구현은 같은 context ID를 반복합니다. Path, symlink, hard link alias는 별도 API 증거가 아니며 Boolean만으로 대체할 수 없습니다.

## 6. 발행하지 않기

```text
/spec-to-pr /absolute/path/to/app
mode: legacy
이 변경은 구현과 독립 리뷰 evidence까지만 만들고 publication은 none으로 해줘.
```

`publication: none`은 publish stage를 건너뜁니다. 어떤 경우에도 publish가 merge/approve/ready 전환까지 수행하지는 않습니다.

## 7. 중단된 Run 재개

```text
이전에 받은 runId의 workflow_status를 읽고, blocker가 해소됐다면 이어서 진행해줘.
이미 승인된 stage는 반복하지 마.
```

각 stage는 durable checkpoint와 lease를 사용합니다. 재개는 public `workflow_status`와 `workflow_advance`로 처리하며 내부 microtool을 호출하지 않습니다.

## 8. 머지 후 명시적 archive

```text
/spec-to-pr:archive-openspec
draft PR #123이 실제로 merge된 것을 host evidence로 확인한 뒤 이 run을 archive해줘.
```

브랜치 push나 closed 상태만으로 merge를 추측하지 않습니다. Runtime은 PR 상태를 polling하지 않습니다.
