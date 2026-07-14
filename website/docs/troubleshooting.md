---
sidebar_position: 9
title: 트러블슈팅
---

# 트러블슈팅

첫 진단은 `/spec-to-pr:doctor`입니다. `workflow_info`가 contract `2.0.0`, tool 7개, stage 8개, reviewer 2개를 반환해야 합니다.

## 설치와 기동

### MCP server가 시작되지 않는다

1. `node --version`이 22 이상인지 확인합니다.
2. 로컬 소스 설치라면 `pnpm build` 뒤 `dist/mcp/server.js`가 있는지 확인합니다.
3. 호스트를 재시작하거나 plugin을 reload합니다.
4. plugin cache에서 `@modelcontextprotocol/sdk`를 직접 import해 진단하지 말고 실제 host tool인 `workflow_info`를 호출합니다.

### v1 tool/skill 이름이 보인다

현재 public surface는 `workflow_*` tool 7개와 skill 9개뿐입니다. Marketplace를 갱신하고 plugin을 다시 설치한 뒤 새 task를 시작하세요. 오래된 task context에서 삭제된 microtool을 계속 호출하지 마세요.

## Mode 입력

### Brief mode가 시작되지 않는다

`briefPath`가 빠졌거나 대상 저장소에서 읽을 수 없는 경우입니다. Project-relative path를 명시하고 실제 파일을 확인하세요.

### Legacy mode가 너무 넓게 조사한다

“레거시 개선” 대신 route/동작/오류 조건처럼 concrete delta를 적으세요. v2 policy는 요청 범위의 baseline과 affected checks만 요구하며 전체 inventory나 migration을 기본 실행하지 않습니다.

## Figma

### URL은 있는데 contracts가 blocked다

URL 문자열만으로는 evidence가 아닙니다.

1. 호스트에 Figma 기능이 연결되어 있고 파일 권한이 있는지 확인합니다.
2. `node-id` 포함 URL로 대상 frame을 좁힙니다.
3. 호스트 기능으로 실제 node/screenshot/variable/asset/component context를 수집합니다.
4. `provider: host-connected-figma`, ISO `capturedAt`, profile과 일치하는 `fileUrl`, 비어 있지 않은 `nodeIds`, JSON `manifestPath`를 기록합니다.
5. Strict manifest에 같은 출처 값과 PNG `visualPaths`를 기록하고, manifest와 실제 PNG 한 개 이상을 포함한 typed `figma-bundle`을 정확히 한 번 제출합니다.

같은 Run에 Figma bundle을 반복 제출하거나 SpecToPR에 Figma microtool을 추가하거나 provider 상태를 polling하는 방식으로 우회하지 않습니다. Host capability가 없다면 required evidence blocker를 해소할 때까지 Figma mode를 통과시킬 수 없습니다.

## Feature E2E와 영상

### 전체 E2E를 실행하려고 한다

중단하고 변경 기능을 고르는 selector를 정하세요. Test file path, tag, browser-test project 중 하나를 사용하고 실행 command에 그 selector가 실제로 들어가야 합니다. Full-project E2E는 feature mode의 기본 요구가 아닙니다.

### 영상이 있는데 기능 검토가 blocked다

다음을 모두 확인하세요.

- delivery profile이 user-facing `feature`
- `scope: targeted-feature`
- selector가 단일 Playwright command의 실제 인자임
- strict result JSON이 `status: passed`, 정확한 selector, implementation 제출과 같은 `implementationContextId`, 양수 `testCount`만 기록함
- 재생 시간이 0보다 큰 구조적으로 유효한 WebM/MP4 컨테이너가 정확히 한 개이고 25 MB 이하
- result path와 video path가 implementation artifact 목록에 포함됨

Video는 interaction evidence이며 Figma/legacy visual baseline이나 accessibility evidence를 대신하지 않습니다.

## API와 UI

### UI implementation 제출이 거부된다

API-backed UI인데 명시적 `api-ready` checkpoint가 없거나 최종 `apiReady`가 false이거나 `implementationContextId`가 다른 경우입니다. 같은 context에서 물리적으로 서로 다른 비어 있지 않은 type, schema, wrapper/client, mock 파일과 `status: passed`인 contract-test JSON을 `apiArtifacts`로 먼저 제출하고 최종 구현에 같은 ID를 쓰세요. Path, symlink, hard link alias는 별도 증거가 아닙니다. Boolean만 true로 바꾸거나 별도 API agent를 나중에 통합하는 흐름은 v2 contract가 아닙니다.

## Review와 gate

### Functional review만 있고 design review가 없다

정상일 수 있습니다. Design review는 UI scope에만 적용됩니다. 반대로 UI가 실제로 바뀌었는데 scope 분류가 비-UI라면 implementation의 `uiChanged`와 intake evidence를 확인하세요.

### 실행하지 않은 check가 blocker다

