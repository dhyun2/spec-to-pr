---
sidebar_position: 2
title: 설정 · CLI · 환경변수
---

# 설정 · CLI · 환경변수

## Delivery profile

| 필드          | 값                                                                  | 의미            |
| ------------- | ------------------------------------------------------------------- | --------------- |
| `mode`        | `auto`, `brief`, `legacy`, `feature`, `figma`                       | entry mode      |
| `changeKind`  | `auto`, `feature`, `fix`, `refactor`, `migration`, `design`, `docs` | 변경 성격       |
| `publication` | `draft`, `none`                                                     | draft 발행 여부 |
| `briefPath`   | project-relative path                                               | brief mode 필수 |
| `figmaUrl`    | URL                                                                 | figma mode 필수 |

`feature` mode가 UI scope일 때만 `targetedFeatureE2E`와 `featureVideo` requirement가 켜집니다. `legacy`는 focused baseline, `figma`는 `figma-bundle`이 contracts 통과 조건입니다.

## SDK runner CLI

```bash
node packages/codex-sdk/dist/cli.js \
  --cwd /path/to/app \
  --mode feature \
  --change-kind feature \
  --prompt "저장 주소 선택 기능 추가" \
  --publish
```

| Option                 | 설명                           |
| ---------------------- | ------------------------------ |
| `--cwd <path>`         | 대상 저장소, 필수              |
| `--prompt <text>`      | 변경 요청/제약                 |
| `--mode <mode>`        | delivery mode                  |
| `--change-kind <kind>` | 변경 분류                      |
| `--brief <path>`       | brief/spec 입력                |
| `--docs <path>`        | 보조 문서 입력                 |
| `--figma <url>`        | Figma file/node URL            |
| `--openapi <path>`     | OpenAPI 입력                   |
| `--publish`            | 준비되면 draft PR/MR 발행      |
| `--no-publish`         | 구현·리뷰 evidence까지만       |
| `--resume <task-id>`   | 기존 Codex task 재개           |
| `--model <model>`      | model override                 |
| `--no-review-agents`   | 독립 reviewer instruction 생략 |

Mode를 생략하면 Figma URL은 `figma`, brief path는 `brief`, 나머지는 `auto`로 분류됩니다. Figma는 기본적으로 구현까지만 진행하고 `--publish`가 있을 때 draft를 발행합니다. 다른 명시적 delivery mode는 `--no-publish`가 없으면 draft publication을 요청합니다.

## 환경변수

| 변수                                    | 기본/해석                       | 용도                               |
| --------------------------------------- | ------------------------------- | ---------------------------------- |
| `SPEC_TO_PR_DATA_DIR`                   | host plugin data 또는 temp 경로 | durable Run/evidence 저장 위치     |
| `GITHUB_TOKEN` / `GH_TOKEN`             | 없으면 `gh auth token`          | GitHub API 인증                    |
| `GITLAB_TOKEN` / `GITLAB_PRIVATE_TOKEN` | 없으면 `glab auth token`        | GitLab API 인증                    |
| `SPEC_TO_PR_GIT_HOST`                   | remote에서 감지                 | self-hosted GitHub/GitLab override |
| `SPEC_TO_PR_API_BASE_URL`               | host 기반 기본값                | self-hosted API endpoint           |
| `SPEC_TO_PR_WEB_BASE_URL`               | host 기반 기본값                | review request URL base            |

토큰이 없으면 required publish evidence를 만족할 수 없으므로 publication이 blocker를 보고합니다. 토큰 값을 로그나 report에 출력하지 않습니다.

## MCP server

Claude plugin의 local stdio 설정은 번들된 server를 실행합니다.

```json
{
  "mcpServers": {
    "spec_to_pr": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.js"],
      "env": {
        "SPEC_TO_PR_DATA_DIR": "${CLAUDE_PLUGIN_DATA}"
      }
    }
  }
}
```

Codex에서는 이름이 `mcp__spec_to_pr__*`로 정규화될 수 있습니다. 어느 호스트든 public tool은 동일한 7개이고 contract version은 `2.0.0`입니다.

## Gate 기본 정책

- normal code: available format/lint, typecheck, build, focused functional test
- UI: applicable visual/interaction/accessibility evidence와 design review
- targeted security/performance: scope가 해당될 때만
- observability: opt-in
- full matrix, hardening, package/cross-host validation: release-only

선택 script가 없으면 not applicable입니다. 필수 check를 실행하지 않았거나 skip/실패했다면 passed로 바꾸지 않습니다.
