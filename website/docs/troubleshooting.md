---
sidebar_position: 10
title: 문제 해결
---

## 화면 일치율이 나오지 않아요

기준 이미지와 구현 이미지의 크기, 경로, 상태, 데이터가 같은지 확인합니다. 기준 화면 자체가 없다면 숫자를 만들지 말고 `화면 기준 없음` Gap을 남깁니다.

## 이미지는 저장됐는데 PR에서 보이지 않아요

로컬 경로만 PR에 쓰면 리뷰어는 이미지를 볼 수 없습니다. `baseline`, `actual`, `diff`, manifest를 `spec-to-pr-evidence/<change>/` 아래에 저장하고 stage·commit·push합니다. Legacy라면 `legacy-visual-evidence.cjs`를 `git add` 뒤에 실행해 생성한 Markdown을 PR에 넣습니다. 이 도구가 기준·이관 결과·Diff의 GitHub/GitLab raw URL을 만듭니다.

## 왜 Browser/Playwright가 Computer Use보다 먼저 쓰였나요?

legacy 기본은 Computer Use입니다. 현재 호스트에 Computer Use capability가 없거나 필요한 PNG를 만들 수 없을 때만 Browser/Playwright를 fallback으로 씁니다. fallback은 숨기지 않고 `legacy-visual-manifest.json`과 PR 좌우 이미지 비교 위에 provider·인증 상태·사유를 기록합니다. 같은 조건의 PNG와 기능 검증이 있으면 fallback 자체는 Gap이 아니며, provider 기록이나 사유가 빠졌을 때만 Gap입니다. 쿠키·토큰 값은 증빙에 기록하지 않습니다.

## 레거시 기본 화면만 통과했어요

그 결과는 전체 이관 검증이 아닙니다. 레거시 router와 실제 흐름에서 모든 사용자 노출 `route · state`를 인벤토리로 만들고, 각각 비교하거나 사유·영향·리뷰어 결정을 갖춘 제외를 기록합니다. 누락된 항목이 하나라도 있으면 Draft는 `NOT VERIFIED`입니다.

## Vue 3 이관 후 디자인이 달라졌어요

명시적 재디자인 승인이 없는 legacy 이관에서는 디자인 시스템을 적용하면 안 됩니다. 레거시 template/class, CSS, sprite·자산, 컨트롤은 보존하지만 script·state·router·utility는 대상 Vue 3 규격으로 변환합니다. 먼저 `legacy-source-inventory.cjs`로 supporting import, asset/selector/breakpoint/지도 SDK를 추출하고 `legacy-visual-manifest.json`의 `preserve-legacy` mapping으로 1:1 연결합니다. `@frontend/ui`, Unicode glyph/emoji, 문자·CSS 아이콘, mock map/placeholder 또는 대상 규격에 어긋난 Options API·mixin·Vuex 호환층이 발견되면 Gap으로 표시됩니다.

## 픽셀은 같은데 기능이 동작하지 않아요

schema v4의 `routeChecks`에서 레거시 화면/read API로 얻은 실제 동적 파라미터, 최종 URL, 핵심 UI, 필요한 API·인증 결과, 관련 console/network 오류를 기록합니다. 전체 E2E나 영상은 필요 없지만 연결된 화면의 대표 클릭·선택 전환은 한 건 이상 확인합니다. 예상 밖 빈 화면·loading·오류, `0`/`test`/`today` 같은 임의 fixture, 비-2xx/CORS는 이미지가 100% 같아도 `NOT VERIFIED`입니다.

## glab fallback으로 MR은 만들었는데 플러그인 발행은 실패했어요

fallback 성공만 PR에 쓰면 안 됩니다. manifest `publishing.plugin`에 TLS·인증·권한 같은 원인을, `publishing.draft`에 `glab`/`gh` method와 Draft URL을 기록한 뒤 PR section을 다시 생성합니다. 플러그인 실패는 발행 Gap으로 보이고, fallback 성공은 별도 결과로 보여야 합니다.

## 일치율이 92%보다 낮아요

Diff 이미지를 보고 차이가 큰 영역부터 수정한 뒤, 같은 조건으로 다시 캡처해 비교합니다. 최초 비교를 포함해 최대 3회까지 유효한 숫자 비교를 합니다. 세 번째도 92% 미만이면 더 시도하지 않고 마지막 점수와 1·2·3차 Diff를 Gap에 남깁니다.

## API 정보를 알 수 없어요

기획서·OpenAPI·레거시의 실제 호출·기존 API 클라이언트를 확인합니다. 그래도 method나 path를 확정할 수 없다면 추측하지 말고 Gap으로 기록합니다.

## brief 또는 feature의 자료와 OpenSpec이 맞지 않아요

기획서 또는 기능 요청·API 문서·Figma 중 어느 자료에 어떤 사실이 있는지 먼저 표시합니다. 자료에 있으나 OpenSpec에 빠졌다면 OpenSpec을 보완하고 다시 대조합니다. 자료끼리 충돌하거나 필요한 정보가 없다면 임의로 정하지 않고 OpenSpec의 미확정 항목과 PR Gap에 영향·다음 작업을 남깁니다.

## test: on인데 TDD를 할 수 없어요

먼저 대상 프로젝트의 기존 테스트 명령과 OpenSpec의 확정 수용 시나리오를 확인합니다. 실패 테스트를 먼저 만들 수 있는 범위가 아니거나 테스트 도구가 없으면 새 도구를 억지로 설치하지 않습니다. TDD를 했다고 쓰지 말고, 이유·영향·다음 작업을 Gap에 남깁니다. `test: off` 또는 생략이면 단위·통합 테스트를 만들거나 실행하지 않습니다.

## 단일 기능 E2E나 영상을 남길 수 없어요

변경 기능만 고르는 기존 E2E 명령을 먼저 찾습니다. 전체 프로젝트 E2E로 바꾸거나 영상을 여러 개 만들지 않습니다. 프로젝트에 실행 도구가 없거나 환경 때문에 실패했다면 실패 이유·영향·다음 작업을 Gap에 남기고 Draft PR에는 현재 구현 내용을 정직하게 기록합니다.

## 레거시 프로젝트를 수정하라고 해요

레거시 경로는 읽기 전용입니다. 대상 프로젝트 경로가 맞는지 다시 확인하고, 레거시에는 변경을 만들지 않습니다.

## GitLab Draft MR 사전 진단이 막혀요

`remote → glab → 인증 → 프로젝트 → 권한 → MR API` 순서 중 막힌 지점이 결과 JSON의 `checks`에 표시됩니다. 해결 순서는 [GitLab MR 사전 진단](./getting-started/gitlab)에서 확인하세요. 사전 진단은 GET 요청만 사용하므로 실제 MR을 만들지는 않습니다. GitLab에는 Draft MR 생성 dry-run이 없어 마지막 `glab mr create --draft` 또는 기존 Draft 갱신 성공이 최종 확인입니다.

## 작업이 중단됐어요

다시 실행하면 현재 작업 트리의 `git diff`를 읽고 이어갑니다. 별도의 작업 ID나 재개 명령은 필요하지 않습니다.
