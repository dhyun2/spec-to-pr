# Codex 통합

spec-to-pr는 두 가지 Codex 표면(surface)을 제공합니다.

1. **Codex 플러그인**: Codex 앱·CLI 사용자를 위한 설치형 UX입니다. 공유 `skills/` 워크플로우와 로컬 stdio MCP kernel을 함께 번들링합니다.
2. **Codex SDK 러너**: CI, 내부 도구, 대화형 Codex UI 밖에서의 멀티에이전트 오케스트레이션을 위한 프로그래매틱 자동화 진입점입니다.

사람이 Codex에서 spec-to-pr를 설치·호출해야 한다면 플러그인을 사용하세요. 다른 프로세스가 Codex를 시작하고, brief를 제공하고, 최종 응답이나 thread ID를 수집해야 한다면 SDK 러너를 사용하세요.

## Git marketplace 설치

다른 컴퓨터나 새 Codex 환경에서는 Git marketplace로 설치하는 방식을 권장합니다. 이 방식은 plugin cache의 `node_modules` 상태를 믿지 않고, repository manifest와 번들된 MCP 서버를 기준으로 설치합니다.

```bash
codex plugin marketplace add https://github.com/dhyun2/spec-to-pr --ref main
codex plugin add spec-to-pr@spec-to-pr
```

업데이트할 때는 marketplace를 먼저 갱신하고 플러그인을 다시 설치합니다.

```bash
codex plugin marketplace upgrade spec-to-pr
codex plugin add spec-to-pr@spec-to-pr
```

설치 확인:

```bash
codex plugin marketplace list | rg spec-to-pr
codex plugin list | rg spec-to-pr
```

## 로컬 플러그인 테스트

저장소 루트가 곧 플러그인 패키지입니다. 저장소 로컬 마켓플레이스는 다음 위치에 있습니다.

```text
.agents/plugins/marketplace.json
```

Codex에서 테스트하려면 이 저장소를 마켓플레이스 소스로 추가하고, 플러그인 디렉터리에서 `spec-to-pr`를 설치하세요.

```bash
codex plugin marketplace add .
codex plugin add spec-to-pr@spec-to-pr
```

이후 Codex를 재시작하고, `/plugins`를 열어 `SpecToPR` 마켓플레이스를 선택한 뒤 `spec-to-pr`가 설치되어 있는지 확인합니다.

Codex에서는 플러그인 MCP tool이 정규화된 `mcp__spec_to_pr__*` 네임스페이스로 노출됩니다. thread가 skill은 로드했는데 MCP tool이 보이지 않는다고 하면, 새 thread를 시작하거나 `Doctor`를 실행하기 전에 Codex에게 `spec-to-pr kernel_info create_run` tool을 검색해보라고 요청하세요.

설치된 플러그인을 검증할 때 plugin cache 안에서 `pnpm exec node`로 `@modelcontextprotocol/sdk`를 직접 import하는 임시 스크립트는 사용하지 마세요. release package는 의도적으로 `node_modules`를 제외하므로, Doctor 검증은 번들된 `node ./dist/mcp/server.js` 프로세스와 host에 노출된 MCP tool을 통해 수행해야 합니다.

## SDK 러너

SDK 러너 스캐폴드는 `packages/codex-sdk`에 있습니다. Claude/Codex 플러그인 kernel이 Codex SDK에 런타임 의존성을 갖지 않도록, 의도적으로 루트 패키지와 분리되어 있습니다.

```bash
cd packages/codex-sdk
pnpm install
pnpm build
node dist/cli.js --cwd /path/to/app --brief docs/plan.md --figma https://figma.com/file/...
```

이 러너는 Codex thread를 새로 시작하거나 재개하고, 설치된 spec-to-pr 플러그인이 있으면 이를 사용하도록 Codex에 요청하며, 대화형 워크플로우와 동일한 증거 우선(evidence-first) 리포팅 규칙을 유지합니다.

## 리뷰 Agent와 시각 수리(Visual Repair)

Codex 지원에는 시각 리뷰, Review Council 취합, Design/UI 수리를 위한 프로젝트 스코프 커스텀 agent가 `.codex/agents/` 아래 포함되어 있습니다. SDK 러너 역시 리뷰 lane 지시를 함께 내보내므로, host가 서브에이전트 워크플로우를 지원하면 Codex가 서브에이전트를 스폰하고, 지원하지 않으면 동일한 lane을 순차적으로 실행합니다.

기본 시각 수리 정책은 다음과 같습니다.

