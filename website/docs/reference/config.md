---
sidebar_position: 3
title: 설정 · 환경변수
---

# 설정 · 환경변수

## 환경변수 전체 목록

| 변수                                    | 기본값                   | 용도                                                  |
| --------------------------------------- | ------------------------ | ----------------------------------------------------- |
| `SPEC_TO_PR_DATA_DIR`                   | 플러그인 데이터 디렉터리 | SQLite·blob·콘텐츠 저장소 위치                        |
| `GITHUB_TOKEN` / `GH_TOKEN`             | —                        | GitHub PR 발행. 둘 다 없으면 `gh auth token`으로 폴백 |
| `GITLAB_TOKEN` / `GITLAB_PRIVATE_TOKEN` | —                        | GitLab MR 발행. 없으면 `glab auth token`으로 폴백     |
| `SPEC_TO_PR_GIT_HOST`                   | `github.com`             | 셀프호스트 GitHub/GitLab 도메인                       |
| `SPEC_TO_PR_API_BASE_URL`               | `https://api.github.com` | 셀프호스트 API 엔드포인트                             |
| `SPEC_TO_PR_WEB_BASE_URL`               | `https://github.com`     | PR 링크 생성용 웹 URL                                 |

### 토큰 해석 순서 (GitHub 기준)

```text
1. GITHUB_TOKEN 환경변수
2. GH_TOKEN 환경변수
3. gh CLI 로그인 세션 (gh auth token)
→ 전부 없으면 publisher 스테이지가 gap을 남기고 발행을 건너뜀
```

## MCP 서버 설정

### Claude Code — `.mcp.json`

플러그인 설치 시 자동 구성됩니다. 직접 수정할 일은 데이터 디렉터리 변경 정도입니다.

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

### Codex — `.codex-plugin/plugin.json`

동일 kernel을 내장하며 tool은 `mcp__spec_to_pr__*` 네임스페이스로 노출됩니다.

## 런타임 정책 기본값

프롬프트로 Run마다 조정할 수 있는 값들의 기본값입니다. ([옵션과 정책](/usage/options-and-policies) 참고)

| 항목                    | 기본값                  |
| ----------------------- | ----------------------- |
| 스코어카드 임계값       | 8.0 / 10 (모든 차원)    |
| 시각 회귀 최소 점수     | 0.98 (reviewMatchRatio) |
| visual repair 최대 횟수 | 3                       |
| Review Council 재검토   | 최대 2사이클            |
| 스테이지 재시도         | 최대 3회                |
| stage lease TTL         | 5분                     |
| target 브랜치           | `main`                  |
| 발행 모드               | draft                   |

## Codex SDK Runner CLI 옵션

CI에서 쓰는 `packages/codex-sdk` 러너의 주요 플래그:

```bash
node dist/cli.js \
  --cwd <대상 프로젝트 경로> \        # 필수
  --brief <기획서 경로> \
  --docs <문서 디렉터리> \
  --figma <Figma URL> \
  --openapi <OpenAPI 경로/URL> \
  --min-visual-score 0.98 \
  --max-repair-attempts 3
```

## 디스크 관리

- Run 데이터(SQLite·blob)는 자동 삭제되지 않습니다. 오래된 Run 정리는 `SPEC_TO_PR_DATA_DIR`에서 수동으로.
- `<프로젝트>/.spec-to-pr/worktrees/`의 worktree는 Run 종료 후 `git worktree prune`으로 정리할 수 있습니다.
- `.spec-to-pr/`는 대상 프로젝트의 `.gitignore`에 추가하는 것을 권장합니다.
