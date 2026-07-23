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

## 현재 릴리스

SpecToPR은 MCP 도구 7개, 실행 상태를 보존하는 단계 8개, 스킬 8개, 서로 독립된 검토자 2명으로 구성됩니다. 엄격한 UI 작업 방식은 `brief`, `legacy`, `feature`, `figma` 네 가지입니다.

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

레거시 분석은 선택한 기능 범위를 벗어나지 않으며, 해당 코드가 직접 가져오거나 참조하는 설정만 따라갑니다. 실제 HTTP 요청은 API 근거로 사용하지만 생성자와 로컬 파사드는 별도 API 항목으로 중복 등록하지 않습니다.

코드가 참조한 `.env*`의 URL 설정은 사용자 정보·쿼리·해시를 제거해 안전하게 정리합니다. 환경변수 이름·원본 주소·HTTP 클라이언트 호출 위치는 `legacyInventory`에 남깁니다. 정적 분석과 제공된 OpenAPI만으로 메서드와 경로를 하나로 확정할 수 없을 때만 `collect-legacy-network-evidence`를 요청합니다. 이때 범위를 좁힌 HAR을 제출하면 새 실행을 만들지 않고 이어서 진행합니다.

레거시 이관의 검토 자료는 기능별로 `.spec-to-pr/<feature>/`에 모입니다. 계약, 검증 자료, 레거시와 현재 화면을 나란히 보여 주는 비교 자료, 검토 보고서, 무결성을 확인하는 `manifest.json`이 한곳에 들어갑니다. 요구사항 변경 내용은 `openspec/changes/`에 제안서, 변경 명세, 작업 목록으로도 남습니다. 자세한 구조와 발행 규칙은 [레거시 이관 가이드](https://dhyun2.github.io/spec-to-pr/usage/legacy)에서 확인할 수 있습니다.

화면은 `visualTargets`와 `compare-visuals`로 비교하며 실행 시점 기준 98% 이상의 일치율을 요구합니다. 중단된 실행은 로컬 진단 보고서를 남기고, 문제가 해결되면 기존 초안 PR을 갱신할 수 있습니다. 차단 사유와 재개 방법은 [문제 해결 가이드](https://dhyun2.github.io/spec-to-pr/troubleshooting)에 정리되어 있습니다.

## 가이드

**https://dhyun2.github.io/spec-to-pr/**
