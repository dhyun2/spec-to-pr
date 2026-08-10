---
name: spec-to-pr
description: Use when implementing a brief, feature, Figma UI, or an explicitly bounded legacy migration and preparing a Korean draft pull request with truthful visual evidence and Gaps.
---

# SpecToPR

SpecToPR는 `brief`, `feature`, `figma`, `legacy` 중 **하나**를 선택해 구현하고, 리뷰어가 바로 판단할 수 있는 한국어 Draft PR을 준비하는 스킬입니다. 실행 상태 저장·상태 머신·MCP 서버는 사용하지 않지만, UI 결과와 미확정 사항을 흐리지 않습니다.

## 변하지 않는 원칙

1. UI 작업은 케이스와 관계없이 화면 비교를 시도합니다. 기준 화면이 없거나 캡처가 불가능하면 점수를 꾸미지 않고 `화면 비교 불가` Gap으로 남깁니다.
2. API·binding·인증·증빙 분석의 실패는 안전하지 않은 쓰기를 시도해야 하는 경우가 아니면 구현을 멈추지 않습니다. 확인한 범위부터 개발하고 영향·다음 작업을 Open Gap으로 남깁니다.
3. `skipped`, `waived`, `not run`은 `passed`가 아닙니다. Draft PR은 Gap이나 화면 미달이 있어도 만들 수 있지만, 이때 `VERIFIED` 또는 merge-ready라고 쓰지 않습니다.
4. 사용자가 준 `legacyProjectRoot`와 `targetPaths`를 정확히 사용합니다. 이름이 비슷한 폴더·라우트로 범위를 추론하거나 넓히지 않습니다.
5. OpenSpec은 사용자가 준비해야 하는 전제 조건이 아닙니다. `brief`·`feature`는 저장소에 OpenSpec 규칙이 있거나 변경 문서가 유용할 때만 에이전트가 스스로 준비하며, 누락·충돌은 구현을 막지 않고 Gap으로 남깁니다.

## 입력

먼저 `case`, 대상 프로젝트 절대 경로, 구현 요청을 확인합니다.

```yaml
case: brief | feature | figma | legacy
projectRoot: /absolute/path/to/project
request: 구현할 사용자 기능
targetBranch: main # 선택
```

- `brief`: `briefPath`가 필요합니다.
- `figma`: Figma URL이 필요합니다.
- `legacy`: `legacyProjectRoot`와 **정확한** `targetPaths`가 필요합니다.
- `feature`: 요청만으로 시작할 수 있습니다.

`brief`와 `feature`는 `test: on | off`를 선택할 수 있고 기본은 `off`입니다. `test: on`은 확정 수용 시나리오를 실패 테스트로 먼저 쓰는 TDD이며, 기존 도구가 없거나 시나리오를 테스트할 수 없으면 Gap으로 남깁니다. `feature`는 test 값과 별개로 변경 기능만 고르는 E2E를 실행하고 사용자 흐름 영상 한 개를 남깁니다. 케이스별 규칙은 [references/cases.md](references/cases.md), 모델 선택 규칙은 [references/model-routing.md](references/model-routing.md)를 읽습니다.

## 실행 순서

1. 대상 저장소·현재 브랜치·remote를 읽습니다. `legacy`라면 `legacyProjectRoot`, `targetPaths`를 요청값과 한 글자씩 대조하고, 레거시 프로젝트는 읽기 전용으로 고정합니다. 일치하지 않으면 코드를 수정하기 전에 범위 차이를 보고합니다.
2. GitLab remote면 `scripts/check-gitlab-mr.cjs`로 읽기 전용 사전 진단을 합니다. 인증·권한·TLS·MR API 실패는 **발행 Gap**입니다. 구현은 계속하되, 안전하지 않은 쓰기나 실제 Draft 발행은 준비가 될 때만 시도합니다.
3. 제공 자료와 대상 프로젝트의 기존 구조를 읽습니다. `brief`·`feature`의 OpenSpec은 에이전트가 만들 수 있는 보조 산출물이며, 없다는 이유로 core 구현을 멈추지 않습니다.
4. UI를 구현합니다.
   - `brief`, `feature`, `figma`: 대상 프로젝트의 디자인 시스템과 기존 컴포넌트를 우선 사용합니다.
   - `legacy`: 기본 전략은 **보존 이관**입니다. 레거시 템플릿·클래스·CSS·자산·스프라이트·컨트롤·사용자 동작을 최대한 그대로 가져오고 Vue 3 문법·진입점·대상 앱 연결만 변환합니다. `@frontend/ui` 등 디자인 시스템으로 대체하거나 UI를 재구성하지 않습니다. Unicode glyph/emoji, 문자·CSS로 그린 로고·핀·아이콘, 지도·carousel의 placeholder/mock 대체도 금지합니다. 사용자가 명시적으로 재디자인을 승인한 경우만 승인 문구를 증빙에 기록합니다.
