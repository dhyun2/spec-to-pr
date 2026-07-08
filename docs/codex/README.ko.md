# Codex 통합

spec-to-pr는 두 가지 Codex 표면(surface)을 제공합니다.

1. **Codex 플러그인**: Codex 앱·CLI 사용자를 위한 설치형 UX입니다. 공유 `skills/` 워크플로우와 로컬 stdio MCP kernel을 함께 번들링합니다.
2. **Codex SDK 러너**: CI, 내부 도구, 대화형 Codex UI 밖에서의 멀티에이전트 오케스트레이션을 위한 프로그래매틱 자동화 진입점입니다.

사람이 Codex에서 spec-to-pr를 설치·호출해야 한다면 플러그인을 사용하세요. 다른 프로세스가 Codex를 시작하고, brief를 제공하고, 최종 응답이나 thread ID를 수집해야 한다면 SDK 러너를 사용하세요.

## 로컬 플러그인 테스트

저장소 루트가 곧 플러그인 패키지입니다. 저장소 로컬 마켓플레이스는 다음 위치에 있습니다.

```text
.agents/plugins/marketplace.json
```

Codex에서 테스트하려면 이 저장소를 마켓플레이스 소스로 추가하고, 플러그인 디렉터리에서 `spec-to-pr`를 설치하세요.

```bash
codex plugin marketplace add .
```

이후 Codex를 재시작하고, `/plugins`를 열어 `Spec to PR Local` 마켓플레이스를 선택한 뒤 `spec-to-pr`를 설치합니다.

Codex에서는 플러그인 MCP tool이 정규화된 `mcp__spec_to_pr__*` 네임스페이스로 노출됩니다. thread가 skill은 로드했는데 MCP tool이 보이지 않는다고 하면, 새 thread를 시작하거나 `Doctor`를 실행하기 전에 Codex에게 `spec-to-pr kernel_info create_run` tool을 검색해보라고 요청하세요.

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

- 최소 시각 점수: `0.9`
- 최대 수리 시도 횟수: `3`
- 점수 지표: `reviewMatchRatio`

공유 `Run Visual Repair Loop` 스킬은 각 시각 비교 이후 `evaluate_visual_repair_loop`를 호출합니다. `retry` 또는 `failed` 판정이 나오면, Design/UI lane이 실패한 target을 수리하거나 루프가 소진되어 human-review blocker를 기록할 때까지 PR 리포트 발행이 차단됩니다.

## 발행 경계 (Publishing Boundary)

`Spec To PR` end-to-end 실행은 리포트 결정(decision)이 blocked가 아니면 생성된 PR 리포트를 draft PR/MR로 발행해야 합니다. 발행자는 생성된 `pr-report.md` artifact를 리뷰 요청 본문의 기준으로 사용합니다 — 기억에 의존해 새 본문을 작성해서는 안 됩니다.

시각 비교 PNG artifact가 존재하면, 발행자는 Figma·브라우저·diff 이미지를 리뷰 호스트에 업로드하고 `Visual Evidence Preview` 섹션을 PR/MR 본문에 주입합니다. GitLab은 프로젝트 markdown 업로드를 사용하며, MR 설명에서 이미지가 렌더되도록 프로젝트-상대 경로(project-relative path)를 그대로 유지합니다. GitHub는 이미지를 소스 브랜치의 `.spec-to-pr/visual-assets/` 아래로 발행합니다 — public repo는 commit SHA에 고정된 raw URL을 임베드해 브랜치 삭제 후에도 안정적이며, private repo는 raw URL이 인증 없이 임베드될 수 없으므로 일반 blob 링크로 폴백합니다. 이미지 한 장의 업로드가 실패해도 전체 PR/MR 발행이 실패하는 대신 미리보기 없이 발행됩니다.

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
