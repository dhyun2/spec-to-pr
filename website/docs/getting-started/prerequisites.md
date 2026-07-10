---
sidebar_position: 1
title: 사전 준비물
---

# 사전 준비물

설치 전에 아래 체크리스트를 확인하세요. **필수** 항목이 없으면 파이프라인이 시작되지 않거나 중간에 멈춥니다.

## 필수

| 항목                       | 요구사항                                                 | 확인 방법                              |
| -------------------------- | -------------------------------------------------------- | -------------------------------------- |
| **Node.js**                | ≥ 22.0.0                                                 | `node --version`                       |
| **git 저장소**             | 대상 프로젝트가 git 저장소여야 함 (worktree 격리에 사용) | `git -C <프로젝트> status`             |
| **Claude Code 또는 Codex** | 플러그인 호스트                                          | `claude --version` / `codex --version` |

:::warning Node 22 미만이면
MCP kernel 서버가 시작 단계에서 종료됩니다. `nvm install 22` 등으로 먼저 올려주세요.
:::

## 선택 — 사용하는 기능에 따라

| 항목                | 언제 필요한가                                    | 설정 방법                                                                     |
| ------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| **GitHub 토큰**     | PR 자동 발행(T31)                                | `GITHUB_TOKEN` 또는 `GH_TOKEN` 환경변수. 없으면 `gh auth token`으로 폴백      |
| **GitLab 토큰**     | MR 자동 발행                                     | `GITLAB_TOKEN` 또는 `GITLAB_PRIVATE_TOKEN`. 없으면 `glab auth token`으로 폴백 |
| **Figma MCP 연결**  | Figma 디자인을 증거로 쓸 때 (T09~T11, 시각 회귀) | Claude Code/Codex에 Figma MCP 서버 연결 후 `/spec-to-pr:figma-doctor`로 확인  |
| **pnpm / corepack** | 소스에서 직접 빌드해 로컬 설치할 때              | `corepack enable && pnpm --version`                                           |

## Figma를 쓸 계획이라면

spec-to-pr은 Figma를 직접 호출하지 않고, 호스트에 연결된 **Figma MCP 서버를 통해** 디자인 컨텍스트·스크린샷·변수를 수집합니다. 그래서 연결이 선행되어야 합니다.

**1. Figma 쪽에서 MCP 서버 켜기** — Figma **데스크톱 앱**의 Preferences에서 **Enable Dev Mode MCP Server**를 켭니다. 로컬 서버가 뜨고 주소가 표시됩니다 (기본 `http://127.0.0.1:3845/mcp`).

**2. 호스트에 등록** — Claude Code 기준:

```bash
claude mcp add --transport http figma http://127.0.0.1:3845/mcp
```

(주소는 Figma 앱이 표시한 값을 그대로 사용하세요. claude.ai 커넥터나 원격 Figma MCC를 쓰는 경우엔 해당 커넥터 설정으로 대체됩니다.)

**3. 연결 진단** — 플러그인 설치 후:

```bash
/spec-to-pr:figma-doctor
```

```text title="예상 출력 (요약)"
✔ provider 감지: figma (local)
✔ capability: design-context, screenshot, variables
✘ capability: code-connect — 이 플랜/파일에서는 미지원 → 관련 수집은 gap으로 기록됨
```

figma-doctor는 어떤 provider가 잡혔고 어떤 capability를 쓸 수 있는지 보고합니다. **capability가 일부 없어도 파이프라인은 돕니다** — 없는 수집물은 조용히 생략되는 게 아니라 gap으로 남습니다.

**4. 파일 권한과 URL** — 대상 Figma 파일에 열람 권한이 있어야 하고, URL은 브라우저 주소창의 `https://www.figma.com/file/{fileId}/...?node-id={nodeId}` 형태를 그대로 쓰면 됩니다. **특정 프레임만 분석하려면 그 프레임을 선택한 상태에서 URL을 복사**하세요 (`node-id`가 포함됩니다).

준비가 끝났다면 [설치](/getting-started/installation)로 이동하세요.
