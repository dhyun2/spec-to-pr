---
name: spec-to-pr
description: Use when turning a brief, one feature, a Figma design, or a separate legacy project into a Korean draft pull request.
---

# SpecToPR Lite

SpecToPR는 네 가지 개발 요청을 **한 번 실행해서** 한국어 Draft PR로 정리하는 스킬입니다. 작업 상태 저장, 상태 머신, 재개, 별도 리뷰어, MCP 도구를 사용하지 않습니다.

## 입력

다음 세 가지를 먼저 확인합니다.

1. `case`: `brief`, `feature`, `figma`, `legacy` 중 하나
2. 대상 프로젝트의 절대 경로
3. 구현 요청

`brief`에는 기획서 경로가 필요합니다. API 문서 경로와 Figma URL은 제공되면 함께 사용합니다. `figma`에는 Figma URL, `legacy`에는 별도 레거시 프로젝트 경로가 필요합니다. `feature`는 요청만으로 시작할 수 있습니다. 대상 브랜치를 받지 않으면 저장소 기본 브랜치를 사용합니다.

`brief`와 `feature`에는 선택적으로 `test: on | off`를 받습니다. 생략하면 `off`입니다. `on`은 OpenSpec의 요구사항·수용 시나리오를 테스트로 먼저 쓰는 TDD이고, `off`는 이 작업을 위한 단위·통합 테스트를 새로 만들거나 실행하지 않는다는 뜻입니다. `figma`와 `legacy`에는 OpenSpec·TDD 모드를 적용하지 않습니다.

케이스의 세부 규칙은 [references/cases.md](references/cases.md)를 읽습니다. 네 케이스를 섞거나 새 workflow를 만들지 않습니다.

## 실행 순서

