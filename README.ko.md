# spec-to-pr

제품 기획서, 문서, Figma 디자인, OpenAPI 계약을 입력받아 검증 가능한 draft PR/MR까지 이어주는 증거 우선(evidence-first) Claude Code / Codex 플러그인입니다.

English version: [README.md](README.md)

## 무엇을 하는 프로젝트인가

`spec-to-pr`는 단순히 “코드를 써달라”는 프롬프트 묶음이 아닙니다. Claude Code 또는 Codex가 일정한 납품 파이프라인을 따라 움직이도록 로컬 MCP kernel, 공유 skill, 리뷰 agent, artifact 저장소, quality gate를 함께 제공합니다.

대략적으로 다음 일을 합니다.

- 제품 brief, 문서, Figma URL, OpenAPI 파일, 저장소 컨텍스트를 source evidence로 기록합니다.
- 요구사항과 구현/검증 산출물을 traceability graph로 연결합니다.
- OpenSpec proposal, Gherkin scenario, API pipeline artifact, design contract를 생성합니다.
- Spec/BDD, API Contract, Design/UI 구현 lane을 실행합니다.
- 아키텍처, quality gate, visual regression, 접근성, 성능, observability, PR report, 발행, 릴리즈 준비 리뷰 lane을 실행합니다.
- Figma/browser 또는 legacy/target 스크린샷을 비교하고 제한된 visual repair loop를 돌립니다.
- brief fidelity, legacy coverage, Gherkin completeness, TDD evidence, design-system usage, visual parity, resource contract, API contract, publish sync를 0-10점으로 채점하는 review scorecard를 생성합니다.
- Figma node별 component contract와 component-level visual gate를 만들어 화면 일부 차이가 전체 점수에 묻히지 않게 합니다.
- legacy 마이그레이션에서는 route/component/API/native event/URL/analytics/root/global CSS/query param을 기능 원장으로 뽑고 coverage matrix로 누락을 차단합니다.
- 증거 기반 PR report를 생성하며, 리뷰어용 MR body와 내부 audit report를 분리합니다.
- blocker가 없으면 draft GitHub PR 또는 GitLab MR로 report를 발행하고, blocked라도 기존 draft에는 실패 report body 갱신을 허용할 수 있습니다.

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

Codex에서는 MCP tool이 정규화된 `mcp__spec_to_pr__*` 네임스페이스로 노출됩니다. thread가 skill은 읽었는데 tool을 못 본다면, 새 thread를 시작하거나 Doctor 실행 전에 Codex에게 `spec-to-pr kernel_info create_run` tool을 검색해보라고 요청하세요.

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

1. **Doctor**가 플러그인, MCP 서버, 런타임, tool 목록이 정상인지 확인합니다.
2. **Intake**가 원 요청과 brief/docs/Figma/OpenAPI/repository 입력을 evidence로 기록합니다.
3. **Profiling**이 대상 프로젝트의 package manager, framework, script, workspace boundary를 확인합니다.
4. **Legacy inventory**가 마이그레이션 대상의 route, component, store, API, native bridge, URL, analytics, root/global CSS selector, query/hash param을 기능 원장으로 기록할 수 있습니다.
5. **Traceability**가 요구사항과 source evidence를 연결하고 gap을 찾습니다. Legacy coverage matrix를 다시 만들 때는 같은 legacy feature의 기존 open gap을 재사용해 blocker gap을 중복 생성하지 않습니다.
6. **Contracts**가 OpenSpec, Gherkin, API, design-system mapping, component contract artifact를 생성합니다. 같은 요구사항을 가리키는 반복 traceability row는 OpenSpec 렌더링 전에 병합됩니다.
7. **Agent lanes**가 Spec/BDD, API Contract, Design/UI 작업을 준비하고 실행합니다.
8. **Review council**이 lane 결과, legacy feature coverage, component contract coverage를 모아 위험하거나 불완전한 작업을 차단합니다.
9. **Integration**이 승인된 변경을 정해진 순서로 적용합니다.
10. **Gates**가 quality, architecture, visual, accessibility, performance, observability 검증을 실행합니다.
11. **Review scorecard**가 brief fidelity, legacy coverage, Gherkin completeness, TDD evidence, design-system usage, visual parity, resource contract, API contract, publish sync를 채점합니다. scorecard가 없거나 어느 항목이든 정규화된 최소 기준, 보통 8/10 미만이면 publish 가능한 report가 blocked됩니다. `minimumScore: 0.85` 같은 비율 입력은 `8.5/10`으로 정규화됩니다.
12. **PR report**가 evidence, scorecard row, diff, risk, grouped gap, decision을 요약하고 내부 audit report와 MR body를 분리합니다.
13. **Publish**가 report decision이 blocked가 아니고 생성된 body와 필수 visual preview가 동기화될 때 draft PR/MR을 생성하거나 갱신합니다. 기존 draft가 있으면 blocked 실패 report body update만 허용하는 경로를 쓸 수 있습니다.
14. **Archive/release**는 merge evidence를 기록하고 release-readiness artifact를 준비할 수 있습니다.

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
