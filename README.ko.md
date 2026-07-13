# spec-to-pr

제품 기획서, 문서, Figma 디자인, OpenAPI 계약을 입력받아 검증 가능한 draft PR/MR까지 이어주는 증거 우선(evidence-first) Claude Code / Codex 플러그인입니다.

English version: [README.md](README.md)

## 무엇을 하는 프로젝트인가

`spec-to-pr`는 단순히 “코드를 써달라”는 프롬프트 묶음이 아닙니다. Claude Code 또는 Codex를 위한 7개 도구 MCP facade, 공유 skill, artifact 저장소, 두 개의 독립 reviewer role로 빠르고 증거 기반인 납품 workflow를 제공합니다.

대략적으로 다음 일을 합니다.

- 제품 brief, 문서, Figma URL, OpenAPI 파일, 저장소 컨텍스트를 source evidence로 기록합니다.
- intake evidence에서 requirement, OpenSpec/Gherkin, API, mock, design contract를 생성합니다.
- API와 UI 구현을 하나의 context에서 진행하며, UI 완료 evidence 전에 `api-ready` checkpoint를 완료합니다.
- code scope에는 `functional-reviewer`를 실행하고 UI scope일 때만 독립적인 `design-reviewer`를 추가합니다.
- 모든 변경에 전문 gate를 전부 실행하지 않고 scope에 맞는 빠른 gate를 선택합니다.
- 필수 evidence가 승인되면 증거 기반 report를 만들고 draft GitHub PR 또는 GitLab MR로 발행합니다.

발행은 리뷰 요청 본문을 생성하거나 갱신하는 작업입니다. PR/MR을 merge, approve, close, ready-for-review 전환하지 않습니다.

## 요구사항

- Node.js `>=22`
- `pnpm`
- Git
- 사용할 host에 따라 Claude Code 또는 Codex
- 발행 시 선택 사항: 인증된 `gh` 또는 `glab`, 혹은 `GITHUB_TOKEN` / `GH_TOKEN` / `GITLAB_TOKEN` / `GITLAB_PRIVATE_TOKEN`
- visual capture 시 선택 사항: 대상 프로젝트 환경에 Playwright Chromium 설치

## 다운로드와 빌드

```bash
git clone https://github.com/dhyun2/spec-to-pr.git
cd spec-to-pr
corepack enable
pnpm install
pnpm build
```

플러그인을 개발할 때 유용한 체크 명령입니다.

```bash
pnpm format:check
pnpm typecheck
pnpm test
pnpm plugin:validate
```

## Claude Code에 설치하기

Claude Code는 marketplace를 통해 플러그인을 설치합니다. 이 저장소는 `.claude-plugin/marketplace.json`에 Claude marketplace manifest를 포함합니다.

Claude Code에서 marketplace를 추가하고 플러그인을 설치합니다.

```text
/plugin marketplace add dhyun2/spec-to-pr
/plugin install spec-to-pr@spec-to-pr
```

로컬 개발 중이라면 clone한 저장소 경로를 marketplace로 추가하면 됩니다.

```text
/plugin marketplace add /absolute/path/to/spec-to-pr
/plugin install spec-to-pr@spec-to-pr
```

설치 후 플러그인과 로컬 MCP kernel이 보이는지 확인합니다.

```text
/spec-to-pr:doctor
```

## Codex에 설치하기

Codex 지원은 두 가지 표면(surface)을 제공합니다.

- `.codex-plugin/plugin.json` — 설치 가능한 Codex 플러그인을 노출합니다.
- `packages/codex-sdk` — CI 및 내부 자동화를 위한 프로그래매틱 러너를 제공합니다.

다른 컴퓨터나 새 Codex 환경에는 Git marketplace로 설치하는 방식을 권장합니다.

```bash
codex plugin marketplace add https://github.com/dhyun2/spec-to-pr --ref main
codex plugin add spec-to-pr@spec-to-pr
```

업데이트할 때는 marketplace를 갱신한 뒤 플러그인을 다시 설치합니다.

```bash
codex plugin marketplace upgrade spec-to-pr
codex plugin add spec-to-pr@spec-to-pr
```

로컬 플러그인 테스트는 clone한 저장소를 Codex marketplace source로 추가합니다.

```bash
codex plugin marketplace add .
codex plugin add spec-to-pr@spec-to-pr
```

이후 Codex를 재시작하고, `/plugins`를 열어 `SpecToPR` marketplace를 선택한 뒤 `spec-to-pr`가 설치되어 있는지 확인합니다.

Codex에서는 MCP tool이 정규화된 `mcp__spec_to_pr__*` 네임스페이스로 노출됩니다. public facade는 정확히 `workflow_info`, `workflow_start`, `workflow_advance`, `workflow_submit`, `workflow_status`, `workflow_publish`, `workflow_archive`입니다. task가 skill은 읽었는데 이 tool을 못 본다면 새 task를 시작하거나 Doctor 실행 전에 Codex에게 `spec-to-pr workflow_info workflow_start`를 검색해보라고 요청하세요.