- 최소 시각 점수: `0.98`
- 최대 수리 시도 횟수: `3`
- 점수 지표: `reviewMatchRatio`

공유 `Run Visual Repair Loop` 스킬은 각 시각 비교 이후 `evaluate_visual_repair_loop`를 호출합니다. `retry` 또는 `failed` 판정이 나오면, Design/UI lane이 실패한 target을 수리하거나 루프가 소진되어 human-review blocker를 기록할 때까지 PR 리포트 발행이 차단됩니다.

마이그레이션 실행에서는 기본 Figma-vs-browser 외에 `legacy-screenshot` baseline을 사용할 수 있습니다. 이 경우 legacy 전체 화면 스냅샷과 target 구현 화면을 비교하고, Figma는 디자인 시스템, 토큰, 컴포넌트 의도 evidence로 남깁니다. Figma node에서 생성된 component contract가 있으면 whole-page 비교와 별도로 component-level visual evidence가 필요합니다.

## Legacy Feature Coverage

Vue2 등 legacy 모듈을 Vue3/TypeScript target으로 옮길 때는 화면 요약만으로 Gherkin을 만들지 않습니다. `generate_legacy_feature_inventory`가 route, component, store, API call, native bridge, URL open, analytics, env, query/hash param, 그리고 이관 화면에 영향을 주는 root/global CSS selector를 기능 원장으로 기록하고, `build_feature_coverage_matrix`가 다음 연결을 검사합니다.

```text
legacy feature -> OpenSpec requirement -> Gherkin scenario -> target implementation -> test/evidence
```

빈 칸이 남으면 Review Council 전에 blocker로 취급합니다. 그래서 NetFunnel, 앱 이벤트, 위치 권한, radius 확장 재검색, 예약/전화/길찾기 분기, root stylesheet 영향처럼 화면 스냅샷만으로는 보이지 않거나 원인을 놓치기 쉬운 동작도 coverage gap으로 올라옵니다.

feature coverage matrix를 다시 만들 때는 legacy feature ID 기준으로 기존 open `legacy-coverage` gap을 재사용합니다. 따라서 재실행이 matrix evidence를 갱신하더라도 같은 legacy 동작에 대한 blocker gap을 중복 생성하지 않습니다.

## OpenSpec 생성

OpenSpec 생성은 traceability matrix를 보수적으로 소비합니다. 같은 spec area 안에서 동일한 requirement title을 설명하는 traceability row가 여러 개 있으면 렌더링 전에 하나로 병합합니다. 병합된 requirement는 더 엄격한 status와 evidence ID, gap ID, tag의 합집합을 유지하므로 반복 evidence가 중복 OpenSpec requirement로 렌더링되지 않습니다.

## 리뷰 점수표(Review Scorecard)

PR report를 publish 가능한 것으로 취급하기 전에는
`generate_review_scorecard`가 `review-scorecard` artifact를 기록합니다.
점수표는 0-10점 척도와 기본 8/10 최소 기준을 사용하며 다음 항목을 봅니다.

- brief fidelity
- legacy coverage
- Gherkin completeness
- TDD evidence
- design-system usage
- visual parity
- resource contract
- API contract
- publish sync

scorecard가 없거나, 어느 항목이든 정규화된 최소 기준 미만이거나, `nextRepairTarget`이
남아 있으면 PR report decision은 `blocked`로 유지됩니다. compact PR/MR
body와 내부 audit report 모두 점수표를 렌더링하므로, 리뷰어는 어떤 항목이
루프의 다음 수리 대상인지 바로 볼 수 있습니다.

scorecard 기준값은 항상 0-10점 척도로 해석합니다. `minimumScore`가 0-1 범위이면 비율 입력으로 보고, 예를 들어 `0.85`는 `0.85/10`이 아니라 `8.5/10`으로 정규화됩니다.

## 발행 경계 (Publishing Boundary)

`SpecToPR` end-to-end 실행은 리포트 결정(decision)이 blocked가 아니면 생성된 PR 리포트를 draft PR/MR로 발행해야 합니다. 발행자는 생성된 `pr-report.md` artifact를 리뷰 요청 본문의 기준으로 사용합니다 — 기억에 의존해 새 본문을 작성해서는 안 됩니다.

blocked 결정은 새 PR/MR 생성이나 ready 전환을 막습니다. 다만 이미 열린 draft PR/MR이 있고 실패 evidence를 리뷰어에게 보여줘야 하면, 명시적인 blocked draft update 경로로 body만 갱신할 수 있습니다. 이때도 상태는 blocked로 남고 merge/approve/ready 전환은 하지 않습니다.

