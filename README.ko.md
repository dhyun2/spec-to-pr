# SpecToPR

기획서, 레거시 프로젝트, 기능 요청 또는 Figma 디자인을 검증 증거가 포함된 draft PR까지 연결합니다.

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

| 케이스                       | 준비할 것                               | 결과                                                          | 상세 가이드                                                     |
| ---------------------------- | --------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------- |
| 모든 프로세스 개발           | 기획서/PDF/MD, Figma URL, OpenAPI       | API/UI 구현, 화면 비교, API gap, Web Vitals가 포함된 draft PR | [기획서 → PR](https://dhyun2.github.io/spec-to-pr/usage/brief)  |
| 레거시 프로젝트 마이그레이션 | 대상 저장소와 별도 레거시 프로젝트 경로 | 실행한 레거시 기준 마이그레이션, 화면 비교가 포함된 draft PR  | [레거시 → PR](https://dhyun2.github.io/spec-to-pr/usage/legacy) |
| 기능 개발                    | 한 기능의 기획서, Figma, API 자료       | 전체 검증, 해당 기능 E2E, 영상 1개가 포함된 draft PR          | [기능 → PR](https://dhyun2.github.io/spec-to-pr/usage/feature)  |
| Figma 디자인 구현            | Figma URL과 대상 저장소                 | mock 기반 UI, 수치화된 Figma 비교가 포함된 draft PR           | [Figma → PR](https://dhyun2.github.io/spec-to-pr/usage/figma)   |

모든 요청은 대상 프로젝트 경로로 시작합니다.

```text
/spec-to-pr /absolute/path/to/project
```

이후 해당 케이스 가이드의 프롬프트를 복사해 사용하세요. 필수 입력, 진행 과정, 검증 증거, blocker 처리와 예상 draft PR까지 케이스별로 설명되어 있습니다.

## 현재 릴리스

SpecToPR은 7 MCP tools, 8 durable stages, 8 skills, 2 independent reviewers로 구성됩니다. 엄격한 UI 모드는 `brief`, `legacy`, `feature`, `figma` 네 가지입니다.

조합 가능한 intake 필드는 `briefPath`, `figmaUrl`, `docsPaths`, `openApiPaths`, `openApiUrls`, `guidancePaths`, `skillHints`입니다.

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

레거시 intake는 선택한 기능 경계를 유지하면서 직접 import/configuration edge만 따라갑니다. 실제 HTTP terminal call은 API 근거로 사용하지만 생성자와 로컬 facade는 operation으로 중복 등록하지 않습니다. 환경 origin과 transport callsite는 `legacyInventory`에 보존됩니다. 정말 동적인 호출만 `collect-legacy-network-evidence` 액션을 내보내며, 제한된 HAR을 같은 Run에 제출해 새 시작 없이 재개할 수 있습니다.

상태에는 `requiredValidations`, `resumeContext`, `blockerDetails`가 포함됩니다. 보고서는 `pr-report-v2`, 화면 비교는 `visualTargets`와 `compare-visuals`를 사용하고 런타임 계산 일치율 98% 이상을 요구합니다. 중단된 draft Run은 `intent: blocked-diagnostic`으로 local blocked report를 만들고 같은 draft PR을 갱신할 수 있습니다. 대표적인 로컬 blocker는 `PUBLISH_NO_DELTA`, `BROWSER_NOT_RUN`입니다.

## 가이드

**https://dhyun2.github.io/spec-to-pr/**