설치된 플러그인을 검증할 때 plugin cache 안에서 `pnpm exec node`로 `@modelcontextprotocol/sdk`를 직접 import하는 임시 스크립트는 사용하지 마세요. release package는 의도적으로 `node_modules`를 제외하므로, Doctor 검증은 번들된 `node ./dist/mcp/server.js` 프로세스와 host에 노출된 MCP tool을 통해 수행해야 합니다.

### Codex SDK Runner

다른 프로세스가 Codex를 시작하고 입력을 넘긴 뒤 최종 응답이나 thread ID를 수집해야 한다면 SDK runner를 사용합니다.

```bash
cd packages/codex-sdk
pnpm install
pnpm build
node dist/cli.js \
  --cwd /path/to/app \
  --brief docs/plan.md \
  --docs docs \
  --figma https://figma.com/file/... \
  --openapi docs/openapi.yaml \
  --min-visual-score 0.98 \
  --max-repair-attempts 3
```

Codex 전용 상세 내용은 [docs/codex/README.ko.md](docs/codex/README.ko.md)를 참고하세요.

## 기본 플로우

1. **Intake**가 요청을 기록하고 code, API, UI, release 적용 여부를 분류합니다.
2. **Contracts**가 필요한 requirement, OpenSpec/Gherkin, API, mock, design evidence를 생성합니다.
3. **Implementation**은 하나의 context에서 진행합니다. API type, schema, wrapper, mock, contract-test evidence가 `api-ready`에 도달해야 UI 완료 evidence를 제출할 수 있습니다.
4. **Functional review**가 code scope의 requirement 충실도, contract, test, architecture, security, 미해결 functional gap을 확인합니다.
5. **Design review**는 UI scope일 때만 visual fidelity, design-system 사용, interaction state, accessibility를 독립적으로 확인하며, 그 외에는 not applicable입니다.
6. **Report**가 canonical gate와 reviewer 결정을 요약합니다.
7. **Publish**가 필수 evidence 승인 후 draft PR/MR을 안전하게 생성하거나 갱신합니다.
8. **Archive**는 merge evidence를 근거로 명시적으로 실행하는 post-merge 작업입니다.

## 빠른 gate와 release gate

기본 workflow는 빠르고 scope-aware하게 동작합니다. code 변경은 사용 가능한 lint/format, typecheck, build와 관련 functional test 하나를 실행합니다. OpenSpec validation, architecture boundary, targeted security, visual comparison, interaction accessibility, performance 검사는 분류된 scope에 해당할 때만 실행합니다. Observability는 opt-in입니다. 선택 사항인 script가 없으면 not applicable이고, 필수 evidence가 없거나 실패하면 blocked입니다.

Release 검증은 별도입니다. 전체 test matrix, hardening suite, package verification, cross-host manifest validation은 release-only gate이며 명시적인 release workflow에서만 실행합니다. 일반 feature나 bug-fix run에는 자동으로 추가하지 않습니다.

## 입력으로 줄 수 있는 것

다음 중 하나 이상을 넘길 수 있습니다.

- 제품 brief: `docs/plan.md`, Markdown, plain text
- 문서 디렉터리: `docs/`
- Figma URL
- OpenAPI YAML/JSON
- 대상 repository path
- source/target branch
- validation command 또는 quality-gate 요구사항

설치 후 사용할 수 있는 예시 요청입니다.

```text
Run spec-to-pr for /path/to/app.
Use docs/plan.md as the brief, docs/openapi.yaml as OpenAPI input,
and this Figma URL: https://figma.com/file/...
Generate an evidence-backed draft PR report and publish a draft review request only if it is not blocked.
```

## 문서 사이트

설치 · 퀵스타트 · 프롬프트 레시피 · 파이프라인 개념 · 평가/루프 엔지니어링 · 태스크 명세(T01~T33) · 트러블슈팅 전체 문서:

**https://dhyun2.github.io/spec-to-pr/**

로컬에서 문서 사이트를 띄우려면:

```bash
pnpm --dir website install
pnpm --dir website start
```

## 릴리즈와 로컬 marketplace 갱신

릴리즈 검증:

```bash
pnpm release:verify
```

발행 계획 dry-run:

```bash
pnpm release:publish:dry-run
```

push/tag 없이 로컬 Claude/Codex marketplace 설치를 갱신:

```bash
pnpm release:update:local
```

host 하나만 갱신:

```bash
pnpm release:update:claude
pnpm release:update:codex
```

릴리즈 스크립트는 플러그인 패키지를 준비하고 검증합니다. 다운스트림 PR/MR을 merge하지는 않습니다.