5. API·binding·로그인·런타임 증빙이 불명확하면 확인한 호출만 연결합니다. POST/PATCH/DELETE를 추측해 쓰지 않고, 해당 동작을 Open Gap으로 남깁니다. 이 실패를 이유로 페이지·컴포넌트·확인된 GET 연결·상태 구조·화면 비교 준비를 중단하지 않습니다.
6. `legacy`는 화면 캡처 전에 source inventory를 읽기 전용으로 생성합니다. 이 inventory는 레거시 router, 이미지·sprite·font URL, CSS selector, media breakpoint, 지도 SDK·carousel·native bridge 표식을 뽑습니다.

   ```bash
   node /absolute/path/to/legacy-source-inventory.cjs \
     --legacy-root /absolute/path/to/legacy-project \
     --source-paths src/modules/<feature> \
     --output /absolute/path/to/project/spec-to-pr-evidence/<change>/legacy-source-inventory.json
   ```

   manifest는 inventory의 모든 route를 화면 매트릭스에, 모든 asset·selector·breakpoint·runtime 표식을 1:1 mapping에 넣어야 합니다. 원본 asset은 대상 파일 또는 canonical URL로 매핑하고, selector와 breakpoint는 대상 CSS에 실제로 존재해야 합니다. 실제 Kakao Map·Swiper·bridge를 회색 박스나 CSS로 대체하면 안 됩니다.

7. 화면을 캡처하고 비교합니다.
   - 기준·구현 이미지는 같은 route, UI state, fixture, viewport, DPR, 인증 상태에서 캡처합니다.
   - `legacy`는 [레거시 화면 매트릭스](references/cases.md#legacy)를 먼저 만들고, 레거시 라우터에서 발견한 **모든 사용자 노출 route·대표 상태**를 하나씩 비교하거나 명시적으로 제외합니다. 기본 화면 하나만 비교해 전체 이관을 통과 처리하면 안 됩니다.
   - 이미지는 `spec-to-pr-evidence/<change>/`에 `baseline`, `actual`, `diff`로 저장합니다. 비교 결과는 최대 3회까지 시도하며 92% 미만·캡처 실패·미실행은 Gap입니다.
   - 빈 영역이 점수를 부풀리지 않도록 legacy target마다 검색·필터·목록·지도 컨트롤 같은 핵심 UI 영역을 하나 이상 지정해 전체 화면과 별도로 비교합니다.
8. `legacy`는 `spec-to-pr-evidence/<change>/legacy-visual-manifest.json`을 만들고 아래 도구로 검증합니다. 도구는 빠진 화면, source asset/CSS/runtime mapping, 금지된 glyph·placeholder, 비교 이미지의 Git index 누락을 숨기지 않고 `NOT VERIFIED`와 Gap을 만듭니다.

   ```bash
   node /absolute/path/to/legacy-visual-evidence.cjs \
     --manifest /absolute/path/to/project/spec-to-pr-evidence/<change>/legacy-visual-manifest.json \
     --project-root /absolute/path/to/project \
     --repository-web-url https://gitlab.example.com/group/project \
     --source-ref codex/<branch> \
     --write-pr-section /absolute/path/to/project/spec-to-pr-evidence/<change>/legacy-pr-section.md
   ```

   이 명령은 `git add spec-to-pr-evidence/<change>/` 뒤에 실행합니다. 기준·이관·Diff를 PR 본문에 실제 이미지 링크로 넣으므로, 로컬 경로만 적거나 Diff 하나만 올리지 않습니다.

9. 구현과 증빙을 읽지 않은 새 컨텍스트에서 기능 검토하고, UI가 있으면 디자인·접근성 검토도 합니다. `passed` 판정만 검증 통과로 씁니다. 실패·미실행·모델/환경 부재는 Gap이며, 상위 모델을 쓸 수 없다고 이 검토를 생략하거나 통과로 바꾸지 않습니다.
10. 최종 `git diff`, 화면 증빙, 검증 결과를 바탕으로 **case 전용** PR 템플릿 하나를 채웁니다. 템플릿 선택 기준은 [assets/pr-templates/README.md](assets/pr-templates/README.md)입니다. 내부 실행 식별자·로그, 토큰·쿠키, 비어 있는 체크리스트, 중복 discovery 행은 PR 본문에 넣지 않습니다.
11. 구현 코드와 화면 증빙을 의도적으로 stage·commit·push한 뒤 Draft PR을 만듭니다. 플러그인 발행 API가 TLS·인증·권한 문제로 실패하고 `glab`/`gh` fallback이 성공한 경우에도, `publishing` 상태에 실패 원인·fallback 결과·Draft URL을 적고 PR 본문을 다시 갱신합니다. 실패를 숨기거나 기능/UI 검증 성공처럼 바꾸지 않습니다.

## 화면 비교 규칙

동일 크기의 PNG를 비교할 때는 번들 도구를 사용합니다.

```bash
node /absolute/path/to/compare-images.cjs \
  --baseline spec-to-pr-evidence/<change>/baseline/<state>.png \
  --actual spec-to-pr-evidence/<change>/actual/<state>-attempt-1.png \
  --diff spec-to-pr-evidence/<change>/diff/<state>-attempt-1.png
```

92% 이상이면 통과입니다. 92% 미만이면 같은 조건에서 구현을 보완해 다시 비교합니다. 유효 비교는 최초를 포함해 최대 3회이며, 세 번째도 92% 미만이면 더 비교하지 않고 마지막 결과를 Gap으로 남깁니다. 기준 이미지를 바꾸거나 잘라 맞추기, mask, 임의 점수는 금지합니다.

## 중단 기준

다음만 즉시 중단합니다.

- 대상 저장소 또는 쓰기 경로를 안전하게 확인할 수 없음
- legacy 프로젝트를 수정하려는 상황
- 위험한 쓰기 요청의 대상·권한·요청 body를 확인할 수 없음
- 새 브랜치·커밋을 만들 수 없음

화면 미달, API 미확인, binding·인증 분석 실패, 테스트 실패, 디자인 검토 미실행, GitLab 발행 인증 실패는 구현을 중단시키지 않습니다. 각각 영향과 다음 작업을 Gap으로 남기고, Draft의 검증 상태를 사실대로 표시합니다.