PR/MR body는 리뷰어가 봐야 할 decision, gate 요약, visual preview, grouped gaps 중심으로 렌더링합니다. Figma provider capability, artifact count, 빈 traceability 상세, 대량 반복 gap 목록 같은 내부 audit 정보는 별도 audit report로 분리합니다.

시각 비교 PNG artifact가 존재하면, 발행자는 Figma·브라우저·diff 이미지를 리뷰 호스트에 업로드하고 `Visual Evidence Preview` 섹션을 PR/MR 본문에 주입합니다. GitLab은 프로젝트 markdown 업로드를 사용하며, MR 설명에서 이미지가 렌더되도록 프로젝트-상대 경로(project-relative path)를 그대로 유지합니다. GitHub는 이미지를 소스 브랜치의 `.spec-to-pr/visual-assets/` 아래로 발행합니다 — public repo는 commit SHA에 고정된 raw URL을 임베드해 브랜치 삭제 후에도 안정적이며, private repo는 raw URL이 인증 없이 임베드될 수 없으므로 일반 blob 링크로 폴백합니다. 생성된 report 또는 intake policy가 visual preview asset을 요구하면 업로드 실패는 publish result를 `failed`로 만들며, PR/MR URL만으로는 publish 성공으로 보지 않습니다.

발행은 draft GitHub Pull Request 또는 GitLab Merge Request를 생성·갱신하는 것을 의미합니다. merge, approve, close, 또는 ready-for-review 전환은 하지 않습니다.

## 스킬 Frontmatter 호환성

스킬 파일(`skills/*/SKILL.md`)은 Claude Code용으로 작성된 YAML frontmatter를 사용합니다. Codex는 스킬 본문을 읽고 Claude 전용 키는 무시합니다.

| Frontmatter 키             | Claude Code | Codex  |
| -------------------------- | ----------- | ------ |
| `name`, `description`      | 사용됨      | 사용됨 |
| `allowed-tools`            | 사용됨      | 무시됨 |
| `disable-model-invocation` | 사용됨      | 무시됨 |
| `argument-hint`            | 사용됨      | 무시됨 |

무시되는 키는 Codex에서 무해합니다. MCP tool은 `allowed-tools` 설정과 무관하게 정규화된 `mcp__spec_to_pr__*` 네임스페이스로 항상 사용 가능합니다.

## 서브에이전트 대응(Parity)

Claude agent는 `agents/*.md`에 있습니다. Codex의 대응 agent는 `.codex/agents/*.toml`에 `spec-to-pr-<name>` 형태로 존재하며, 모든 구현 lane과 리뷰어(spec-bdd, api-contract, design-ui, integrator, review-council, 그리고 게이트/리포트/발행/릴리즈 리뷰어)를 커버합니다. 여기에 Codex 전용인 `spec-to-pr-design-ui-repair`가 추가로 있습니다.

host가 이름이 지정된 서브에이전트를 스폰할 수 없는 경우, 각 lane/리뷰 스킬은 모델이 동일한 단계를 현재 thread에서 인라인으로 수행하고 동일한 `record_*` MCP tool로 결과를 기록하도록 지시합니다. 어떤 lane도 건너뛰지 않습니다.

## Self-Hosted GitHub / GitLab

`github.com`과 `gitlab.com`은 자동으로 감지됩니다. GitHub Enterprise나 self-hosted GitLab의 경우 호스트명을 휴리스틱으로 매칭하고(`gitlab`/`github`가 포함된 호스트), API base를 유도합니다(GitLab은 `/api/v4`, GitHub Enterprise는 `/api/v3`). 필요하면 감지 결과를 다음과 같이 override할 수 있습니다.

```bash
export SPEC_TO_PR_GIT_HOST=gitlab            # 또는 github
export SPEC_TO_PR_API_BASE_URL=https://scm.internal/api/v4
export SPEC_TO_PR_WEB_BASE_URL=https://scm.internal
```

## 발행자 토큰(Publisher Tokens)

발행자 토큰은 먼저 환경 변수에서 읽고, 없으면 host CLI에서 읽습니다.

- GitHub: `GITHUB_TOKEN` / `GH_TOKEN`, 없으면 `gh auth token`.
- GitLab: `GITLAB_TOKEN` / `GITLAB_PRIVATE_TOKEN`, 없으면 `glab auth token`.