필수 gate는 empty/skipped/not-run evidence로 통과하지 않습니다. Repository의 실제 command를 실행해 project-local 결과를 제출하거나, 그 gate가 scope에 적용되지 않는다는 근거가 있을 때만 not applicable로 분류하세요.

## Workload와 token budget

### Intake estimate가 부정확하다

초기 estimate는 정보가 적어 `low` confidence와 넓은 범위가 정상입니다. Contracts 제출에 실제 요구사항, 관련 파일, API operation, UI surface, Figma node, test target, workspace package, uncertainty의 non-negative `workloadSignals`를 포함하세요. 완료된 같은 mode/size 표본이 10개 이상이면 SDK가 median/p90으로 보정합니다.

### 80%인데 즉시 멈추지 않았다

SDK가 usage를 받는 시점은 Codex turn 완료 뒤입니다. 실행 중 live token count는 없으므로 정확한 토큰에서 끊지 않고 최초로 80% 이상이 확인된 workflow action 경계에서 compact checkpoint와 fresh thread를 만듭니다. 한 turn이 매우 크면 경계 확인 전에 80%를 넘을 수 있습니다.

Agent가 한 action group 뒤에 멈추라는 지시를 무시하면 같은 turn 안의 이미 발생한 side effect는 SDK가 되돌릴 수 없습니다. 다만 매 action turn의 새 structured status를 요구하므로 이전 status로 같은 action을 재생하지 않고, 다음 turn 전에 budget을 다시 확인합니다.

Fresh thread나 `--resume`은 기존 durable run ID로 `workflow_status`를 먼저 호출합니다. `resumeContext.goal`, `evidencePaths`, `submissions`가 비어 있거나 필요한 프로젝트 파일이 사라졌다면 새 Run을 만들지 말고 blocker로 처리하세요.

### `split-required` 또는 `approval-required`가 나왔다

Hard limit 뒤 다음 action을 임의로 시작하지 않습니다. `L`/`XL`은 독립적으로 검증 가능한 scope slice로 나누고, 더 작은 작업이거나 분할할 수 없으면 사용자가 더 큰 `--token-budget`을 명시적으로 승인해야 합니다. 어느 경우든 functional/design 등 required validation은 삭제하거나 waive하지 않습니다.

### Usage history를 남기고 싶지 않다

`--no-usage-calibration`을 사용하세요. 기본 기록은 `~/.codex/spec-to-pr/usage-history.jsonl`에 숫자/enum만 보관하며 prompt, source, code, diff, path, tool output, final response는 저장하지 않습니다. 경로 권한 문제가 있으면 `--usage-history`로 쓰기 가능한 대상 저장소 밖 위치를 지정하세요.

History read/write는 best-effort입니다. 권한 문제가 있어도 이미 완료·발행된 workflow를 실패로 뒤집지 않고 SDK 결과의 `usageCalibration.read` 또는 `write`가 `unavailable`을 보고합니다. Turn usage 자체가 없으면 calibration을 쓰지 않으며, nonterminal 실행은 `usage-unavailable`로 멈춥니다.

`--usage-history`는 대상 저장소 밖 경로만 허용합니다. 저장소 안 JSONL은 git clean-tree와 draft publication preflight를 깨뜨릴 수 있으므로 외부 절대 경로를 사용하거나 calibration을 비활성화하세요. Terminal action이 이미 hard limit에 도달했다면 optional output-schema formatting turn도 시작하지 않습니다.

## Publication

### Draft PR/MR이 만들어지지 않는다

- delivery profile의 `publication`이 `draft`인지 확인
- `workflow_status`가 publish-ready이고 required blocker가 없는지 확인
- GitHub: `GITHUB_TOKEN` → `GH_TOKEN` → `gh auth token`
- GitLab: `GITLAB_TOKEN` → `GITLAB_PRIVATE_TOKEN` → `glab auth token`
- feature mode: 영상 sync가 성공했는지 확인
- `sourceBranch`가 `targetBranch`와 다르고, working tree가 clean하며, 의도한 변경이 source에 commit되어 target보다 한 commit 이상 앞서는지 확인

Publisher는 draft만 다룹니다. Merge, approve, ready 전환 실패를 publisher 문제로 취급하지 마세요. 그런 action은 애초에 수행하지 않습니다.

## 재개와 archive

중단된 Run은 `workflow_status`로 blocker와 next action을 확인한 뒤 `workflow_advance`로 이어갑니다. 이미 승인된 stage를 다시 실행하지 않습니다.

Archive는 review request의 authoritative merge evidence가 있어야 합니다. Branch push, closed 상태, 사용자 의도만으로 merge를 추측하지 않으며 runtime은 merge 상태를 polling하지 않습니다.

해결되지 않으면 [GitHub Issues](https://github.com/dhyun2/spec-to-pr/issues)에 Doctor 결과와 redacted blocker를 함께 남겨 주세요.
