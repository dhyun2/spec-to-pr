---
sidebar_position: 31
title: "T31 · GitHub·GitLab 퍼블리셔"
sidebar_label: "T31 퍼블리셔"
---

# T31 · GitHub·GitLab 퍼블리셔

> **한 줄 요약** — T30의 증거 기반 리포트를 draft GitHub PR 또는 GitLab MR로 발행하고, 결과를 PublishResult로 [Run](/reference/glossary#run)에 기록한다.

| 항목              | 내용                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| **목적**          | 검증된 Run 원장을 리포지토리 호스팅 서비스에 연결한다 — T30은 본문을 만들 뿐 발행하지 않는다                     |
| **입력**          | Run ID, PR 리포트 아티팩트(T30), 통합 브랜치(T23), 대상 브랜치, 호스트 타깃 정책, 선택적 label/reviewer/assignee |
| **출력**          | draft PR/MR, PublishResult 아티팩트, PublishingAgentResult, PR/MR URL·번호 — T32 아카이브가 소비                 |
| **선행 태스크**   | T30                                                                                                              |
| **병렬 가능**     | 없음                                                                                                             |
| **관련 스킬**     | `/spec-to-pr:publish-review-request`                                                                             |
| **담당 에이전트** | `agents/publisher-reviewer.md`                                                                                   |

## 왜 필요한가

T30은 PR/MR 본문을 결정론적 아티팩트로 생성하지만 발행하지 않는다. T31이 없으면 검증된 증거가 리뷰어에게 도달하지 못한다.

리포트가 blocked인 경우 신규 생성과 ready 전환은 계속 금지된다. 단, draft PR/MR이 이미 존재하면 리뷰어가 증거를 볼 수 있도록 **명시적 요청 하에** 본문만 blocked 실패 리포트로 갱신할 수 있다.

## 동작 흐름

1. GitHub 또는 GitLab publish plan을 만든다 (호스트 감지 + 정책).
2. 소스 브랜치(통합 브랜치)를 push 한다.
3. 같은 소스 브랜치의 기존 open PR/MR이 있으면 중복 생성 대신 갱신한다.
4. 기본 발행 모드 **draft**로 PR/MR을 생성·갱신한다. 본문은 반드시 T30 PR 리포트 [ArtifactRef](/reference/glossary#artifactref)에서 온다 — 퍼블리셔가 기억으로 본문을 재작성해서는 안 된다.
5. 본문에는 [Review Scorecard](/reference/glossary#scorecard) 섹션이 포함되어야 하며, 정규화된 최소 임계값 미만의 차원을 숨겨서는 안 된다.
6. blocked 리포트는 새 리뷰 요청을 만들거나 기존 요청을 ready로 바꿀 수 없다. 기존 draft에 대한 blocked 본문 갱신은 명시적 blocked-draft-update 경로로만 허용된다.
7. 시각 아티팩트(스크린샷 등)를 PR/MR 미리보기용으로 업로드한다. 리포트·intake 정책이 미리보기를 요구하는데 업로드가 실패하면 publish 결과는 실패로 기록된다.
8. PublishResult(본문 동기화, 미리보기 기대·동기화, fallback 모드, partial 사유)와 PublishingAgentResult(`prUrl`, `reportArtifactId`)를 Run에 기록한다.

## 입력 상세

- **PR 리포트 아티팩트** — T30이 생성한 본문 Markdown.
- **통합 브랜치 / 대상 브랜치** — `spec-to-pr/<shortRunId>/integration` → 기본 브랜치.
- **호스트 타깃 정책** — GitHub/GitLab, Enterprise/self-hosted 오버라이드.
- **토큰** — 환경변수 또는 명시적 런타임 secret provider에서만 온다. [Run](/reference/glossary#run), Artifact, stdout, stderr, PR 본문 어디에도 저장 금지.
- **선택적 label/reviewer/assignee**

## 출력 상세

- **draft GitHub PR 또는 GitLab MR**
- **PublishResult 아티팩트** — 본문 동기화 여부, 시각 미리보기 기대/동기화, fallback 모드, partial 사유.
- **PublishingAgentResult** — `prUrl`과 `reportArtifactId`로 검증되는 [AgentResult](/reference/glossary#agentresult).
- **PR/MR URL, 번호(또는 IID), 호스트 메타데이터**
- **blocked draft 본문 갱신 결과** (명시적으로 요청된 경우)

## 완료 조건 (Definition of Done)

- [ ] GitHub publish plan을 만들 수 있다.
- [ ] GitLab publish plan을 만들 수 있다.
- [ ] GitHub 어댑터가 draft PR을 생성·갱신한다.
- [ ] GitLab 어댑터가 draft MR을 생성·갱신한다.
- [ ] 기존 draft PR/MR 본문을 리뷰 준비 상태 변경 없이 blocked 리포트 증거로 갱신할 수 있다.
- [ ] PR/MR URL이 Run에 기록된다.
- [ ] PublishingAgentResult가 `prUrl`·`reportArtifactId`로 검증된다.
- [ ] Publish 결과가 본문 동기화·시각 미리보기 기대·동기화·fallback 모드·partial 사유를 기록한다.
- [ ] 스킬 `/spec-to-pr:publish-review-request`가 존재한다.
- [ ] 퍼블리셔 리뷰어 에이전트가 존재한다.

## 검증 방법

```bash
pnpm format:check
pnpm typecheck
pnpm schemas:build
pnpm build
pnpm test
pnpm audit
```

수동 라이브 검증(토큰 필요):

```bash
GITHUB_TOKEN=... pnpm test:publisher:github
GITLAB_TOKEN=... pnpm test:publisher:gitlab
```

라이브 퍼블리셔 테스트는 기본 CI에서 실행하지 않는다.

## 알려진 한계

- GitHub Enterprise·self-hosted GitLab은 휴리스틱으로 감지되며 `SPEC_TO_PR_GIT_HOST`, `SPEC_TO_PR_API_BASE_URL`, `SPEC_TO_PR_WEB_BASE_URL`로 오버라이드할 수 있다.
- Git push는 소스 브랜치에 대해서만 구현된다.
- 퍼블리셔는 merge·approve 하지 않는다.
- 시각 아티팩트 업로드는 PR/MR 미리보기용으로 지원되며, 미리보기가 필수인데 실패하면 publish 결과가 실패로 기록된다 (성공으로 위장하지 않음).
- label/reviewer 지원은 기본 수준이다.
- 토큰 저장소는 의도적으로 구현하지 않는다 (OAuth 플로 없음).
- 기존 PR/MR 매칭은 소스 브랜치 기준이다.
