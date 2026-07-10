---
sidebar_position: 4
title: 옵션과 정책
---

# 옵션과 정책

프롬프트에 자연어로 적으면 파싱되어 Run 전체에 적용되는 정책들입니다.

## 프롬프트는 실제로 이렇게 파싱된다 {#prompt-parsing}

"파싱된다"가 무슨 뜻인지 실물로 봅시다. 이런 프롬프트를 넣으면:

```text
/spec-to-pr ./apps/web docs/brief.md
Figma: https://www.figma.com/design/AbC123/checkout?node-id=12-345
target은 develop. 접근성 게이트는 스킵하고, 테스트는 pnpm test:unit 으로 돌려줘.
디자인 시스템 컴포넌트만 사용해줘.
```

`parse_intake_request` tool이 `ParsedIntakeRequest` 구조로 변환해 **아티팩트로 기록**합니다:

```json title="파싱 결과 (요약)"
{
  "figmaUrls": ["https://www.figma.com/design/AbC123/checkout?node-id=12-345"],
  "filePaths": ["docs/brief.md"],
  "branchPolicy": { "targetBranch": "develop" },
  "gatePolicy": { "accessibility": false },
  "validationCommands": ["pnpm test:unit"],
  "constraints": ["디자인 시스템 컴포넌트만 사용해줘."],
  "urls": [],
  "ticketUrls": [],
  "inlineOpenApiBlocks": []
}
```

두 가지가 중요합니다:

1. **원문과 파싱 결과가 둘 다 저장됩니다** — 나중에 "왜 접근성 게이트가 빠졌지?"라고 물으면 이 아티팩트가 답입니다.
2. **표에 없는 자연어는 `constraints`로 들어가** 모든 에이전트의 context pack에 전달됩니다. 버려지는 문장이 없습니다.

아래는 정책별 상세입니다.

## 브랜치 정책

| 정책          | 기본값    | 프롬프트 예                          |
| ------------- | --------- | ------------------------------------ |
| source 브랜치 | 현재 HEAD | "feature/checkout 기준으로 시작해줘" |
| target 브랜치 | `main`    | "target은 develop"                   |

에이전트 lane들은 source 기준으로 만든 격리 worktree에서 작업하고, 통합 브랜치는 `spec-to-pr/<runId 축약>/integration` 이름으로 생성됩니다.

## 발행(publish) 정책

| 정책      | 기본값  | 프롬프트 예                           |
| --------- | ------- | ------------------------------------- |
| 발행 여부 | 발행함  | "PR은 만들지 말고 브랜치까지만"       |
| 모드      | `draft` | draft 고정 권장 — ready 전환은 사람이 |

:::warning 발행이 차단되는 경우
스코어카드 판정이 `blocked`이면 새 PR/MR은 발행되지 않습니다. 이미 열려 있는 draft가 있으면 본문에 blocked 사유만 업데이트됩니다.
:::

## 게이트 정책

기본은 전부 켜짐. 개별적으로 끌 수 있습니다.

| 게이트            | 담당 태스크                                        | 끄는 프롬프트 예              |
| ----------------- | -------------------------------------------------- | ----------------------------- |
| OpenSpec 추적성   | [T14](/tasks/14-openspec-change-generator)         | "openspec 게이트 스킵"        |
| 보안 정책         | [T05](/tasks/05-security-and-policy-baseline)      | "보안 게이트 스킵"            |
| 접근성            | [T27](/tasks/27-accessibility-gate)                | "접근성 게이트는 이번엔 빼줘" |
| 성능 · Web Vitals | [T28](/tasks/28-performance-and-web-vitals)        | "성능 게이트 스킵"            |
| 관측성            | [T29](/tasks/29-opentelemetry-and-log-correlation) | "observability는 스킵"        |

lint · typecheck · build · 자동화 테스트로 구성된 **품질 게이트(T25)는 끌 수 없습니다** — 증거 우선 원칙의 최소선입니다.

## 시각 회귀 정책

| 항목                | 기본값                    | 조정                                                   |
| ------------------- | ------------------------- | ------------------------------------------------------ |
| baseline            | Figma 스크린샷            | `visualBaseline: legacy-screenshot` (레거시 화면 기준) |
| 최소 점수           | `0.98` (reviewMatchRatio) | "visual 최소 점수 0.95로"                              |
| 수리 루프 최대 횟수 | `3`                       | "repair는 최대 5번까지"                                |
| 미리보기 포함       | Figma + 브라우저 + diff   | "diff 이미지는 PR에서 빼줘"                            |

## 검증 커맨드 오버라이드

프로젝트 프로파일러가 `package.json`에서 테스트/빌드 커맨드를 자동 감지하지만, 직접 지정할 수 있습니다.

```text
테스트는 pnpm test:unit 과 pnpm test:e2e 로, 빌드는 pnpm build:web 으로 돌려줘.
```

## 아카이브 정책

머지 후 OpenSpec 아카이브는 **자동 폴링하지 않습니다.** 사람이 머지를 확인하고 `/spec-to-pr:archive-openspec`을 직접 실행해야 합니다. "머지되면 알아서 아카이브해줘"라고 미리 허용해 두는 것도 가능합니다(archivePolicy).

## 자유 제약 (constraints)

위 표에 없는 요구는 자유 문장으로 적으면 제약으로 파싱되어 **모든 에이전트의 context pack에 전달**됩니다.

```text
- 디자인 시스템(@frontend/ui) 컴포넌트만 사용해줘. 커스텀 CSS 금지.
- API 래퍼는 기존 src/shared/api 패턴을 그대로 따라줘.
- i18n 키는 ko.json에 추가하고 하드코딩 문자열 금지.
```

환경변수 기반 설정(셀프호스트 GitHub, 데이터 디렉터리 등)은 [설정 · 환경변수](/reference/config)에 있습니다.