1. 대상 저장소·현재 브랜치·remote를 확인합니다. 대상 프로젝트 밖은 수정하지 않습니다. `legacy`의 레거시 프로젝트는 읽기 전용입니다. GitLab remote라면 구현을 시작하기 전에 이 스킬 디렉터리의 `scripts/check-gitlab-mr.cjs`를 절대 경로로 찾아 읽기 전용 사전 진단을 실행합니다.

   ```bash
   node /absolute/path/to/check-gitlab-mr.cjs \
     --project-root /absolute/path/to/project \
     --remote origin
   ```

   결과 JSON의 `status`가 `blocked`이면 코드·문서·브랜치를 수정하지 않고 `nextSteps`와 [GitLab MR 사전 진단 가이드](https://dhyun2.github.io/spec-to-pr/getting-started/gitlab)를 안내합니다. `not-applicable`이면 GitHub remote로 판단한 것이므로 GitHub PR 흐름을 사용합니다. `ready-to-attempt`는 `glab`, 인증, 프로젝트·MR API의 GET 접근과 알려진 Developer 이상 권한을 확인했다는 뜻입니다. GitLab에는 Draft MR 생성 dry-run이 없으므로 생성 성공을 보장한다고 쓰지 않습니다.

2. 선택한 케이스의 자료만 읽고, 대상 프로젝트 지침과 기존 구조를 확인합니다. `brief`와 `feature`는 구현 전에 [references/openspec.md](references/openspec.md)를 읽고 OpenSpec 문서를 준비·대조합니다. `figma`와 `legacy`는 각각 Figma와 실행 중인 레거시를 직접 구현 기준으로 사용하며 OpenSpec을 만들지 않습니다.
3. UI 작업이면 설치된 사내 디자인 시스템과 대상 프로젝트의 기존 컴포넌트를 우선 사용합니다. 요청한 사용자 흐름에 포함된 화면·입력·선택·확인 결과까지 구현합니다. 관련 없는 화면이나 구조는 넓히지 않습니다.
4. `brief`와 `feature`의 `test` 값을 따릅니다. `test: on`이면 OpenSpec의 확정 요구사항과 수용 시나리오를 테스트 항목으로 옮기고, 관련 실패 테스트를 먼저 작성한 뒤 최소 구현으로 통과시키고 리팩터링합니다. 대상 프로젝트의 기존 테스트 도구만 사용합니다. 적절한 테스트 도구나 테스트 가능한 시나리오를 찾지 못하면 TDD를 했다고 쓰지 않고 Gap에 남깁니다. `test: off`이면 이 변경을 위한 단위·통합 테스트를 새로 만들거나 실행하지 않습니다. `feature`는 `test` 값과 별개로 변경 기능만 고르는 E2E를 한 번 실행하고, 그 사용자 흐름을 보여 주는 WebM 또는 MP4 영상 한 개를 남깁니다. 프로젝트의 기존 E2E 도구를 사용하며, 새 도구를 억지로 설치하거나 전체 프로젝트 E2E를 실행하지 않습니다.
5. UI 기준 이미지와 구현 이미지를 같은 경로·상태·데이터·화면 크기로 캡처합니다. Figma는 Figma 캡처, legacy는 실행 중인 레거시 화면을 기준으로 합니다.
6. 이 스킬 디렉터리의 `scripts/compare-images.cjs`를 절대 경로로 찾아 아래처럼 실행합니다.

   ```bash
   node /absolute/path/to/compare-images.cjs \
     --baseline spec-to-pr-evidence/<change>/baseline.png \
     --actual spec-to-pr-evidence/<change>/actual.png \
     --diff spec-to-pr-evidence/<change>/diff.png
   ```

   결과 JSON의 `matchPercent`를 PR에 사용합니다. 92% 이상이면 증빙을 기록하고 다음 단계로 갑니다. 92% 미만이면 Diff를 보고 구현을 고친 뒤, 같은 기준 이미지와 같은 캡처 조건으로 다시 비교합니다. **유효한 숫자 비교는 최초 비교를 포함해 최대 3회**입니다. 세 번째도 92% 미만이면 더 비교하지 않고 최종 점수·세 번의 Diff 경로·다음 작업을 Gap에 남깁니다. 캡처 실패나 이미지 크기 불일치는 유효 비교 횟수에 넣지 않으며, 이유를 Gap에 남깁니다. 기준 이미지를 바꾸거나 잘라 맞추기, mask, 임의 점수는 사용하지 않습니다.

7. 최종 `git diff`와 검증 결과를 기준으로 아래만 한국어로 정리합니다.

   - 실제로 개발한 사용자 기능
   - 실제 추가·변경한 API의 method, path, 목적
   - 화면별 비교 횟수, 일치율, 기준·구현·Diff 증빙 경로
   - `brief`·`feature`인 경우 `test` 값, `on`이면 OpenSpec 수용 시나리오와 연결한 TDD 테스트 명령·결과
   - `feature`인 경우 변경 기능 E2E 명령·결과와 사용자 흐름 영상 경로
   - 개발하지 못했거나 확인이 필요한 Gap, 영향, 다음 작업

8. [assets/pr-template.md](assets/pr-template.md)를 채워 PR 본문을 만듭니다. 비밀값, 토큰, 쿠키, 긴 내부 로그는 본문에 쓰지 않습니다. API가 없으면 `사용한 API 없음`, Gap이 없으면 `없음` 한 행을 넣습니다. `feature`일 때만 `E2E 영상` 섹션을 넣습니다.
9. 구현 코드와 `brief`·`feature`의 OpenSpec 문서, `spec-to-pr-evidence/<change>/`의 화면 증빙, 그리고 `feature`의 E2E 영상 한 개를 의도적으로 커밋합니다. 호스트의 GitHub/GitLab 도구 또는 `gh`/`glab`로 Draft PR을 만듭니다. 같은 소스 브랜치의 열린 Draft가 있으면 새로 만들지 말고 갱신합니다. GitLab은 실제 `glab mr create --draft` 또는 열린 Draft 갱신이 성공하고 MR URL을 확인해야 완료로 말합니다. 실패하면 성공한 것처럼 PR을 쓰지 말고 오류를 요약하고 위 가이드의 해결 절차를 안내합니다.

## 서브에이전트 사용

서브에이전트는 필수 단계가 아닙니다. 호스트가 지원하고 기획서·API 문서·Figma 자료가 넓거나 서로 충돌할 때만, 한 명의 읽기 전용 서브에이전트에게 자료와 OpenSpec 문서의 누락·충돌 검토를 맡길 수 있습니다. 구현·문서 수정·Git 작업은 주 작업자가 맡습니다. 작은 요청은 주 작업자가 직접 대조하며, 모델 라우팅·작업 상태·리뷰어 역할을 고정하거나 저장하지 않습니다.

## 중단과 실패

중단되면 다음 실행에서 현재 `git diff`를 다시 읽고 이어서 작업합니다. 플러그인은 Run을 저장하지 않습니다.

다음만 즉시 멈춥니다.

- 대상 저장소 또는 쓰기 경로를 안전하게 확인할 수 없음
- 레거시 프로젝트를 수정하려는 상황
- 새 브랜치·커밋을 만들 수 없음
- GitLab 사전 진단이 `blocked`이거나 실제 Draft MR 생성·갱신에 실패함

`test: on`의 TDD 미확보, 화면 불일치, API 미확인, `feature` E2E 또는 영상 미확보는 모두 Gap으로 남기고 Draft PR을 계속 준비합니다.
