# SpecToPR

기획서, 레거시 프로젝트, 기능 요청, Figma 디자인을 바탕으로 구현부터 검증 자료가 담긴 초안 PR 발행까지 진행합니다.

[English](README.md) · [전체 가이드](https://dhyun2.github.io/spec-to-pr/) · [내 케이스 고르기](https://dhyun2.github.io/spec-to-pr/usage/)

## 설치

Node.js 22+, Git, Claude Code 또는 Codex가 필요합니다.

### Claude Code

```text
/plugin marketplace add dhyun2/spec-to-pr
/plugin install spec-to-pr@spec-to-pr
```

### Codex

```bash
codex plugin marketplace add https://github.com/dhyun2/spec-to-pr --ref main
codex plugin add spec-to-pr@spec-to-pr
```

설치 후 호스트를 다시 열고 새 작업에서 설치 상태를 확인합니다.

```text
/spec-to-pr:doctor
```

[전체 설치 가이드 보기](https://dhyun2.github.io/spec-to-pr/getting-started/installation)

## 네 가지 사용법

| 사용 방식                                                            | 필요한 자료                             | 결과                                                         |
| -------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------ |
| [기획서 기반 개발](https://dhyun2.github.io/spec-to-pr/usage/brief)  | 기획서/PDF/MD, Figma URL, OpenAPI       | API·UI 구현, 화면 비교, API 차이, Web Vitals가 담긴 초안 PR  |
| [레거시 이관](https://dhyun2.github.io/spec-to-pr/usage/legacy)      | 대상 저장소와 별도 레거시 프로젝트 경로 | 실행 중인 레거시를 기준으로 이관하고 화면을 비교한 초안 PR   |
| [단일 기능 개발](https://dhyun2.github.io/spec-to-pr/usage/feature)  | 한 기능의 기획서, Figma, API 자료       | 전체 검증, 해당 기능 E2E, 영상 1개가 담긴 초안 PR            |
| [Figma 디자인 구현](https://dhyun2.github.io/spec-to-pr/usage/figma) | Figma URL과 대상 저장소                 | 모의 데이터 기반 UI와 수치로 확인한 화면 비교가 담긴 초안 PR |

모든 요청은 대상 프로젝트의 절대 경로로 시작합니다.

```text
/spec-to-pr /absolute/path/to/project
```

그다음 사용 방식에 맞는 가이드의 프롬프트를 복사해 사용하세요. 각 가이드에는 필수 입력, 진행 과정, 검증 자료, 중단 시 해결 방법, 초안 PR 예시가 정리되어 있습니다.

## 현재 릴리스 (1.0.0)

SpecToPR은 MCP 도구 7개, 실행 상태를 보존하는 단계 8개, 스킬 8개, 서로 독립된 검토자 2명으로 구성됩니다. 리뷰어용 Draft PR 템플릿은 `legacy-migration`, `brief-delivery`, `feature-flow`, `figma-ui` 네 가지입니다.

시작할 때 `briefPath`, `figmaUrl`, `docsPaths`, `openApiPaths`, `openApiUrls`, `guidancePaths`, `skillHints`를 필요한 만큼 조합할 수 있습니다.

```yaml
mode: feature
briefPath: docs/checkout.md
figmaUrl: https://www.figma.com/design/FILE/checkout?node-id=12-345
docsPaths: []
openApiPaths:
  - docs/openapi.yaml
guidancePaths: []
skillHints: []
```

레거시 분석은 사용자가 지정한 정확한 기능 경계 안에서만 진행하고, 이해에 필요한 직접 import·설정 참조만 따라갑니다. 저장소 밖의 `legacyProjectRoot`도 명시했다면 읽기 전용으로 허용합니다. API·인증·인증서·동적 요청이 불명확하면 Gap으로 남깁니다. 확인된 UI·경로·상태·타입·읽기 동작은 계속 구현하되, 확정하지 못한 쓰기 동작을 추측해서 연결하지 않습니다.

UI 범위는 언제나 런타임 화면 비교를 시도합니다. 비교가 실패하거나 기준 화면을 얻지 못하면 병합을 막는 Gap으로 보이지만, 이미 구현한 작업을 숨기거나 Draft PR 발행을 막지는 않습니다. `feature-flow`에는 현재 review packet에 묶인 사용자 흐름 영상도 필수입니다. OpenSpec은 병합 후 선택적으로 연동할 수 있을 뿐, 구현과 Draft PR의 전제 조건이 아닙니다.

PR 본문은 짧고 리뷰 중심으로 만듭니다. 상태 아래에 Gap의 영향과 리뷰어 판단을 먼저 보이고, 변경 내용·화면 비교·필요한 경우 Feature 영상·검증 결과만 보여 줍니다. Run ID, 원시 로그, 내부 스키마/해시, 빈 체크리스트는 기본 본문에서 제외합니다.

모델 라우팅은 역할과 호스트를 분리합니다. core는 `fast`·`build`·`expert`만 판단하고, Codex는 Luna/Terra/Sol, Claude는 Haiku/Sonnet/Opus으로 매핑합니다. 기본은 `adaptive-verified`이며, `pinned`는 사용자가 고른 한 모델을 모든 단계와 독립 리뷰에 유지하고 `custom`은 세 역할 모델을 모두 직접 지정합니다. 한 Run에서 두 호스트를 자동으로 섞지 않으며, 상위 모델을 쓸 수 없으면 검증을 몰래 약화하지 않고 품질 Gap으로 남깁니다.

GitHub·GitLab 인증, TLS, 호스트 접근 문제로 게시할 수 없으면 로컬 진단 보고서와 publication Gap을 남깁니다. 문제가 해결된 뒤에는 새 Run을 만들지 않고 같은 Draft PR을 갱신합니다.

## 가이드

**https://dhyun2.github.io/spec-to-pr/**
